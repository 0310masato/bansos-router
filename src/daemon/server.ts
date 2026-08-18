import http from "node:http";
import { Readable } from "node:stream";
import type { Logger } from "../logger";
import { parseChatTurn } from "../protocols/openai-chat";
import { loadRelayState, relayFetch } from "../relay/egress";
import type { RuntimeCatalog } from "./catalog";
import type { RateLimiter } from "./rate-limit";

export interface StatusPayload {
  status: "ok";
  uptimeSeconds: number;
  port: number;
  modelCount: number;
  models: string[];
}

export interface ServerOptions {
  catalog: RuntimeCatalog;
  rateLimiter: RateLimiter;
  port: number;
  log: Logger;
  startedAt: number;
}

const ALLOWED_METHODS = new Set(["GET", "POST", "OPTIONS"]);

  // whitelisted inbound paths only; traversal/encoded variants rejected
const ALLOWED_PATH_PATTERN = /^\/v1\/(chat\/completions|messages|responses|models)\/?$|^\/healthz\/?$|^\/bansos\/status\/?$/;

function validatePath(rawUrl: string): boolean {
  const cleaned = rawUrl.replace(/^\/+/, "");
  const withSlash = `/${cleaned}`;
  if (!ALLOWED_PATH_PATTERN.test(withSlash)) return false;
  if (withSlash.includes("..")) return false;
  try {
    const decoded = decodeURIComponent(withSlash);
    if (decoded !== withSlash) return false; // encoded variants not accepted (v1)
  } catch {
    return false;
  }
  return true;
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readBody(
  req: http.IncomingMessage,
  cap = 10 * 1024 * 1024,
): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > cap) throw new Error("request body too large");
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// openai chat in -> resolve model -> forward raw body to its upstream
// stream the response back unchanged (keyless upstreams speak openai chat)
async function handleChat(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  catalog: RuntimeCatalog,
  log: Logger,
): Promise<void> {
  let bodyText: string;
  try {
    bodyText = await readBody(req);
  } catch {
    sendJson(res, 413, { error: { message: "request body too large" } });
    return;
  }

  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    sendJson(res, 400, { error: { message: "invalid JSON body" } });
    return;
  }

  const parsed = parseChatTurn(body);
  if (!parsed.ok) {
    sendJson(res, 400, { error: { message: parsed.error } });
    return;
  }

  const model = catalog.resolve(parsed.value.model);
  if (!model) {
    sendJson(res, 400, {
      error: {
        message: `unknown model: ${parsed.value.model}`,
        hint: `available: ${catalog.models.map((m) => m.id).join(", ")}`,
      },
    });
    return;
  }

  const upstream = catalog.upstreamBySource(model.source);
  if (!upstream) {
    sendJson(res, 502, { error: { message: `no upstream for source: ${model.source}` } });
    return;
  }

  const headers = new Headers({
    "content-type": "application/json",
    ...upstream.requestHeaders(model),
  });

  log.info("chat → upstream", {
    model: model.id,
    upstream: upstream.id,
    stream: parsed.value.stream,
  });

  try {
    const relay = loadRelayState();
    const upstreamRes = await relayFetch(relay, upstream.chatUrl, {
      method: "POST",
      headers,
      body: bodyText,
      duplex: "half",
    });

    res.writeHead(upstreamRes.status, {
      "content-type": upstreamRes.headers.get("content-type") ?? "application/json",
    });

    if (upstreamRes.body) {
      Readable.fromWeb(
        upstreamRes.body as import("node:stream/web").ReadableStream,
      ).pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    log.warn("upstream request failed", { error: String(err) });
    sendJson(res, 502, { error: { message: "upstream request failed" } });
  }
}

export function createServer(opts: ServerOptions): http.Server {
  const { catalog, rateLimiter, port, log, startedAt } = opts;

  return http.createServer((req, res) => {
    const ip = req.socket.remoteAddress ?? "unknown";
    const method = req.method ?? "";

    if (!rateLimiter.check(ip)) {
      log.warn("rate limit exceeded", { ip });
      sendJson(res, 429, { error: { message: "rate limit exceeded" } });
      return;
    }

    if (!ALLOWED_METHODS.has(method)) {
      sendJson(res, 405, { error: { message: "method not allowed" } });
      return;
    }

    if (method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-max-age": "86400",
      });
      res.end();
      return;
    }

    const url = req.url ?? "/";
    if (!validatePath(url)) {
      sendJson(res, 403, { error: { message: "forbidden" } });
      return;
    }


    if (method === "GET" && (url === "/v1/models" || url === "/v1/models/")) {
      sendJson(res, 200, {
        object: "list",
        data: catalog.models.map((m) => ({
          id: m.id,
          object: "model",
          created: 0,
          owned_by: "bansos",
        })),
      });
      return;
    }

    if (url === "/healthz") {
      sendJson(res, 200, {
        status: "ok",
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        modelCount: catalog.models.length,
      });
      return;
    }

    if (url === "/bansos/status") {
      const payload: StatusPayload = {
        status: "ok",
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        port,
        modelCount: catalog.models.length,
        models: catalog.models.map((m) => m.id),
      };
      sendJson(res, 200, payload);
      return;
    }


    if (method === "POST" && url === "/v1/chat/completions") {
      void handleChat(req, res, catalog, log);
      return;
    }

    const notImplemented = (endpoint: string) =>
      sendJson(res, 501, {
        error: {
          message: `${endpoint} not implemented yet`,
          hint: "milestone M1 (messages) / M3 (responses)",
        },
      });

    if (url === "/v1/messages") notImplemented("POST /v1/messages");
    else if (url === "/v1/responses") notImplemented("POST /v1/responses");
    else sendJson(res, 404, { error: { message: "not found" } });
  });
}
