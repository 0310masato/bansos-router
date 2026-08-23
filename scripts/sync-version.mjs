#!/usr/bin/env node
// sync version from root package.json into the pi extension package.
// run automatically before publish: npm run sync-version
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rootPkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = rootPkg.version;

const extDir = path.join(root, "extensions", "pi");

// 1. extensions/pi/package.json
const extPkgPath = path.join(extDir, "package.json");
const extPkg = JSON.parse(fs.readFileSync(extPkgPath, "utf8"));
if (extPkg.version !== version) {
  extPkg.version = version;
  fs.writeFileSync(extPkgPath, JSON.stringify(extPkg, null, 2) + "\n");
  console.log(`extensions/pi/package.json -> ${version}`);
}

// 2. extensions/pi/src/index.ts (EXTENSION_VERSION constant)
const indexPath = path.join(extDir, "src", "index.ts");
let src = fs.readFileSync(indexPath, "utf8");
const updated = src.replace(
  /(const EXTENSION_VERSION = ")[^"]+(")/,
  `$1${version}$2`,
);
if (updated !== src) {
  fs.writeFileSync(indexPath, updated);
  console.log(`extensions/pi/src/index.ts -> ${version}`);
}

console.log(`version synced: ${version}`);
