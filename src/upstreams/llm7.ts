import { modelDef, type ModelDef, type Upstream } from "./types";

export const LLM7_BASE_URL = "https://llm7.io/api/v1";
export const LLM7_ANONYMOUS_KEY = "unused";
export const LLM7_ALIASES = ["default", "fast", "pro"] as const;

// defaults used when the live catalog omits metadata
const LLM7_DEFAULT_CONTEXT = 128_000;
const LLM7_DEFAULT_MAX_TOKENS = 8_192;

export const llm7Upstream: Upstream = {
  id: "llm7",
  kind: "remote-keyless",
  relayAllowed: true,
  chatUrl: `${LLM7_BASE_URL}/chat/completions`,

  async fetchCatalog(): Promise<ModelDef[] | null> {
    // TODO(M0): GET `${LLM7_BASE_URL}/models`; snapshot the dynamic catalog
    // with conservative defaults and tag `source: "llm7"`. always include the
    // stable aliases (default/fast/pro). return null on failure.
    return null;
  },

  requestHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${LLM7_ANONYMOUS_KEY}` };
  },
};

// build the alias entries (stable, always present)
export function llm7AliasModels(): ModelDef[] {
  return LLM7_ALIASES.map((alias) =>
    modelDef({
      id: alias,
      name: `LLM7 ${alias[0]?.toUpperCase()}${alias.slice(1)}`,
      source: "llm7",
      reasoning: false,
      contextWindow: LLM7_DEFAULT_CONTEXT,
      maxTokens: LLM7_DEFAULT_MAX_TOKENS,
      input: ["text"],
      compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
    }),
  );
}
