import { llm7Upstream, llm7AliasModels } from "./llm7";
import { kiloUpstream, KILO_MODELS } from "./kilo";
import { createLocalUpstream, type LocalUpstreamConfig } from "./local";
import type { ModelDef, Upstream } from "./types";
import { zenUpstream, ZEN_MODELS } from "./zen";

export const DEFAULT_UPSTREAMS: Upstream[] = [zenUpstream, kiloUpstream, llm7Upstream];

export const SEEDED_MODELS: ModelDef[] = [
  ...ZEN_MODELS,
  ...KILO_MODELS,
  ...llm7AliasModels(),
];

export function buildUpstreams(locals: LocalUpstreamConfig[] = []): Upstream[] {
  return [...DEFAULT_UPSTREAMS, ...locals.map(createLocalUpstream)];
}
