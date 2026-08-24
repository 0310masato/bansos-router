import { isUpstreamAllowed, type SecurityConfig } from "../security/policy";
import type { ModelDef } from "../upstreams/types";

export const AUTO_MODEL_ID = "bansos/auto";

export type RoutingStrategy = "efficiency" | "balanced" | "quality";
export type TaskKind = "simple" | "general" | "coding" | "reasoning" | "long-context" | "vision";
export type CapabilityTier = "light" | "standard" | "advanced";
export type ModelFit = "well-matched" | "overspecified" | "underspecified" | "incompatible";

export interface RoutingConfig {
  enabled: boolean;
  strategy: RoutingStrategy;
  upstreamPriority: string[];
}

export interface TaskAnalysis {
  task: TaskKind;
  requiredTier: CapabilityTier;
  estimatedInputTokens: number;
  requestedOutputTokens: number;
  requiredContextTokens: number;
  requiresVision: boolean;
  usesTools: boolean;
  signals: string[];
}

export interface ModelAssessment {
  modelId: string;
  upstream: string;
  modelTier: CapabilityTier;
  fit: ModelFit;
  score: number;
  reasons: string[];
}

export interface RoutingDecision {
  analysis: TaskAnalysis;
  requestedModel: string;
  selectedModel?: string;
  selectedUpstream?: string;
  selectedFit?: ModelFit;
  candidates: ModelAssessment[];
}

export const DEFAULT_ROUTING_CONFIG: RoutingConfig = {
  enabled: false,
  strategy: "balanced",
  upstreamPriority: ["zen", "kilo", "llm7"],
};

const TIER_ORDER: Record<CapabilityTier, number> = {
  light: 0,
  standard: 1,
  advanced: 2,
};

const CODE_SIGNALS = [
  /```/i,
  /\b(?:code|function|class|typescript|javascript|python|rust|sql|api|bug|test|lint)\b/i,
  /\b(?:error|exception|stack trace|compile|runtime)\b/i,
  /(?:コード|関数|クラス|実装|バグ|テスト|エラー|例外|デバッグ)/,
];

const ADVANCED_SIGNALS = [
  /\b(?:architecture|security|audit|migration|root cause|trade-?off|multi-?step|performance)\b/i,
  /\b(?:analy[sz]e|compare|reason|investigate|design|plan|optimi[sz]e)\b/i,
  /(?:設計|監査|移行|原因分析|比較|推論|調査|計画|最適化|セキュリティ)/,
];

const SIMPLE_SIGNALS = [
  /\b(?:translate|rewrite|format|spellcheck|one line|brief summary)\b/i,
  /(?:翻訳|言い換え|整形|校正|一行|短く|簡単な要約)/,
];

const CODE_MODEL_SIGNALS = [
  /code/i,
  /coder/i,
  /codestral/i,
  /devstral/i,
  /north/i,
  /deepseek/i,
];

interface PromptFacts {
  text: string;
  hasImage: boolean;
  usesTools: boolean;
  requestedOutputTokens: number;
}

const OPAQUE_MEDIA_KEYS = new Set([
  "image_url",
  "url",
  "data",
  "image_base64",
  "b64_json",
]);

export interface CandidateContext {
  models: ModelDef[];
  upstreamId(model: ModelDef): string | undefined;
  security: SecurityConfig;
  routing: RoutingConfig;
}

export function normalizeRoutingConfig(
  raw: Partial<RoutingConfig> | null | undefined,
): RoutingConfig {
  const strategy: RoutingStrategy =
    raw?.strategy === "efficiency" || raw?.strategy === "quality"
      ? raw.strategy
      : "balanced";
  const upstreamPriority = Array.isArray(raw?.upstreamPriority)
    ? [...new Set(raw.upstreamPriority
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean))]
    : [...DEFAULT_ROUTING_CONFIG.upstreamPriority];

  return {
    enabled: raw?.enabled === true,
    strategy,
    upstreamPriority,
  };
}

function extractPromptFacts(body: unknown): PromptFacts {
  const textParts: string[] = [];
  let hasImage = false;
  let usesTools = false;
  let requestedOutputTokens = 4_096;
  const seen = new WeakSet<object>();
  const pending: Array<{ value: unknown; key?: string }> = [{ value: body }];

  while (pending.length > 0) {
    const { value, key } = pending.pop()!;
    if (typeof value === "string") {
      if (key !== "model" && !OPAQUE_MEDIA_KEYS.has(key ?? "")) textParts.push(value);
      if (key === "type" && value.toLowerCase().includes("image")) hasImage = true;
      if (/\[image(?::|\])/i.test(value)) hasImage = true;
      continue;
    }
    if (typeof value === "number" && ["max_tokens", "max_output_tokens", "max_completion_tokens"].includes(key ?? "")) {
      if (Number.isFinite(value) && value > 0) requestedOutputTokens = Math.floor(value);
      continue;
    }
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);

    if (Array.isArray(value)) {
      if (key === "tools" && value.length > 0) usesTools = true;
      for (let index = value.length - 1; index >= 0; index -= 1) {
        pending.push({ value: value[index], key });
      }
      continue;
    }

    const entries = Object.entries(value);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [childKey, childValue] = entries[index]!;
      if (childKey === "tools" && Array.isArray(childValue) && childValue.length > 0) usesTools = true;
      if (["image", "image_url", "input_image"].includes(childKey)) hasImage = true;
      pending.push({ value: childValue, key: childKey });
    }
  }

  return {
    text: textParts.join("\n"),
    hasImage,
    usesTools,
    requestedOutputTokens,
  };
}

function matchesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

export function analyzeTask(body: unknown): TaskAnalysis {
  const facts = extractPromptFacts(body);
  const estimatedInputTokens = Math.max(1, Math.ceil(facts.text.length / 4));
  const requiredContextTokens = estimatedInputTokens + facts.requestedOutputTokens;
  const hasCode = matchesAny(facts.text, CODE_SIGNALS);
  const hasAdvancedReasoning = matchesAny(facts.text, ADVANCED_SIGNALS);
  const hasSimpleInstruction = matchesAny(facts.text, SIMPLE_SIGNALS);
  const signals: string[] = [];

  if (facts.hasImage) signals.push("image-input");
  if (facts.usesTools) signals.push("tool-use");
  if (hasCode) signals.push("code");
  if (hasAdvancedReasoning) signals.push("advanced-reasoning");
  if (hasSimpleInstruction) signals.push("simple-instruction");
  if (requiredContextTokens > 128_000) signals.push("long-context");

  let task: TaskKind = "general";
  let requiredTier: CapabilityTier = "standard";
  if (facts.hasImage) {
    task = "vision";
    requiredTier = requiredContextTokens > 128_000 ? "advanced" : "standard";
  } else if (requiredContextTokens > 128_000) {
    task = "long-context";
    requiredTier = "advanced";
  } else if (hasCode) {
    task = "coding";
    requiredTier = hasAdvancedReasoning || facts.usesTools ? "advanced" : "standard";
  } else if (hasAdvancedReasoning) {
    task = "reasoning";
    requiredTier = "advanced";
  } else if (hasSimpleInstruction || (estimatedInputTokens < 160 && !facts.usesTools)) {
    task = "simple";
    requiredTier = "light";
  }

  return {
    task,
    requiredTier,
    estimatedInputTokens,
    requestedOutputTokens: facts.requestedOutputTokens,
    requiredContextTokens,
    requiresVision: facts.hasImage,
    usesTools: facts.usesTools,
    signals,
  };
}

export function inferModelTier(model: ModelDef): CapabilityTier {
  if (model.reasoning) return "advanced";
  if (model.contextWindow >= 200_000 || model.maxTokens >= 32_000 || isCodeModel(model)) {
    return "standard";
  }
  return "light";
}

function isCodeModel(model: ModelDef): boolean {
  const identity = `${model.id} ${model.name}`;
  return matchesAny(identity, CODE_MODEL_SIGNALS);
}

function fitFor(model: ModelDef, analysis: TaskAnalysis): ModelFit {
  if (analysis.requiresVision && !model.input.includes("image")) return "incompatible";
  if (model.contextWindow < analysis.requiredContextTokens) return "underspecified";
  if (model.maxTokens < analysis.requestedOutputTokens) return "underspecified";

  const modelTier = TIER_ORDER[inferModelTier(model)];
  const requiredTier = TIER_ORDER[analysis.requiredTier];
  if (modelTier < requiredTier) return "underspecified";
  if (modelTier > requiredTier) return "overspecified";
  return "well-matched";
}

function scoreModel(
  model: ModelDef,
  upstream: string,
  analysis: TaskAnalysis,
  fit: ModelFit,
  routing: RoutingConfig,
): number {
  const priorityIndex = routing.upstreamPriority.indexOf(upstream);
  const providerPenalty = (priorityIndex === -1 ? routing.upstreamPriority.length : priorityIndex) * 1_000;
  const capacity = Math.round(model.contextWindow / 1_000) + Math.round(model.maxTokens / 100);
  const codeBonus = analysis.task === "coding" && isCodeModel(model) ? -2_000 : 0;
  const fitPenalty: Record<ModelFit, number> = {
    "well-matched": 0,
    overspecified: routing.strategy === "quality" ? 100 : 20_000,
    underspecified: 1_000_000,
    incompatible: 10_000_000,
  };

  if (routing.strategy === "quality") {
    return fitPenalty[fit] + providerPenalty + codeBonus - capacity;
  }
  const capacityWeight = routing.strategy === "efficiency" ? 5 : 1;
  return fitPenalty[fit] + providerPenalty + codeBonus + capacity * capacityWeight;
}

export function assessModel(
  model: ModelDef,
  upstream: string,
  analysis: TaskAnalysis,
  routing: RoutingConfig,
): ModelAssessment {
  const modelTier = inferModelTier(model);
  const fit = fitFor(model, analysis);
  const reasons: string[] = [`task requires ${analysis.requiredTier}`, `model provides ${modelTier}`];
  if (analysis.requiresVision) reasons.push(model.input.includes("image") ? "vision supported" : "vision unsupported");
  if (analysis.task === "coding") reasons.push(isCodeModel(model) ? "coding affinity" : "general-purpose model");
  if (model.contextWindow < analysis.requiredContextTokens) reasons.push("context window too small");
  if (model.maxTokens < analysis.requestedOutputTokens) reasons.push("output limit too small");

  return {
    modelId: model.id,
    upstream,
    modelTier,
    fit,
    score: scoreModel(model, upstream, analysis, fit, routing),
    reasons,
  };
}

export function decideRoute(
  body: unknown,
  requestedModel: string,
  context: CandidateContext,
): RoutingDecision {
  const analysis = analyzeTask(body);
  const candidates = context.models
    .map((model) => {
      const upstream = context.upstreamId(model);
      if (!upstream || !isUpstreamAllowed(context.security, upstream)) return undefined;
      return assessModel(model, upstream, analysis, context.routing);
    })
    .filter((candidate): candidate is ModelAssessment => candidate !== undefined)
    .sort((a, b) => a.score - b.score || a.modelId.localeCompare(b.modelId));

  if (requestedModel !== AUTO_MODEL_ID) {
    const selected = candidates.find((candidate) => candidate.modelId === requestedModel);
    return {
      analysis,
      requestedModel,
      selectedModel: selected?.modelId,
      selectedUpstream: selected?.upstream,
      selectedFit: selected?.fit,
      candidates: selected ? [selected] : [],
    };
  }

  const selected = candidates.find(
    (candidate) => candidate.fit === "well-matched" || candidate.fit === "overspecified",
  );
  return {
    analysis,
    requestedModel,
    selectedModel: selected?.modelId,
    selectedUpstream: selected?.upstream,
    selectedFit: selected?.fit,
    candidates: candidates.slice(0, 5),
  };
}
