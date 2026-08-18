import type { InternalTurn, ParseResult } from "./internal";

// parse an inbound /v1/responses body into an InternalTurn
export function parseResponsesTurn(body: unknown): ParseResult<InternalTurn> {
  // TODO(M3): instructions → system, input[] items → messages, tools[],
  // reasoning.effort, max_output_tokens.
  return { ok: false, error: "TODO(M3): parseResponsesTurn not implemented" };
}

// render a non-streaming response object
export function renderResponse(): unknown {
  // TODO(M3): { id, object: "response", output: [message/function_call/reasoning], usage }
  return null;
}

// render one responses sse frame (response.output_text.delta etc.)
export function renderResponsesEvent(): unknown {
  // TODO(M3): response.created / output_text.delta / function_call_arguments.delta
  // / reasoning_summary_text.delta / output_item.done / completed.
  return null;
}
