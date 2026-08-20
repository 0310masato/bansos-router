import http from "node:http";
import fs from "node:fs";
import { Readable, Transform } from "node:stream";
import type { Logger } from "../logger";
import type { ModelDef } from "../upstreams/types";
import { parseChatTurn, sanitizeChatBody } from "../protocols/openai-chat";
import {
  parseAnthropicRequest,
  openAiCompletionToAnthropicMessage,
  AnthropicStreamEncoder,
} from "../protocols/anthropic";
import { loadRelayState, relayFetch } from "../relay/egress";
import { readSseStream } from "../protocols/stream";
import type { RuntimeCatalog } from "./catalog";
import type { RateLimiter } from "./rate-limit";

export interface StatusPayload {
  status: "ok";
  uptimeSeconds: number;
  port: number;
  modelCount: number;
  models: string[];
  relay?: { enabled: boolean; url: string };
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
const ALLOWED_PATH_PATTERN = /^\/v1\/(chat\/completions|messages|responses|models)\/?$|^\/healthz\/?$|^\/bansos\/(status|refresh)\/?$/;

// how many fallback models to try
const MAX_FAILOVER_RETRIES = 2;

function validatePath(rawUrl: string): boolean {
  const pathname = rawUrl.split("?")[0] ?? "/";
  const cleaned = pathname.replace(/^\/+/, "");
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

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export function extractUsage(json: unknown): TokenUsage | null {
  const usage = (json as { usage?: { prompt_tokens?: number; completion_tokens?: number } })
    ?.usage;
  if (!usage || usage.prompt_tokens == null || usage.completion_tokens == null) return null;
  return { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens };
}

// pass-through that watches the tail of the SSE bytes for a usage object and
// logs it once.
export function logUsageTransform(model: string, upstream: string, log: Logger, startedAt: number): Transform {
  let tail = "";
  let reported = false;
  return new Transform({
    transform(chunk, _enc, cb) {
      tail = `${tail}${chunk.toString("utf8")}`.slice(-16384);
      if (!reported) {
        const m = /"usage"\s*:\s*\{[^}]+\}/.exec(tail);
        if (m) {
          try {
            const usage = extractUsage(JSON.parse(`{${m[0]}}`));
            if (usage) {
              reported = true;
              log.info("chat done", { model, upstream, durationMs: Date.now() - startedAt, ...usage });
            }
          } catch {
            // not a usable usage object, keep scanning
          }
        }
      }
      cb(null, chunk);
    },
  });
}

export function pickFailover(
  catalog: RuntimeCatalog,
  origin: ModelDef,
  attempts: ReadonlySet<string> = new Set(),
): ModelDef | undefined {
  let best: ModelDef | undefined;
  let bestScore = Number.POSITIVE_INFINITY; // lower is better
  for (const candidate of catalog.models) {
    if (candidate.id === origin.id) continue;
    if (attempts.has(candidate.id)) continue;
    if (candidate.source === origin.source) continue;
    if (candidate.reasoning !== origin.reasoning) continue;
    if (candidate.compat.supportsDeveloperRole !== origin.compat.supportsDeveloperRole) continue;
    if (candidate.compat.supportsReasoningEffort !== origin.compat.supportsReasoningEffort) continue;
    if (candidate.contextWindow < origin.contextWindow) continue;

    const score = (candidate.contextWindow - origin.contextWindow) * 1_000_000 - candidate.maxTokens;
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}
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

  const requestStartedAt = Date.now();
  const sanitizedBody = sanitizeChatBody(
    body as Record<string, unknown>,
    model.compat.supportsDeveloperRole,
  );

  const relay = loadRelayState();
  const tried = new Set<string>([model.id]);
  let current: ModelDef = model;
  let currentUpstream = catalog.upstreamBySource(current.source)!;  let transientError: { status: number; errorMsg: string } | null = null;

  for (let attempt = 0; attempt <= MAX_FAILOVER_RETRIES; attempt++) {
    if (current.id !== model.id || attempt > 0) {
      log.warn("upstream rejected — fallback used", {
        from: model.id,
        to: current.id,
        fromUpstream: currentUpstream.id,
        status: transientError?.status,
        durationMs: Date.now() - requestStartedAt,
        attempt,
        error: transientError?.errorMsg.slice(0, 100),
      });
    }

    const headers = new Headers({
      "content-type": "application/json",
      ...currentUpstream.requestHeaders(current),
    });
    const outboundBody = JSON.stringify({ ...sanitizedBody, model: current.id });

    let upstreamRes: Response;
    try {
      upstreamRes = await relayFetch(relay, currentUpstream.chatUrl, {
        method: "POST",
        headers,
        body: outboundBody,
        duplex: "half",
      });
    } catch (err) {
      // transport-level failure: try next fallback
      transientError = { status: 0, errorMsg: String(err) };
      const next = pickFailover(catalog, current, tried);
      if (!next) break;
      tried.add(next.id);
      current = next;
      currentUpstream = catalog.upstreamBySource(current.source)!;
      continue;
    }

    if (upstreamRes.status >= 400) {
      const text = await upstreamRes.text();
      let errorMsg = text.slice(0, 256) || "upstream error";
      try {
        const json = JSON.parse(text);
        errorMsg = json?.error?.message ?? json?.message ?? errorMsg;
      } catch {
        // ignore parse failure; raw text stands as error message
      }

      const transient = upstreamRes.status === 429 || upstreamRes.status >= 500;
      if (!transient) {
        // client error from upstream; forward as-is, no fallback
        log.warn("upstream rejected", {
          model: current.id,
          upstream: currentUpstream.id,
          status: upstreamRes.status,
          durationMs: Date.now() - requestStartedAt,
          error: errorMsg.slice(0, 100),
        });
        sendJson(res, upstreamRes.status, {
          error: {
            message: errorMsg,
            type: "upstream_error",
            status: upstreamRes.status,
          },
        });
        return;
      }

      transientError = { status: upstreamRes.status, errorMsg };
      const next = pickFailover(catalog, current, tried);
      if (!next) break;
      tried.add(next.id);
      current = next;
      currentUpstream = catalog.upstreamBySource(current.source)!;
      continue;
    }

    // 2xx: forward the response, capturing token usage on the way
    const contentType = upstreamRes.headers.get("content-type") ?? "application/json";
    res.writeHead(upstreamRes.status, { "content-type": contentType });

    if (!parsed.value.stream) {
      // non-stream: buffer once to read usage, then forward the exact bytes
      const text = await upstreamRes.text();
      try {
        const usage = extractUsage(JSON.parse(text));
        if (usage) {
          log.info("chat done", {
            model: current.id,
            upstream: currentUpstream.id,
            durationMs: Date.now() - requestStartedAt,
            failoverFrom: current.id !== model.id ? model.id : undefined,
            ...usage,
          });
        }
      } catch {
        // usage is informational only; the plain response still goes out
      }
      res.end(text);
      return;
    }

    if (upstreamRes.body) {
      Readable.fromWeb(
        upstreamRes.body as import("node:stream/web").ReadableStream,
      )
        .pipe(logUsageTransform(current.id, currentUpstream.id, log, requestStartedAt))
        .pipe(res);
    } else {
      res.end();
    }
    return;
  }

  // fell out of the loop: every candidate rejected with 429/5xx
  const final = transientError ?? { status: 502, errorMsg: "no upstream candidates left" };
  log.warn("upstream rejected", {
    model: model.id,
    upstream: currentUpstream.id,
    status: final.status || 502,
    durationMs: Date.now() - requestStartedAt,
    attempts: tried.size,
    error: final.errorMsg.slice(0, 100),
  });
  sendJson(res, final.status || 502, {
    error: {
      message: final.errorMsg,
      type: "upstream_error",
      status: final.status || 502,
    },
  });
}

// anthropic messages in -> translate to openai chat -> forward -> translate back
async function handleAnthropic(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  catalog: RuntimeCatalog,
  log: Logger,
): Promise<void> {
  let bodyText: string;
  try {
    bodyText = await readBody(req);
  } catch {
    sendAnthropicError(res, 413, "request body too large");
    return;
  }

  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    sendAnthropicError(res, 400, "invalid JSON body");
    return;
  }

  const parsed = parseAnthropicRequest(body);
  if (!parsed.ok) {
    sendAnthropicError(res, 400, parsed.error);
    return;
  }

  const model = catalog.resolve(parsed.value.model);
  if (!model) {
    sendAnthropicError(res, 400, `unknown model: ${parsed.value.model}`);
    return;
  }

  const upstream = catalog.upstreamBySource(model.source);
  if (!upstream) {
    sendAnthropicError(res, 502, `no upstream for source: ${model.source}`);
    return;
  }

  const requestStartedAt = Date.now();
  const chatBody = parsed.value.chatBody as Record<string, unknown>;
  chatBody.model = model.id;
  // defensive cap: pin max_tokens to the model's actual limit so a stale
  // client value (or wrong metadata) never reaches the upstream
  if (typeof chatBody.max_tokens === "number" && chatBody.max_tokens > model.maxTokens) {
    chatBody.max_tokens = model.maxTokens;
  }

  log.info("anthropic → upstream", {
    model: model.id,
    upstream: upstream.id,
    stream: parsed.value.stream,
  });

  const relay = loadRelayState();
  const tried = new Set<string>([model.id]);
  let current: ModelDef = model;
  let currentUpstream = catalog.upstreamBySource(current.source)!;
  let transientError: { status: number; errorMsg: string } | null = null;

  for (let attempt = 0; attempt <= MAX_FAILOVER_RETRIES; attempt++) {
    if (current.id !== model.id || attempt > 0) {
      log.warn("upstream rejected — fallback used", {
        from: model.id,
        to: current.id,
        fromUpstream: currentUpstream.id,
        status: transientError?.status,
        durationMs: Date.now() - requestStartedAt,
        attempt,
        error: transientError?.errorMsg.slice(0, 100),
      });
    }

    const headers = new Headers({
      "content-type": "application/json",
      ...currentUpstream.requestHeaders(current),
    });
    const outboundBody = JSON.stringify({ ...chatBody, model: current.id });

    let upstreamRes: Response;
    try {
      upstreamRes = await relayFetch(relay, currentUpstream.chatUrl, {
        method: "POST",
        headers,
        body: outboundBody,
        duplex: "half",
      });
    } catch (err) {
      transientError = { status: 0, errorMsg: String(err) };
      const next = pickFailover(catalog, current, tried);
      if (!next) break;
      tried.add(next.id);
      current = next;
      currentUpstream = catalog.upstreamBySource(current.source)!;
      continue;
    }

    if (upstreamRes.status >= 400) {
      const text = await upstreamRes.text();
      let errorMsg = text.slice(0, 256) || "upstream error";
      try {
        const json = JSON.parse(text);
        errorMsg = json?.error?.message ?? json?.message ?? errorMsg;
      } catch {
        // ignore
      }

      const transient = upstreamRes.status === 429 || upstreamRes.status >= 500;
      if (!transient) {
        log.warn("upstream rejected", {
          model: current.id,
          upstream: currentUpstream.id,
          status: upstreamRes.status,
          durationMs: Date.now() - requestStartedAt,
          error: errorMsg.slice(0, 100),
        });
        sendAnthropicError(res, upstreamRes.status, errorMsg);
        return;
      }

      transientError = { status: upstreamRes.status, errorMsg };
      const next = pickFailover(catalog, current, tried);
      if (!next) break;
      tried.add(next.id);
      current = next;
      currentUpstream = catalog.upstreamBySource(current.source)!;
      continue;
    }

    if (!parsed.value.stream) {
      const text = await upstreamRes.text();
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        sendAnthropicError(res, 502, "invalid upstream response");
        return;
      }
      const message = openAiCompletionToAnthropicMessage(json, current.id);
      const usage = extractUsage(json);
      if (usage) {
        log.info("anthropic done", {
          model: current.id,
          upstream: currentUpstream.id,
          durationMs: Date.now() - requestStartedAt,
          failoverFrom: current.id !== model.id ? model.id : undefined,
          ...usage,
        });
      }
      sendJson(res, upstreamRes.status === 200 ? 200 : upstreamRes.status, message);
      return;
    }

    res.writeHead(upstreamRes.status, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "connection": "keep-alive",
    });
    const encoder = new AnthropicStreamEncoder();
    let streamUsage: TokenUsage | null = null;
    if (upstreamRes.body) {
      for await (const frame of readSseStream(upstreamRes.body)) {
        if (frame.data === "[DONE]") {
          for (const ev of encoder.close()) res.write(ev);
          break;
        }
        let json: any;
        try { json = JSON.parse(frame.data); } catch { continue; }
        const usage = extractUsage(json);
        if (usage) streamUsage = usage;
        for (const ev of encoder.push(json, current.id)) res.write(ev);
      }
    }
    if (streamUsage) {
      log.info("anthropic done", {
        model: current.id,
        upstream: currentUpstream.id,
        durationMs: Date.now() - requestStartedAt,
        failoverFrom: current.id !== model.id ? model.id : undefined,
        ...streamUsage,
      });
    }
    res.end();
    return;
  }

  // fell out of the loop: every candidate rejected with 429/5xx
  const final = transientError ?? { status: 502, errorMsg: "no upstream candidates left" };
  log.warn("upstream rejected", {
    model: model.id,
    upstream: currentUpstream.id,
    status: final.status || 502,
    durationMs: Date.now() - requestStartedAt,
    attempts: tried.size,
    error: final.errorMsg.slice(0, 100),
  });
  sendAnthropicError(res, final.status || 502, final.errorMsg);
}

function sendAnthropicError(
  res: http.ServerResponse,
  status: number,
  message: string,
): void {
  sendJson(res, status, {
    type: "error",
    error: { type: "invalid_request_error", message },
  });
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

    const rawUrl = req.url ?? "/";
    if (!validatePath(rawUrl)) {
      sendJson(res, 403, { error: { message: "forbidden" } });
      return;
    }
    const url = rawUrl.split("?")[0] ?? "/";


    if (method === "GET" && (url === "/v1/models" || url === "/v1/models/")) {
      sendJson(res, 200, {
        object: "list",
        data: catalog.models.map((m) => ({
          id: m.id,
          object: "model",
          created: 0,
          owned_by: "bansos",
          name: m.name,
          context_window: m.contextWindow,
          max_tokens: m.maxTokens,
          reasoning: m.reasoning,
        })),
      });
      return;
    }

    if (url === "/healthz") {
      const relay = loadRelayState();
      sendJson(res, 200, {
        status: "ok",
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        modelCount: catalog.models.length,
        relay: { enabled: relay.enabled, url: relay.url },
      });
      return;
    }

    if (url === "/bansos/status") {
      const relay = loadRelayState();
      const payload: StatusPayload = {
        status: "ok",
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        port,
        modelCount: catalog.models.length,
        models: catalog.models.map((m) => m.id),
        relay: { enabled: relay.enabled, url: relay.url },
      };
      sendJson(res, 200, payload);
      return;
    }

    if (method === "POST" && url === "/bansos/refresh") {
      void catalog
        .refresh()
        .then((report) => {
          sendJson(res, 200, {
            refreshed: true,
            modelCount: catalog.models.length,
            alive: report.alive,
          });
        })
        .catch((err: unknown) => {
          sendJson(res, 500, { error: { message: `refresh failed: ${String(err)}` } });
        });
      return;
    }


    if (method === "POST" && url === "/v1/chat/completions") {
      void handleChat(req, res, catalog, log);
      return;
    }

    if (method === "POST" && url === "/v1/messages") {
      void handleAnthropic(req, res, catalog, log);
      return;
    }

    const notImplemented = (endpoint: string) =>
      sendJson(res, 501, {
        error: {
          message: `${endpoint} not implemented yet`,
          hint: "milestone M3 (responses)",
        },
      });

    if (url === "/v1/responses") notImplemented("POST /v1/responses");
    else sendJson(res, 404, { error: { message: "not found" } });
  });
}
