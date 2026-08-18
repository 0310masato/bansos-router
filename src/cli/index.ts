#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { runDoctor } from "./doctor";
import { runRelay } from "./relay";
import { runSetup } from "./setup";
import { runDaemon } from "../daemon";
import { BANSOS_DIR, STATE_FILE, readJson } from "../daemon/state";

const VERSION = "0.1.0";

function help(): void {
  console.log(`bansos — free, keyless coding models for every agent harness

Usage:
  bansos start [--bg] [--port N] [--bind H]    start daemon (--bg = detached, log to ~/.bansos/logs/bansosd.log)
  bansos stop                                  stop all running daemons
  bansos setup <harness...> [--model <id>] [--dry-run] [--undo]  write harness config
  bansos status                                daemon status
  bansos models                                list live catalog
  bansos refresh                               re-run health checks
  bansos relay <on|off|status|url|use|list|remove|deploy>  manage relay egress
  bansos doctor                                diagnose setup
  bansos --version                             print version

Harnesses: claude-code, aider, opencode, codex, hermes, goose,
           openclaw, antigravity, jcode   (pi via the separate extension)

"bansosd" still works as an alias for the daemon (e.g. "bansosd --bg").
`);
}

function isDaemonFlag(a: string | undefined): boolean {
  return a === "--port" || a === "-p" || a === "--bind" || a === "--bg";
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const invokedAs = path.basename(process.argv[1] ?? "");

  // daemon mode: invoked as bansosd, or via the hidden "daemon" subcommand, or daemon flags
  if (invokedAs === "bansosd" || argv[0] === "daemon" || isDaemonFlag(argv[0])) {
    await runDaemon(argv);
    return 0;
  }

  switch (argv[0]) {
    case "setup":
      return runSetup(argv.slice(1));
    case "start":
      return runStart(argv.slice(1));
    case "stop":
      return runStop();
    case "status":
    case "models":
    case "refresh":
      return runStatusOrModels(argv[0]);
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
      console.error(`bansos: unknown command "${argv[0]}"`);
      help();
      return 1;
  }
}

async function runStart(args: string[]): Promise<number> {
  let bg = false;
  let port: number | undefined;
  let bind: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--bg") bg = true;
    else if (a === "--port" || a === "-p") port = Number(args[++i]);
    else if (a === "--bind") bind = args[++i];
    else {
      console.error(`bansos start: unknown flag "${a}"`);
      return 1;
    }
  }

  if (!bg) {
    // foreground: run the daemon in-process (never returns; Ctrl+C / SIGTERM shuts down)
    await runDaemon(args);
    return 0;
  }

  const logFile = path.join(BANSOS_DIR, "logs", "bansosd.log");
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const out = fs.openSync(logFile, "a");
  const child = spawn(
    process.execPath,
    [
      ...process.execArgv,
      process.argv[1]!,
      "daemon",
      ...(port !== undefined ? ["--port", String(port)] : []),
      ...(bind !== undefined ? ["--bind", bind] : []),
    ],
    {
      stdio: ["ignore", out, out] as unknown as import("node:child_process").StdioOptions,
      detached: true,
    },
  );
  child.unref();
  fs.closeSync(out);
  console.log(`started daemon in background (pid ${child.pid}), log: ${logFile}`);
  return 0;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function findDaemonPids(statePid: number | null): number[] {
  const pids = new Set<number>();
  if (statePid && isAlive(statePid)) pids.add(statePid);
  for (const entry of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (pids.has(pid)) continue;
    try {
      const args = fs.readFileSync(`/proc/${entry}/cmdline`, "utf8").split("\0").filter(Boolean);
      const script = args[1] ?? "";
      const joined = args.join(" ");
      if (joined.includes("dist/daemon/index.js")) pids.add(pid); // pre-merge build
      else if (
        joined.includes("dist/cli/index.js") &&
        (args.includes("daemon") || args.includes("start") || path.basename(script) === "bansosd")
      ) {
        pids.add(pid);
      }
    } catch {
      // process vanished mid-scan
    }
  }
  return [...pids];
}

async function runStop(): Promise<number> {
  const state = readJson<{ pid?: number }>(STATE_FILE);
  const pids = findDaemonPids(state?.pid ?? null);
  if (pids.length === 0) {
    console.log("no daemon running");
    return 0;
  }
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
  await new Promise((r) => setTimeout(r, 400));
  let stopped = 0;
  for (const pid of pids) {
    if (isAlive(pid)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // gone between checks
      }
    }
    stopped++;
  }
  fs.rmSync(STATE_FILE, { force: true });
  console.log(`stopped ${stopped} daemon(s)`);
  return 0;
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
    console.error(`bansos: daemon not reachable at ${base} — start it with "bansos start"`);
    return 1;
  }
}

process.exitCode = await main().catch((err) => {
  console.error(`bansos: ${String(err)}`);
  return 1;
});
