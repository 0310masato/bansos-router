export type WireProtocol = "chat" | "anthropic" | "responses";

export type InternalContentBlock =
  | { type: "text"; text: string }
  | { type: "image_url"; url: string };

export interface InternalToolCall {
  id: string;
  name: string;
  // json-encoded arguments (may arrive as partial streamed fragments)
  arguments: string;
}

export interface InternalMessage {
  role: "user" | "assistant" | "tool";
  content: string | InternalContentBlock[];
  toolCalls?: InternalToolCall[];
  // present on role:tool, links back to the assistant's tool call
  toolCallId?: string;
  thinking?: string;
}

export interface InternalTool {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

export interface InternalTurn {
  // resolved catalog model id (aliases already mapped)
  model: string;
  system?: string;
  messages: InternalMessage[];
  tools?: InternalTool[];
  maxTokens?: number;
  thinking?: { enabled: boolean; budget?: number };
  reasoningEffort?: "low" | "medium" | "high";
  stream: boolean;
}

// parsing/validation result shared by all inbound parsers
export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };
