import type { WireProtocol } from "./internal";
import type { ParseResult } from "./internal";
import { parseAnthropicRequest } from "./anthropic";
import { parseChatTurn } from "./openai-chat";
import { parseResponsesTurn } from "./responses";

export type InboundParser = (body: unknown) => ParseResult<unknown>;

export function parserForEndpoint(path: string): { wire: WireProtocol; parse: InboundParser } | null {
  switch (path) {
    case "/v1/chat/completions":
      return { wire: "chat", parse: parseChatTurn };
    case "/v1/messages":
      return { wire: "anthropic", parse: parseAnthropicRequest };
    case "/v1/responses":
      return { wire: "responses", parse: parseResponsesTurn };
    default:
      return null;
  }
}
