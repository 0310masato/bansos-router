import { spawn } from "node:child_process";
import http from "node:http";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

const DEFAULT_PORT = 17070;
const BASE_URL = `http://127.0.0.1:${DEFAULT_PORT}/v1`;
const HEALTHZ_URL = `http://127.0.0.1:${DEFAULT_PORT}/healthz`;
const MODELS_URL = `http://127.0.0.1:${DEFAULT_PORT}/v1/models`;

interface ModelItem {
  id: string;
  name?: string;
  context_window?: number;
  max_tokens?: number;
  reasoning?: boolean;
}

let spawnedByExtension = false;

async function isDaemonAlive(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(HEALTHZ_URL, { timeout: 1000 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function ensureDaemonRunning(): Promise<boolean> {
  if (await isDaemonAlive()) {
    return true;
  }

  try {
    const child = spawn("bansos", ["start", "--bg"], {
      stdio: "ignore",
      detached: true,
    });
    child.unref();
    spawnedByExtension = true;

    const start = Date.now();
    while (Date.now() - start < 5000) {
      await new Promise((r) => setTimeout(r, 200));
      if (await isDaemonAlive()) return true;
    }
  } catch {
    return false;
  }
  return false;
}

async function fetchModels(): Promise<ModelItem[]> {
  try {
    const res = await fetch(MODELS_URL, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: ModelItem[] };
    return json.data ?? [];
  } catch {
    return [];
  }
}

export default async function (pi: ExtensionAPI) {
  const daemonReady = await ensureDaemonRunning();

  let models: ModelItem[] = [];
  if (daemonReady) {
    models = await fetchModels();
  }

  if (models.length === 0) {
    models = [
      { id: "deepseek-v4-flash-free", name: "DeepSeek V4 Flash", context_window: 1000000, max_tokens: 384000, reasoning: true },
      { id: "mimo-v2.5-free", name: "Mimo V2.5 Free", context_window: 1048576, max_tokens: 131072, reasoning: false },
      { id: "nemotron-3-ultra-free", name: "Nemotron 3 Ultra", context_window: 1000000, max_tokens: 65536, reasoning: true },
      { id: "big-pickle", name: "Big Pickle", context_window: 200000, max_tokens: 32000, reasoning: true },
      { id: "laguna-s-2.1-free", name: "Laguna S 2.1", context_window: 262144, max_tokens: 32768, reasoning: true },
      { id: "default", name: "LLM7 Default", context_window: 128000, max_tokens: 8000, reasoning: false },
      { id: "fast", name: "LLM7 Fast", context_window: 128000, max_tokens: 8000, reasoning: false },
      { id: "kilo-auto/free", name: "Kilo Auto Free", context_window: 256000, max_tokens: 10000, reasoning: false },
    ];
  }

  // register the bansosr provider in pi
  pi.registerProvider("bansosr", {
    baseUrl: BASE_URL,
    apiKey: "bansos",
    api: "openai-completions",
    models: models.map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      reasoning: m.reasoning ?? (m.id.includes("deepseek") || m.id.includes("ultra") || m.id.includes("pickle") || m.id.includes("super") || m.id.includes("lightning") || m.id.includes("nano")),
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: m.context_window ?? 256000,
      maxTokens: m.max_tokens ?? 32000,
    })),
  });

  // register /bansosr command
  pi.registerCommand("bansosr", {
    description: "Check bansos router daemon status and models",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const alive = await isDaemonAlive();
      if (!alive) {
        ctx.ui.notify("bansos daemon is NOT running. Try: bansos start", "error");
        return;
      }
      const liveModels = await fetchModels();
      ctx.ui.notify(`bansos daemon online (${liveModels.length} models active)`, "info");
    },
  });

  // auto kill daemon only when pi completely quits, not on session switch (/resume /new)
  pi.on("session_shutdown", async (event) => {
    if (spawnedByExtension && event.reason === "quit") {
      try {
        spawn("bansos", ["stop"], { stdio: "ignore", detached: true }).unref();
      } catch {
        // ignore
      }
    }
  });
}
