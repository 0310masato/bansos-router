import fs from "node:fs";
import { ADAPTERS, findAdapter } from "../adapters";
import type { HarnessAdapter, SetupContext } from "../adapters/types";
import { loadConfig } from "../daemon/state";
import {
  applyBlockWrite,
  applyMergeWrite,
  expandHome,
  removeBlock,
  removeKeys,
  writeConfig,
} from "./write";

const DEFAULT_MODEL = "deepseek-v4-flash-free";

interface SetupArgs {
  harnesses: string[];
  model?: string;
  dryRun: boolean;
  undo: boolean;
}

function parseArgs(argv: string[]): SetupArgs {
  const args: SetupArgs = { harnesses: [], dryRun: false, undo: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a === "--model") args.model = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--undo") args.undo = true;
    else if (a === "--help" || a === "-h") {
      console.log(`bansos setup <harness...> [--model <id>] [--dry-run] [--undo]

Harnesses: ${ADAPTERS.map((a) => a.id).join(", ")}
`);
      process.exit(0);
    } else args.harnesses.push(a);
  }
  return args;
}

function applyAdapter(adapter: HarnessAdapter, ctx: SetupContext): number {
  let failed = 0;
  for (const write of adapter.render(ctx)) {
    const existing = fs.existsSync(expandHome(write.path))
      ? fs.readFileSync(expandHome(write.path), "utf8")
      : null;
    let content: string;
    if (write.mode === "merge") {
      try {
        content = applyMergeWrite(existing, write.content);
      } catch {
        console.error(`  ✗ ${write.path}: existing file is not valid JSON, skipping`);
        failed++;
        continue;
      }
    } else {
      content = applyBlockWrite(existing ?? "", write.content, write.markers!);
    }
    writeConfig(write.path, content);
    console.log(`  ✓ wrote ${write.path}`);
  }
  return failed;
}

function undoAdapter(adapter: HarnessAdapter, ctx: SetupContext): void {
  for (const write of adapter.render(ctx)) {
    const full = expandHome(write.path);
    if (!fs.existsSync(full)) {
      console.log(`  · ${write.path} not present`);
      continue;
    }
    const existing = fs.readFileSync(full, "utf8");

    if (write.mode === "merge" && adapter.undoKeys) {
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(existing) as Record<string, unknown>;
      } catch {
        console.log(`  · ${write.path} not valid JSON, skipping`);
        continue;
      }
      removeKeys(obj, adapter.undoKeys);
      if (Object.keys(obj).length === 0) {
        fs.rmSync(full);
        console.log(`  ✗ removed ${write.path}`);
      } else {
        writeConfig(write.path, `${JSON.stringify(obj, null, 2)}\n`);
        console.log(`  ✗ ${write.path}: bansos keys removed`);
      }
    } else if (write.mode === "overwrite-block" && write.markers) {
      const out = removeBlock(existing, write.markers);
      if (out === existing) {
        console.log(`  · ${write.path}: no bansos block found`);
      } else {
        writeConfig(write.path, out);
        console.log(`  ✗ ${write.path}: bansos block removed`);
      }
    }
  }
}

export async function runSetup(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.harnesses.length === 0) {
    console.error("bansos setup: specify at least one harness (see --help)");
    return 1;
  }

  const config = loadConfig();
  const ctx: SetupContext = {
    baseUrl: `http://${config.bind}:${config.port}/v1`,
    defaultModel: args.model ?? DEFAULT_MODEL,
    models: [],
  };

  let failed = 0;
  for (const id of args.harnesses) {
    const adapter = findAdapter(id);
    if (!adapter) {
      console.error(`bansos setup: unknown harness "${id}" (see --help)`);
      failed++;
      continue;
    }
    console.log(`\n${adapter.name} (${adapter.wire}):`);
    if (args.undo) {
      undoAdapter(adapter, ctx);
    } else if (args.dryRun) {
      for (const write of adapter.render(ctx)) {
        console.log(`  → ${write.path}`);
        console.log(write.content.replace(/^/gm, "    "));
      }
    } else {
      failed += applyAdapter(adapter, ctx);
    }
  }

  return failed > 0 ? 1 : 0;
}
