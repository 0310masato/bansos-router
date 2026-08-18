import { llm7Upstream } from "./llm7";
import { kiloUpstream } from "./kilo";
import { createLocalUpstream, type LocalUpstreamConfig } from "./local";
import type { Upstream } from "./types";
import { zenUpstream } from "./zen";

export const DEFAULT_UPSTREAMS: Upstream[] = [zenUpstream, kiloUpstream, llm7Upstream];

export function buildUpstreams(locals: LocalUpstreamConfig[] = []): Upstream[] {
  return [...DEFAULT_UPSTREAMS, ...locals.map(createLocalUpstream)];
}
