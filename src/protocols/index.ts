import type { WireProtocol } from "./internal";
import { parseAnthropicTurn } from "./anthropic";
import { parseChatTurn } from "./openai-chat";
import { parseResponsesTurn } from "./responses";

export type InboundParser = typeof parseChatTurn;

export function parserForEndpoint(path: string): { wire: WireProtocol; parse: InboundParser } | null {
  switch (path) {
    case "/v1/chat/completions":
      return { wire: "chat", parse: parseChatTurn };
    case "/v1/messages":
      return { wire: "anthropic", parse: parseAnthropicTurn };
    case "/v1/responses":
      return { wire: "responses", parse: parseResponsesTurn };
    default:
      return null;
  }
}
