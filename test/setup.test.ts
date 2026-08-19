import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { findAdapter } from "../src/adapters";
import { applyMergeWrite, expandHome, parseJsonc, removeKeys } from "../src/cli/write";

test("expandHome uses os.homedir cross-platform", () => {
  const home = os.homedir();
  assert.equal(expandHome("~/foo/bar"), path.join(home, "foo/bar"));
  assert.equal(expandHome("~\\foo\\bar"), path.join(home, "foo\\bar"));
  assert.equal(expandHome("~"), home);
  assert.equal(expandHome("./local/file"), "./local/file");
  assert.equal(expandHome("/absolute/file"), "/absolute/file");
});

test("parseJsonc strips comments and trailing commas", () => {
  const jsonc = `
    // Configuration file
    {
      /* multi-line
         comment */
      "name": "opencode",
      "providers": {
        "url": "http://example.com//not-a-comment", // inline comment
        "trailing": true,
      },
    }
  `;
  const parsed = parseJsonc(jsonc);
  assert.equal(parsed.name, "opencode");
  assert.deepEqual(parsed.providers, {
    url: "http://example.com//not-a-comment",
    trailing: true,
  });
});

test("applyMergeWrite merges seamlessly with existing JSONC content", () => {
  const existingJsonc = `
    {
      // Existing custom provider
      "provider": {
        "custom": { "options": { "baseURL": "http://localhost:1234" } },
      },
    }
  `;
  const patch = JSON.stringify({
    provider: {
      bansos: {
        npm: "@ai-sdk/openai-compatible",
        options: { baseURL: "http://127.0.0.1:17070/v1" },
      },
    },
  });

  const merged = applyMergeWrite(existingJsonc, patch);
  const parsed = JSON.parse(merged);
  assert.ok(parsed.provider.custom);
  assert.ok(parsed.provider.bansos);
  assert.equal(parsed.provider.bansos.options.baseURL, "http://127.0.0.1:17070/v1");
});

test("findAdapter resolves 9router adapter", () => {
  const adapter = findAdapter("9router");
  assert.ok(adapter);
  assert.equal(adapter.id, "9router");
  assert.equal(adapter.wire, "chat");
  assert.deepEqual(adapter.configPaths, ["~/.9router/db.json"]);

  const writes = adapter.render({
    baseUrl: "http://127.0.0.1:17070/v1",
    defaultModel: "deepseek-v4-flash-free",
    models: [],
  });

  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.path, "~/.9router/db.json");
  assert.equal(writes[0]?.mode, "merge");

  const parsed = JSON.parse(writes[0]?.content ?? "{}");
  assert.equal(parsed.providerNodes[0].id, "bansos");
  assert.equal(parsed.providerNodes[0].baseUrl, "http://127.0.0.1:17070/v1");
  assert.equal(parsed.providerConnections[0].provider, "bansos");
});

test("9router merge and undo preserve other providers in db.json", () => {
  const existingDb = JSON.stringify({
    providerNodes: [
      { id: "kiro", name: "Kiro AI", baseUrl: "https://kiro.ai" },
    ],
    providerConnections: [
      { id: "kiro-1", provider: "kiro", apiKey: "secret" },
    ],
  });

  const adapter = findAdapter("9router")!;
  const writes = adapter.render({
    baseUrl: "http://127.0.0.1:17070/v1",
    defaultModel: "deepseek-v4-flash-free",
    models: [],
  });

  const merged = applyMergeWrite(existingDb, writes[0]!.content);
  const parsedMerged = JSON.parse(merged);

  assert.equal(parsedMerged.providerNodes.length, 2);
  assert.equal(parsedMerged.providerNodes[0].id, "kiro");
  assert.equal(parsedMerged.providerNodes[1].id, "bansos");

  assert.equal(parsedMerged.providerConnections.length, 2);
  assert.equal(parsedMerged.providerConnections[0].id, "kiro-1");
  assert.equal(parsedMerged.providerConnections[1].id, "bansos-default");

  // test undo
  removeKeys(parsedMerged, adapter.undoKeys!);
  assert.equal(parsedMerged.providerNodes.length, 1);
  assert.equal(parsedMerged.providerNodes[0].id, "kiro");
  assert.equal(parsedMerged.providerConnections.length, 1);
  assert.equal(parsedMerged.providerConnections[0].id, "kiro-1");
});
