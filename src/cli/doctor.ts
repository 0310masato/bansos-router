import fs from "node:fs";
import { ADAPTERS } from "../adapters";
import { loadConfig } from "../daemon/state";
import { START_MARKER } from "../adapters/types";

function expandHome(p: string): string {
  return p.startsWith("~/") ? `${process.env.HOME ?? ""}/${p.slice(2)}` : p;
}

export async function runDoctor(_argv: string[]): Promise<number> {
  const config = loadConfig();
  const base = `http://${config.bind}:${config.port}`;
  let failures = 0;

  // 1. daemon reachable?
  try {
    const res = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(2000) });
    const body = (await res.json()) as { modelCount?: number };
    console.log(`✓ daemon      ok at ${base} (${body.modelCount ?? "?"} models)`);
  } catch {
    console.error(`✗ daemon      not reachable at ${base}`);
    console.error(`  fix: run "bansosd" in another terminal`);
    failures++;
  }

  // 2. per-harness config files.
  for (const adapter of ADAPTERS) {
    const found = adapter.configPaths
      .map(expandHome)
      .find((p) => fs.existsSync(p));

    if (!found) {
      console.log(`· ${adapter.id.padEnd(12)} not configured (bansos setup ${adapter.id})`);
      continue;
    }
    const content = fs.readFileSync(found, "utf8");
    if (content.includes(START_MARKER)) {
      console.log(`✓ ${adapter.id.padEnd(12)} configured (${found})`);
    } else {
      console.log(`· ${adapter.id.padEnd(12)} file exists but no bansos block (${found})`);
    }
  }

  return failures > 0 ? 1 : 0;
}
