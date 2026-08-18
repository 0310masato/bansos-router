import { modelDef, type ModelDef, type Upstream } from "./types";

export const LLM7_BASE_URL = "https://api.llm7.io/v1";
export const LLM7_ANONYMOUS_KEY = "unused";
// default/fast are free selectors; pro requires a paid subscription
export const LLM7_ALIASES = ["default", "fast"] as const;

const LLM7_DEFAULT_CONTEXT = 128_000;
const LLM7_DEFAULT_MAX_TOKENS = 8_192;

export const llm7Upstream: Upstream = {
  id: "llm7",
  kind: "remote-keyless",
  relayAllowed: true,
  chatUrl: `${LLM7_BASE_URL}/chat/completions`,

  async fetchCatalog(): Promise<ModelDef[] | null> {
    // llm7 exposes no json models api (the /models page is html);
    // keep the seeded aliases + dynamic snapshot instead
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
