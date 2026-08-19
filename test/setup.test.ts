import test from "node:test";
import assert from "node:assert/strict";
import { findAdapter } from "../src/adapters";
import { applyMergeWrite, removeKeys } from "../src/cli/write";

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
