import test from "node:test";
import assert from "node:assert/strict";
import { isNewerVersion, checkUpdate } from "../src/update";

test("isNewerVersion compares semver versions correctly", () => {
  assert.equal(isNewerVersion("0.1.4", "0.1.5"), true);
  assert.equal(isNewerVersion("0.1.4", "0.2.0"), true);
  assert.equal(isNewerVersion("0.1.4", "1.0.0"), true);
  assert.equal(isNewerVersion("v0.1.4", "v0.1.5"), true);

  assert.equal(isNewerVersion("0.1.4", "0.1.4"), false);
  assert.equal(isNewerVersion("0.1.5", "0.1.4"), false);
  assert.equal(isNewerVersion("1.0.0", "0.9.9"), false);
});

test("checkUpdate returns UpdateInfo structure without throwing", async () => {
  const res = await checkUpdate("bansos-router", "0.1.4");
  assert.equal(typeof res.hasUpdate, "boolean");
  assert.equal(typeof res.current, "string");
  assert.equal(typeof res.latest, "string");
  assert.equal(res.current, "0.1.4");
});
