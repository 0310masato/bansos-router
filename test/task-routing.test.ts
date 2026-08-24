import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createServer } from "../src/daemon/server";
import { RuntimeCatalog } from "../src/daemon/catalog";
import { RateLimiter } from "../src/daemon/rate-limit";
import type { Logger } from "../src/logger";
import { normalizeSecurityConfig, type SecurityConfig } from "../src/security/policy";
import {
  AUTO_MODEL_ID,
  DEFAULT_ROUTING_CONFIG,
  analyzeTask,
  assessModel,
  decideRoute,
  normalizeRoutingConfig,
  type RoutingConfig,
} from "../src/routing/task-router";
import { modelDef, type ModelDef, type Upstream } from "../src/upstreams/types";

const silentLog: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() { return silentLog; },
};

function routingConfig(overrides: Partial<RoutingConfig> = {}): RoutingConfig {
  return normalizeRoutingConfig({
    enabled: true,
    strategy: "balanced",
    upstreamPriority: ["zen", "kilo", "llm7"],
    ...overrides,
  });
}

function securityConfig(allowedUpstreams?: string[]): SecurityConfig {
  if (!allowedUpstreams) return normalizeSecurityConfig(undefined);
  return normalizeSecurityConfig({ mode: "strict", allowedUpstreams });
}

function testModel(
  id: string,
  source: ModelDef["source"],
  options: Partial<Pick<ModelDef, "reasoning" | "contextWindow" | "maxTokens" | "input">> = {},
): ModelDef {
  return modelDef({
    id,
    name: id,
    source,
    reasoning: options.reasoning ?? false,
    contextWindow: options.contextWindow ?? 64_000,
    maxTokens: options.maxTokens ?? 8_192,
    input: options.input ?? ["text"],
    compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
  });
}

const MODELS = [
  testModel("zen-light", "zen"),
  testModel("kilo-light", "kilo"),
  testModel("north-mini-code", "kilo", { contextWindow: 256_000, maxTokens: 64_000 }),
  testModel("llm7-reasoning", "llm7", { reasoning: true, contextWindow: 400_000, maxTokens: 64_000 }),
  testModel("llm7-vision", "llm7", {
    contextWindow: 256_000,
    maxTokens: 32_000,
    input: ["text", "image"],
  }),
];

function decision(body: unknown, requestedModel = AUTO_MODEL_ID, allowed?: string[]) {
  return decideRoute(body, requestedModel, {
    models: MODELS,
    upstreamId: (model) => model.source,
    security: securityConfig(allowed),
    routing: routingConfig(),
  });
}

interface MockProvider {
  url: string;
  hits: number;
  models: string[];
  close(): Promise<void>;
}

async function createMockProvider(): Promise<MockProvider> {
  const seenModels: string[] = [];
  const server = http.createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk.toString();
    const body = JSON.parse(text) as { model: string };
    seenModels.push(body.model);
    const payload = JSON.stringify({
      id: "chatcmpl-local-test",
      object: "chat.completion",
      created: 0,
      model: body.model,
      choices: [{
        index: 0,
        message: { role: "assistant", content: "local test response" },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(payload);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/v1/chat/completions`,
    get hits() { return seenModels.length; },
    models: seenModels,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function testUpstream(id: "zen" | "kilo" | "llm7", chatUrl: string): Upstream {
  return {
    id,
    kind: "remote-keyless",
    relayAllowed: false,
    chatUrl,
    async fetchCatalog() { return null; },
    requestHeaders() { return {}; },
  };
}

async function createTestDaemon(
  provider: MockProvider,
  routing = routingConfig(),
  security = securityConfig(["zen", "kilo", "llm7"]),
  log: Logger = silentLog,
  models: ModelDef[] = MODELS,
): Promise<{ baseUrl: string; close(): Promise<void> }> {
  const upstreams = (["zen", "kilo", "llm7"] as const)
    .map((id) => testUpstream(id, provider.url));
  const catalog = new RuntimeCatalog(upstreams, log, security);
  catalog.seed(models);
  const server = createServer({
    catalog,
    rateLimiter: new RateLimiter({ limit: 1_000, windowMs: 60_000 }),
    port: 0,
    log,
    startedAt: Date.now(),
    security,
    routing,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function postJson(baseUrl: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function wireRequests(content: string) {
  return [
    {
      name: "chat",
      path: "/v1/chat/completions",
      body: { model: AUTO_MODEL_ID, messages: [{ role: "user", content }] },
    },
    {
      name: "responses",
      path: "/v1/responses",
      body: { model: AUTO_MODEL_ID, input: content },
    },
    {
      name: "anthropic",
      path: "/v1/messages",
      body: { model: AUTO_MODEL_ID, max_tokens: 64, messages: [{ role: "user", content }] },
    },
  ];
}

test("routing config is opt-in and normalizes invalid values without changing defaults", () => {
  assert.equal(DEFAULT_ROUTING_CONFIG.enabled, false);
  assert.equal(normalizeRoutingConfig(undefined).enabled, false);
  assert.equal(normalizeRoutingConfig({ enabled: true, strategy: "quality" }).strategy, "quality");
  assert.deepEqual(
    normalizeRoutingConfig({ enabled: true, upstreamPriority: [" kilo ", "kilo", "", "zen"] })
      .upstreamPriority,
    ["kilo", "zen"],
  );
});

test("local task analysis identifies simple, coding, reasoning, long-context, and vision work", () => {
  assert.equal(analyzeTask({ input: "Translate this sentence." }).task, "simple");
  assert.equal(analyzeTask({ input: "Implement a TypeScript function and tests." }).task, "coding");
  assert.equal(analyzeTask({ input: "Compare the architecture trade-offs and explain your reasoning." }).task, "reasoning");
  assert.equal(analyzeTask({ input: "x".repeat(520_000), max_output_tokens: 4_096 }).task, "long-context");
  assert.equal(analyzeTask({ input: [{ type: "input_image", image_url: "data:image/png;base64,AA==" }] }).task, "vision");
});

test("deeply nested task input is analyzed without exhausting the call stack", async () => {
  const provider = await createMockProvider();
  const daemon = await createTestDaemon(provider);
  const depth = 12_000;
  const body = `${'{"x":'.repeat(depth)}"Translate this sentence."${"}".repeat(depth)}`;
  try {
    const response = await fetch(`${daemon.baseUrl}/bansos/route/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    assert.equal(response.status, 200);
    const result = await response.json() as { analysis: { task: string } };
    assert.equal(result.analysis.task, "simple");
    assert.equal(provider.hits, 0);
  } finally {
    await daemon.close();
    await provider.close();
  }
});

test("automatic routing chooses the smallest suitable model and respects specialist capabilities", () => {
  const simple = decision({ input: "Translate this sentence." });
  assert.equal(simple.selectedModel, "zen-light");
  assert.equal(simple.selectedFit, "well-matched");

  const coding = decision({ input: "Implement a TypeScript function and unit tests." });
  assert.equal(coding.selectedModel, "north-mini-code");
  assert.equal(coding.analysis.task, "coding");

  const reasoning = decision({ input: "Audit the architecture and compare security trade-offs." });
  assert.equal(reasoning.selectedModel, "llm7-reasoning");
  assert.equal(reasoning.analysis.requiredTier, "advanced");

  const vision = decision({ input: [{ type: "input_image", image_url: "data:image/png;base64,AA==" }] });
  assert.equal(vision.selectedModel, "llm7-vision");
});

test("explicit models are diagnosed but never silently replaced", () => {
  const explicit = decision({ input: "Translate this sentence." }, "llm7-reasoning");
  assert.equal(explicit.selectedModel, "llm7-reasoning");
  assert.equal(explicit.selectedFit, "overspecified");
  assert.equal(explicit.candidates.length, 1);

  const undersized = assessModel(
    MODELS[0]!,
    "zen",
    analyzeTask({ input: "Audit the architecture and compare security trade-offs." }),
    routingConfig(),
  );
  assert.equal(undersized.fit, "underspecified");

  const outputTooLarge = assessModel(
    MODELS[0]!,
    "zen",
    analyzeTask({ input: "Translate this sentence.", max_output_tokens: 20_000 }),
    routingConfig(),
  );
  assert.equal(outputTooLarge.fit, "underspecified");
  assert.ok(outputTooLarge.reasons.includes("output limit too small"));
});

test("strict upstream allowlist filters automatic candidates and fails closed", () => {
  const kiloOnly = decision({ input: "Translate this sentence." }, AUTO_MODEL_ID, ["kilo"]);
  assert.equal(kiloOnly.selectedModel, "kilo-light");
  assert.ok(kiloOnly.candidates.every((candidate) => candidate.upstream === "kilo"));

  const none = decision({ input: "Translate this sentence." }, AUTO_MODEL_ID, []);
  assert.equal(none.selectedModel, undefined);
  assert.deepEqual(none.candidates, []);
});

test("route preview never contacts a provider or returns prompt text", async () => {
  const provider = await createMockProvider();
  const daemon = await createTestDaemon(provider);
  const prompt = "Audit the architecture and compare security trade-offs.";
  try {
    const response = await postJson(daemon.baseUrl, "/bansos/route/preview", {
      model: AUTO_MODEL_ID,
      messages: [{ role: "user", content: prompt }],
    });
    assert.equal(response.status, 200);
    const text = await response.text();
    const body = JSON.parse(text) as { selectedModel: string; analysis: { task: string } };
    assert.equal(body.selectedModel, "llm7-reasoning");
    assert.equal(body.analysis.task, "reasoning");
    assert.equal(text.includes(prompt), false);
    assert.equal(provider.hits, 0);
  } finally {
    await daemon.close();
    await provider.close();
  }
});

test("Chat, Responses, and Anthropic use the same automatic routing policy", async () => {
  const provider = await createMockProvider();
  const daemon = await createTestDaemon(provider);
  try {
    for (const wire of wireRequests("Translate this sentence.")) {
      const response = await postJson(daemon.baseUrl, wire.path, wire.body);
      assert.equal(response.status, 200, wire.name);
      assert.equal(response.headers.get("x-bansos-task"), "simple", wire.name);
      assert.equal(response.headers.get("x-bansos-required-tier"), "light", wire.name);
      assert.equal(response.headers.get("x-bansos-selected-model"), "zen-light", wire.name);
      assert.equal(response.headers.get("x-bansos-model-fit"), "well-matched", wire.name);
    }
    assert.equal(provider.hits, 3);
    assert.deepEqual(provider.models, ["zen-light", "zen-light", "zen-light"]);
  } finally {
    await daemon.close();
    await provider.close();
  }
});

test("Chat, Responses, and Anthropic apply the same vision capability filter", async () => {
  const provider = await createMockProvider();
  const daemon = await createTestDaemon(provider);
  const imageUrl = "data:image/png;base64,AA==";
  const wires = [
    {
      name: "chat",
      path: "/v1/chat/completions",
      body: {
        model: AUTO_MODEL_ID,
        messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: imageUrl } }] }],
      },
    },
    {
      name: "responses",
      path: "/v1/responses",
      body: {
        model: AUTO_MODEL_ID,
        input: [{ role: "user", content: [{ type: "input_image", image_url: imageUrl }] }],
      },
    },
    {
      name: "anthropic",
      path: "/v1/messages",
      body: {
        model: AUTO_MODEL_ID,
        max_tokens: 64,
        messages: [{
          role: "user",
          content: [{ type: "image", source: { type: "url", url: imageUrl } }],
        }],
      },
    },
  ];
  try {
    for (const wire of wires) {
      const response = await postJson(daemon.baseUrl, wire.path, wire.body);
      assert.equal(response.status, 200, wire.name);
      assert.equal(response.headers.get("x-bansos-task"), "vision", wire.name);
      assert.equal(response.headers.get("x-bansos-selected-model"), "llm7-vision", wire.name);
    }
    assert.deepEqual(provider.models, ["llm7-vision", "llm7-vision", "llm7-vision"]);
  } finally {
    await daemon.close();
    await provider.close();
  }
});

test("disabled auto routing rejects locally and explicit model requests remain compatible", async () => {
  const provider = await createMockProvider();
  const daemon = await createTestDaemon(provider, normalizeRoutingConfig(undefined));
  try {
    const automatic = await postJson(
      daemon.baseUrl,
      "/v1/chat/completions",
      wireRequests("Translate this sentence.")[0]!.body,
    );
    assert.equal(automatic.status, 400);
    assert.equal(provider.hits, 0);

    const explicit = await postJson(daemon.baseUrl, "/v1/chat/completions", {
      model: "zen-light",
      messages: [{ role: "user", content: "Translate this sentence." }],
    });
    assert.equal(explicit.status, 200);
    assert.equal(explicit.headers.get("x-bansos-selected-model"), null);
    assert.deepEqual(provider.models, ["zen-light"]);
  } finally {
    await daemon.close();
    await provider.close();
  }
});

test("enabled routing diagnoses explicit models and logs metadata without prompt text", async () => {
  const provider = await createMockProvider();
  const entries: Array<Record<string, unknown>> = [];
  const log: Logger = {
    debug(message, fields) { entries.push({ level: "debug", message, ...fields }); },
    info(message, fields) { entries.push({ level: "info", message, ...fields }); },
    warn(message, fields) { entries.push({ level: "warn", message, ...fields }); },
    error(message, fields) { entries.push({ level: "error", message, ...fields }); },
    child() { return log; },
  };
  const daemon = await createTestDaemon(provider, routingConfig(), undefined, log);
  const prompt = "Translate this unique local sentence into Japanese.";
  try {
    const response = await postJson(daemon.baseUrl, "/v1/chat/completions", {
      model: "llm7-reasoning",
      messages: [{ role: "user", content: prompt }],
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-bansos-selected-model"), "llm7-reasoning");
    assert.equal(response.headers.get("x-bansos-model-fit"), "overspecified");
    assert.deepEqual(provider.models, ["llm7-reasoning"]);

    const logText = JSON.stringify(entries);
    assert.equal(logText.includes(prompt), false);
    assert.equal(logText.includes("simple"), true);
    assert.equal(logText.includes("overspecified"), true);
  } finally {
    await daemon.close();
    await provider.close();
  }
});

test("unsafe dynamic model ids are encoded before being copied to response headers", async () => {
  const provider = await createMockProvider();
  const unsafeModelIds = [
    "poisoned\r\nx-injected: value",
    "unicode-モデル",
    `oversized-${"x".repeat(2_048)}`,
  ];
  const daemon = await createTestDaemon(
    provider,
    routingConfig(),
    securityConfig(["llm7"]),
    silentLog,
    unsafeModelIds.map((modelId) => testModel(modelId, "llm7")),
  );
  try {
    for (const unsafeModelId of unsafeModelIds) {
      const response = await postJson(daemon.baseUrl, "/v1/chat/completions", {
        model: unsafeModelId,
        messages: [{ role: "user", content: "Translate this sentence." }],
      });
      assert.equal(response.status, 200);
      const selectedModel = response.headers.get("x-bansos-selected-model");
      assert.match(selectedModel ?? "", /^(?:base64url:[A-Za-z0-9_-]+|omitted:\d+)$/);
      assert.equal(selectedModel?.includes("\r"), false);
      assert.equal(selectedModel?.includes("\n"), false);
      assert.notEqual(selectedModel, unsafeModelId);
    }
    assert.deepEqual(provider.models, unsafeModelIds);
  } finally {
    await daemon.close();
    await provider.close();
  }
});
