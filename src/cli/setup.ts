import { ADAPTERS, findAdapter } from "../adapters";
import type { SetupContext } from "../adapters/types";
import { loadConfig } from "../daemon/state";

const DEFAULT_MODEL = "deepseek-v4-flash-free";

interface SetupArgs {
  harnesses: string[];
  model?: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): SetupArgs {
  const args: SetupArgs = { harnesses: [], dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a === "--model") args.model = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--help" || a === "-h") {
      console.log(`bansos setup <harness...> [--model <id>] [--dry-run]

Harnesses: ${ADAPTERS.map((a) => a.id).join(", ")}
`);
      process.exit(0);
    } else args.harnesses.push(a);
  }
  return args;
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

  for (const id of args.harnesses) {
    const adapter = findAdapter(id);
    if (!adapter) {
      console.error(`bansos setup: unknown harness "${id}" (see --help)`);
      continue;
    }
    console.log(`\n${adapter.name} (${adapter.wire}):`);
    if (args.dryRun) {
      for (const write of adapter.render(ctx)) {
        console.log(`  → ${write.path}`);
        console.log(write.content.replace(/^/gm, "    "));
      }
    } else {
      // TODO(M2): marker-based merge + write + --undo.
      console.log(`  config writing lands in M2 — run with --dry-run to preview`);
    }
  }

  return args.harnesses.some((id) => !findAdapter(id)) ? 1 : 0;
}
