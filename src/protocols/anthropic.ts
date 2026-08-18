import type { InternalTurn, ParseResult } from "./internal";

// parse an inbound /v1/messages body into an InternalTurn
export function parseAnthropicTurn(body: unknown): ParseResult<InternalTurn> {
  // TODO(M1): system field, content blocks (text/image/tool_use/tool_result),
  // thinking param, max_tokens_to_sample -> InternalTurn.
  return { ok: false, error: "TODO(M1): parseAnthropicTurn not implemented" };
}

// render a non-streaming anthropic message response
export function renderAnthropicMessage(): unknown {
  // TODO(M1): { id, type: "message", content: [text/tool_use/thinking], stop_reason, usage }
  return null;
}

// render one anthropic sse frame (message_start ... message_stop)
export function renderAnthropicEvent(): unknown {
  // TODO(M1): content_block_start / content_block_delta / content_block_stop
  // / message_delta / message_stop, thinking_delta, input_json_delta.
  return null;
}
