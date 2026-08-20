import test from "node:test";
import assert from "node:assert/strict";
import { RuntimeCatalog } from "../src/daemon/catalog";
import { pickFailover } from "../src/daemon/server";
import type { Logger } from "../src/logger";
import type { ModelDef, Upstream } from "../src/upstreams/types";

function logger(): Logger {
  return {
    info: () => {},
    debug: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger(),
  } as unknown as Logger;
}

function md(partial: Partial<ModelDef> & { id: string; source: ModelDef["source"] }): ModelDef {
  return {
    id: partial.id,
    name: partial.id,
    source: partial.source,
    reasoning: partial.reasoning ?? false,
    contextWindow: partial.contextWindow ?? 100_000,
    maxTokens: partial.maxTokens ?? 8_192,
    input: partial.input ?? ["text"],
    compat: partial.compat ?? {
      supportsReasoningEffort: false,
      supportsDeveloperRole: false,
    },
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

const fakeUpstream = (id: string): Upstream => ({
  id,
  kind: "remote-keyless",
  relayAllowed: true,
  chatUrl: `http://${id}`,
  async fetchCatalog() {
    return null;
  },
  requestHeaders() {
    return {};
  },
});

test("pickFailover prefers the smallest contextWindow match from a different upstream", () => {
  // kilo has two matches: 262k and 1M. Since origin is 200k, the closer match
  // (262k) should win over 1M.
  const upstreams = [fakeUpstream("kilo"), fakeUpstream("zen")];
  const cat = new RuntimeCatalog(upstreams, logger());
  const compat = { supportsReasoningEffort: true, supportsDeveloperRole: false };
  const zen = md({
    id: "big-pickle",
    source: "zen",
    reasoning: true,
    contextWindow: 200_000,
    maxTokens: 32_000,
    compat,
  });
  const kiloClose = md({
    id: "kilo-close",
    source: "kilo",
    reasoning: true,
    contextWindow: 262_144,
    maxTokens: 32_768,
    compat,
  });
  const kiloFar = md({
    id: "kilo-far",
    source: "kilo",
    reasoning: true,
    contextWindow: 1_000_000,
    maxTokens: 131_072,
    compat,
  });
  cat.seed([zen, kiloClose, kiloFar]);

  const got = pickFailover(cat, zen);
  assert.ok(got, "should pick a fallback");
  assert.equal(got!.id, "kilo-close", "smallest qualifying contextWindow wins");
});

test("pickFailover breaks maxTokens ties (larger wins)", () => {
  const upstreams = [fakeUpstream("kilo"), fakeUpstream("zen")];
  const cat = new RuntimeCatalog(upstreams, logger());
  const zen = md({
    id: "origin",
    source: "zen",
    reasoning: true,
    contextWindow: 200_000,
    maxTokens: 8_192,
  });
  const kiloA = md({
    id: "kilo-a",
    source: "kilo",
    reasoning: true,
    contextWindow: 262_144, // same ctx distance from origin
    maxTokens: 32_768,
  });
  const kiloB = md({
    id: "kilo-b",
    source: "kilo",
    reasoning: true,
    contextWindow: 262_144,
    maxTokens: 65_536,
  });
  cat.seed([zen, kiloA, kiloB]);

  const got = pickFailover(cat, zen);
  assert.ok(got);
  assert.equal(got!.id, "kilo-b", "when ctxWindow matches, larger maxTokens wins");
});

test("pickFailover filters on supportsReasoningEffort", () => {
  const upstreams = [fakeUpstream("kilo")];
  const cat = new RuntimeCatalog(upstreams, logger());
  const origin = md({
    id: "origin",
    source: "zen",
    reasoning: true,
    contextWindow: 200_000,
    compat: { supportsReasoningEffort: true, supportsDeveloperRole: false },
  });
  const incompatible = md({
    id: "kilo-no-effort",
    source: "kilo",
    reasoning: true,
    contextWindow: 262_144,
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  });
  cat.seed([origin, incompatible]);
  assert.equal(pickFailover(cat, origin), undefined, "reasoning effort mismatch blocks fallback");
});

test("pickFailover skips models already tried in a multi-step retry", () => {
  const upstreams = [fakeUpstream("kilo"), fakeUpstream("llm7")];
  const cat = new RuntimeCatalog(upstreams, logger());
  const zen = md({
    id: "zen-origin",
    source: "zen",
    reasoning: true,
    contextWindow: 200_000,
  });
  const kiloA = md({
    id: "kilo-a",
    source: "kilo",
    reasoning: true,
    contextWindow: 262_144,
  });
  const llm7A = md({
    id: "llm7-a",
    source: "llm7",
    reasoning: true,
    contextWindow: 256_000,
  });
  cat.seed([zen, kiloA, llm7A]);

  const tried = new Set(["zen-origin", "kilo-a"]);
  const got = pickFailover(cat, zen, tried);
  assert.ok(got, "should pick the untried candidate");
  assert.equal(got!.id, "llm7-a", "skips already-attempted candidates");
});

test("pickFailover returns undefined when no equivalent model exists", () => {
  const upstreams = [fakeUpstream("kilo")];
  const cat = new RuntimeCatalog(upstreams, logger());
  const onlyZen = md({
    id: "only-zen",
    source: "zen",
    reasoning: true,
    contextWindow: 200_000,
  });
  const kilo = md({
    id: "kilo-other",
    source: "kilo",
    reasoning: false, // mismatch
  });
  cat.seed([onlyZen, kilo]);
  assert.equal(pickFailover(cat, onlyZen), undefined);
});
