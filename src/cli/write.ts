import fs from "node:fs";
import path from "node:path";

export function expandHome(p: string): string {
  return p.startsWith("~/") ? `${process.env.HOME ?? ""}/${p.slice(2)}` : p;
}

function markerBlock(content: string, markers: [string, string]): string {
  if (content.includes(markers[0])) return `${content.replace(/\s+$/, "")}\n`;
  return `${markers[0]}\n${content.replace(/\s+$/, "")}\n${markers[1]}\n`;
}

function findBlock(
  lines: string[],
  start: string,
  end: string,
): [number, number] | null {
  const si = lines.findIndex((l) => l.includes(start));
  const ei = lines.findIndex((l) => l.includes(end));
  if (si === -1 || ei === -1 || ei < si) return null;
  return [si, ei];
}

// replace the marked block if present, otherwise append it
export function applyBlockWrite(
  existing: string,
  content: string,
  markers: [string, string],
): string {
  const block = markerBlock(content, markers);
  const lines = existing.split("\n");
  const span = findBlock(lines, markers[0], markers[1]);
  if (span) {
    const [si, ei] = span;
    const head = lines.slice(0, si).join("\n").replace(/\s+$/, "");
    const tail = lines.slice(ei + 1).join("\n").replace(/^\s+/, "");
    const parts = [head, block.replace(/\s+$/, ""), tail].filter((s) => s !== "");
    return `${parts.join("\n\n")}\n`;
  }
  const base = existing.replace(/\s+$/, "");
  return base ? `${base}\n\n${block}` : block;
}

// remove the marked block (markers inclusive)
export function removeBlock(
  existing: string,
  markers: [string, string],
): string {
  const lines = existing.split("\n");
  const span = findBlock(lines, markers[0], markers[1]);
  if (!span) return existing;
  const [si, ei] = span;
  const head = lines.slice(0, si).join("\n").replace(/\s+$/, "");
  const tail = lines.slice(ei + 1).join("\n").replace(/^\s+/, "");
  return `${[head, tail].filter((s) => s !== "").join("\n\n")}\n`;
}

function deepMerge(target: Record<string, unknown>, patch: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(patch)) {
    if (
      v !== null && typeof v === "object" && !Array.isArray(v) &&
      target[k] !== null && typeof target[k] === "object" && !Array.isArray(target[k])
    ) {
      deepMerge(target[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      target[k] = v;
    }
  }
}

// merge a rendered json fragment into the existing file (valid json out)
export function applyMergeWrite(existing: string | null, content: string): string {
  const patch = JSON.parse(content) as Record<string, unknown>;
  const base = existing ? (JSON.parse(existing) as Record<string, unknown>) : {};
  deepMerge(base, patch);
  return `${JSON.stringify(base, null, 2)}\n`;
}

// delete dotted keys (e.g. "env.ANTHROPIC_BASE_URL") from a parsed json object
export function removeKeys(obj: Record<string, unknown>, keys: string[]): void {
  for (const kp of keys) {
    const parts = kp.split(".");
    let cur: unknown = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i]!;
      cur = (cur as Record<string, unknown> | undefined)?.[p];
      if (!cur || typeof cur !== "object") break;
    }
    if (cur && typeof cur === "object") {
      delete (cur as Record<string, unknown>)[parts[parts.length - 1]!];
    }
  }
}

export function writeConfig(p: string, content: string): void {
  const full = expandHome(p);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}
