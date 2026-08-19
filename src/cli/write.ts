import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function expandHome(p: string): string {
  if (p === "~") {
    return os.homedir();
  }
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

// robust zero-dependency JSONC / JSON parser (strips line/block comments & trailing commas)
export function parseJsonc(text: string): Record<string, unknown> {
  const clean = text.replace(/^\uFEFF/, "");
  let out = "";
  let inString = false;
  let quoteChar = "";
  let isEscaped = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]!;
    const next = clean[i + 1];

    if (inString) {
      out += ch;
      if (isEscaped) {
        isEscaped = false;
      } else if (ch === "\\") {
        isEscaped = true;
      } else if (ch === quoteChar) {
        inString = false;
      }
    } else {
      if (ch === '"' || ch === "'") {
        inString = true;
        quoteChar = ch;
        out += ch;
      } else if (ch === "/" && next === "/") {
        // line comment: skip until newline
        while (i < clean.length && clean[i] !== "\n") i++;
        if (i < clean.length) out += clean[i]; // preserve newline
      } else if (ch === "/" && next === "*") {
        // block comment: skip until */
        i += 2;
        while (i < clean.length && !(clean[i] === "*" && clean[i + 1] === "/")) i++;
        i++; // skip /
      } else {
        out += ch;
      }
    }
  }

  // strip trailing commas before } or ]
  out = out.replace(/,(\s*[}\]])/g, "$1");

  return JSON.parse(out) as Record<string, unknown>;
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
    } else if (Array.isArray(v) && Array.isArray(target[k])) {
      const targetArr = target[k] as unknown[];
      for (const item of v) {
        if (item && typeof item === "object" && "id" in item) {
          const idx = targetArr.findIndex(
            (t) => t && typeof t === "object" && (t as Record<string, unknown>).id === (item as Record<string, unknown>).id,
          );
          if (idx >= 0) {
            targetArr[idx] = item;
          } else {
            targetArr.push(item);
          }
        } else {
          targetArr.push(item);
        }
      }
    } else {
      target[k] = v;
    }
  }
}

// merge a rendered json/jsonc fragment into the existing file (valid formatted json out)
export function applyMergeWrite(existing: string | null, content: string): string {
  const patch = parseJsonc(content);
  const base = existing && existing.trim().length > 0 ? parseJsonc(existing) : {};
  deepMerge(base, patch);
  return `${JSON.stringify(base, null, 2)}\n`;
}

// delete dotted keys (e.g. "env.ANTHROPIC_BASE_URL" or "providerNodes.bansos") from a parsed json object
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
      const last = parts[parts.length - 1]!;
      if (Array.isArray(cur)) {
        const idx = cur.findIndex((item) => item && typeof item === "object" && (item as Record<string, unknown>).id === last);
        if (idx >= 0) cur.splice(idx, 1);
      } else {
        delete (cur as Record<string, unknown>)[last];
      }
    }
  }
}

export function writeConfig(p: string, content: string): void {
  const full = expandHome(p);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}
