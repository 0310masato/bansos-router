import type { InternalTurn, ParseResult } from "./internal";

// sanitize inbound messages based on model compatibility
// (e.g. rewrite role "developer" to "system" when upstream does not support it)
export function sanitizeChatBody(
  body: Record<string, unknown>,
  supportsDeveloperRole: boolean,
): Record<string, unknown> {
  if (supportsDeveloperRole || !Array.isArray(body.messages)) {
    return body;
  }

  let modified = false;
  const messages = body.messages.map((m) => {
    if (m && typeof m === "object" && (m as Record<string, unknown>).role === "developer") {
      modified = true;
      return { ...m, role: "system" };
    }
    return m;
  });

  return modified ? { ...body, messages } : body;
}

// parse a /v1/chat/completions body into an InternalTurn.
// validation + model extraction; the forwarder passes the raw body through
export function parseChatTurn(body: unknown): ParseResult<InternalTurn> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "request body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;
  const model = typeof b.model === "string" ? b.model : "";
  if (!model) return { ok: false, error: "missing required field: model" };
  if (!Array.isArray(b.messages)) {
    return { ok: false, error: "missing required field: messages" };
  }
  return {
    ok: true,
    value: {
      model,
      stream: b.stream === true,
      maxTokens: typeof b.max_tokens === "number" ? b.max_tokens : undefined,
      messages: [], // raw body forwarded as-is by the M0 forwarder
    },
  };
}
