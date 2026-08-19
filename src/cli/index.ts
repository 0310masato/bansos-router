#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { runDoctor } from "./doctor";
import { runPing } from "./ping";
import { runRelay } from "./relay";
import { runSetup } from "./setup";
import { runDaemon, DEFAULT_PORT, MAX_PORT } from "../daemon";
import { BANSOS_DIR, STATE_FILE, readJson } from "../daemon/state";
import { VERSION, checkUpdate } from "../update";

function help(): void {
  console.log(`bansos — free, keyless coding models for every agent harness

Usage:
  bansos start [--bg] [--port N] [--bind H]    start daemon (--bg = detached, log to ~/.bansos/logs/bansosd.log)
  bansos stop                                  stop all running daemons
  bansos setup <harness...> [--model <id>] [--dry-run] [--undo]  write harness config
  bansos status                                daemon status
  bansos models                                list live catalog
  bansos ping [model]                          probe health and latency of model(s)
  bansos refresh                               re-run health checks
  bansos logs                                  tail the daemon log live (start it with --bg first)
  bansos relay <on|off|status|url|use|list|remove|deploy>  manage relay egress
  bansos doctor                                diagnose setup
  bansos --version                             print version

Harnesses: claude-code, aider, opencode, codex, hermes, goose,
           openclaw, antigravity, jcode, 9router   (pi via the separate extension)

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
    case "logs":
      return runLogs();
    case "status":
      return runStatus();
    case "ping":
      return runPing(argv.slice(1));
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
  console.log(`watch it live with: bansos logs`);
  return 0;
}

// tail ~/.bansos/logs/bansosd.log in real time: same output the foreground
// daemon prints, for a background (--bg) daemon. Polls the file size (500ms)
// and prints appends; Ctrl+C (or SIGTERM) stops the watch.
async function runLogs(): Promise<number> {
  const logFile = path.join(BANSOS_DIR, "logs", "bansosd.log");
  if (!fs.existsSync(logFile)) {
    console.error(`bansos logs: no log file at ${logFile}`);
    console.error(`  the daemon writes one when started with: bansos start --bg`);
    return 1;
  }

  // show the last 50 lines as context before following
  const content = fs.readFileSync(logFile, "utf8");
  const lines = content.split("\n");
  const context = lines.length > 50 ? lines.slice(lines.length - 50) : lines;
  if (context.some((l) => l !== "")) {
    process.stdout.write(`${context.join("\n").trimStart()}\n`);
  }
  process.stdout.write("(watching the daemon log, Ctrl+C to stop)\n");

  let size = fs.statSync(logFile).size;
  const timer = setInterval(() => {
    let st;
    try {
      st = fs.statSync(logFile);
    } catch {
      process.stdout.write("\nbansos logs: log file removed, stopping\n");
      process.exit(0);
    }
    if (st.size === size) return;
    if (st.size < size) size = 0; // truncated or rotated: read from the start again
    const fd = fs.openSync(logFile, "r");
    const buf = Buffer.alloc(st.size - size);
    fs.readSync(fd, buf, 0, buf.length, size);
    fs.closeSync(fd);
    size = st.size;
    process.stdout.write(buf.toString("utf8"));
  }, 500);

  return await new Promise<number>((resolve) => {
    process.once("SIGINT", () => {
      clearInterval(timer);
      resolve(0);
    });
    process.once("SIGTERM", () => {
      clearInterval(timer);
      resolve(0);
    });
  });
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
      if (isDaemonCmdline(args)) pids.add(pid);
    } catch {
      // process vanished mid-scan
    }
  }
  return [...pids];
}

// a process is one of our daemons if it runs the bansos binary in daemon mode.
// the binary may be the npm bin (…/bansos, …/bansosd) or the repo build
// (dist/cli/index.js); the hidden "daemon" subcommand marks spawned children.
function isDaemonCmdline(args: string[]): boolean {
  const script = path.basename(args[1] ?? "");
  const cmd = args[2];
  if (script === "bansos" || script === "bansosd") {
    return (
      cmd === undefined ||
      cmd === "daemon" ||
      cmd === "start" ||
      cmd?.startsWith("--")
    );
  }
  return args.includes("daemon") || args.join(" ").includes("dist/daemon/index.js");
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

interface DaemonStatus {
  status: string;
  port: number;
  modelCount: number;
  models: string[];
  relay?: { enabled: boolean; url: string };
}

// find every running daemon: the configured port, the last known port in
// state.json, and the full auto-bump range the daemon binds on. A daemon
// that landed on a bumped port (17070 busy) is still reported.
async function probeDaemonPorts(): Promise<DaemonStatus[]> {
  const config = await import("../daemon/state").then((m) => m.loadConfig());
  const state = readJson<{ port?: number }>(STATE_FILE);
  const ports = new Set<number>([config.port]);
  if (state?.port) ports.add(state.port);
  for (let p = DEFAULT_PORT; p <= MAX_PORT; p++) ports.add(p);

  const results = await Promise.all(
    [...ports].map(async (port) => {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/bansos/status`, {
          signal: AbortSignal.timeout(400),
        });
        if (!res.ok) return null;
        const body = (await res.json()) as DaemonStatus;
        return body.status === "ok" ? body : null;
      } catch {
        return null;
      }
    }),
  );
  return results
    .filter((r): r is DaemonStatus => r !== null)
    .sort((a, b) => a.port - b.port);
}

async function runStatus(): Promise<number> {
  const daemons = await probeDaemonPorts();
  if (daemons.length === 0) {
    console.error(
      `bansos: no daemon reachable (probed ports ${DEFAULT_PORT}-${MAX_PORT}), start one with "bansos start"`,
    );
    const update = await checkUpdate();
    if (update.hasUpdate) {
      console.log(`\nUpdate available: ${update.current} -> ${update.latest} (run: npm i -g bansos-router)`);
    }
    return 1;
  }
  for (const [i, d] of daemons.entries()) {
    console.log(`daemon:   ok (port ${d.port})`);
    console.log(`models:   ${d.modelCount}`);
    if (d.relay?.enabled && d.relay.url) {
      console.log(`relay:    on (${d.relay.url})`);
    } else {
      console.log(`relay:    off (direct)`);
    }
    console.log(`alive:    ${d.models.join(", ") || "(none)"}`);
    if (i < daemons.length - 1) console.log("");
  }
  const update = await checkUpdate();
  if (update.hasUpdate) {
    console.log(`\nUpdate available: ${update.current} -> ${update.latest} (run: npm i -g bansos-router)`);
  }
  return 0;
}

async function runStatusOrModels(cmd: "status" | "models" | "refresh"): Promise<number> {
  const config = await import("../daemon/state").then((m) => m.loadConfig());
  const base = `http://127.0.0.1:${config.port}`;

  try {
    if (cmd === "models") {
      const res = await fetch(`${base}/v1/models`);
      const body = (await res.json()) as { data: Array<{ id: string }> };
      for (const m of body.data) console.log(m.id);
      return 0;
    }
    // refresh: ask the daemon to re-run health checks now
    const res = await fetch(`${base}/bansos/refresh`, { method: "POST" });
    const body = (await res.json()) as { modelCount: number; alive: number };
    console.log(`refreshed: ${body.modelCount} model(s), ${body.alive} alive`);
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
