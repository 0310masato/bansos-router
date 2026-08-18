import { runDoctor } from "./doctor";
import { runRelay } from "./relay";
import { runSetup } from "./setup";

const VERSION = "0.1.0";

function help(): void {
  console.log(`bansos — free, keyless coding models for every agent harness

Usage:
  bansos setup <harness...> [--model <id>] [--dry-run]   write harness config
  bansos status                                          daemon status
  bansos models                                          list live catalog
  bansos refresh                                         re-run health checks
  bansos relay <on|off|status|url|use|list|remove|deploy>  manage relay egress
  bansos doctor                                          diagnose setup
  bansos --version                                       print version

Harnesses: claude-code, aider, opencode, codex, hermes, goose,
           openclaw, antigravity, jcode   (pi via the separate extension)

Run "bansosd" in another terminal to start the daemon (or: bansos doctor).
`);
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  switch (cmd) {
    case "setup":
      return runSetup(argv.slice(1));
    case "status":
    case "models":
    case "refresh":
      return runStatusOrModels(cmd);
    case "relay":
      return runRelay(argv.slice(1));
    case "doctor":
      return runDoctor(argv.slice(1));
    case "--version":
    case "-v":
      console.log(VERSION);
      return 0;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      help();
      return 0;
    default:
      console.error(`bansos: unknown command "${cmd}"`);
      help();
      return 1;
  }
}

async function runStatusOrModels(cmd: "status" | "models" | "refresh"): Promise<number> {
  const config = await import("../daemon/state").then((m) => m.loadConfig());
  const base = `http://127.0.0.1:${config.port}`;

  try {
    if (cmd === "status") {
      const res = await fetch(`${base}/bansos/status`);
      const body = (await res.json()) as { port: number; modelCount: number; models: string[] };
      console.log(`daemon:   ok (port ${body.port})`);
      console.log(`models:   ${body.modelCount}`);
      console.log(`alive:    ${body.models.join(", ") || "(none)"}`);
      return 0;
    }
    if (cmd === "models") {
      const res = await fetch(`${base}/v1/models`);
      const body = (await res.json()) as { data: Array<{ id: string }> };
      for (const m of body.data) console.log(m.id);
      return 0;
    }
    // refresh
    // TODO(M0): POST /bansos/refresh once the daemon exposes it.
    console.log("refresh: not wired yet (lands with M0 upstream fetching)");
    return 0;
  } catch {
    console.error(`bansos: daemon not reachable at ${base} — start it with "bansosd"`);
    return 1;
  }
}

process.exitCode = await main().catch((err) => {
  console.error(`bansos: ${String(err)}`);
  return 1;
});
