import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isNewerVersion, checkUpdate, VERSION } from "../src/update";

// VERSION must stay in sync with package.json (single source of truth)
test("VERSION matches package.json version", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  };
  assert.equal(VERSION, pkg.version);
});

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
  const res = await checkUpdate("bansos-router", VERSION);
  assert.equal(typeof res.hasUpdate, "boolean");
  assert.equal(typeof res.current, "string");
  assert.equal(typeof res.latest, "string");
  assert.equal(res.current, VERSION);
});
