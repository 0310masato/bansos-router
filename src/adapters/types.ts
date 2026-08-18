import type { WireProtocol } from "../protocols/internal";
import type { ModelDef } from "../upstreams/types";

export interface SetupContext {
  baseUrl: string;
  defaultModel: string;
  models: ModelDef[];
}

export interface ConfigWrite {
  path: string;
  content: string;
  // overwrite-block = wrapped in markers so --undo can remove it
  mode: "merge" | "overwrite-block";
  markers?: [string, string];
}

export interface HarnessAdapter {
  id: string;
  name: string;
  wire: WireProtocol;
  // candidate config locations; first existing wins (or create)
  configPaths: string[];
  // pure render; file writing happens in the cli (milestone M2)
  render(ctx: SetupContext): ConfigWrite[];
  undo(ctx: SetupContext): string[]; // paths that would be touched
  // for merge-mode writes: dotted keys that --undo removes
  undoKeys?: string[];
}

// standard marker pair used by every adapter
export const START_MARKER = "bansos-router:start";
export const END_MARKER = "bansos-router:end";
