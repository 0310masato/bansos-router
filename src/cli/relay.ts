import { deployVercelRelay } from "../relay/vercel";
import {
  addRelay,
  loadRelayState,
  removeRelay,
  saveRelayState,
} from "../relay/egress";

function usage(): void {
  console.log(`bansos relay <command>

Commands:
  on / off                toggle relay egress (live)
  status                  show state, active relay, saved relays
  url <URL>               add a relay to the saved list
  use <URL>               switch to a relay and enable it
  list                    show saved relays (★ = active)
  remove <URL>            forget a saved relay
  deploy                  deploy a fresh Vercel relay (M4, stubbed)
`);
}

export async function runRelay(argv: string[]): Promise<number> {
  const cmd = argv[0];
  const state = loadRelayState();

  switch (cmd) {
    case "on": {
      if (!state.url) {
        console.error("no active relay — add one first: bansos relay url <URL>");
        return 1;
      }
      saveRelayState({ ...state, enabled: true });
      console.log(`relay enabled → ${state.url}`);
      return 0;
    }
    case "off": {
      saveRelayState({ ...state, enabled: false });
      console.log("relay disabled (direct egress)");
      return 0;
    }
    case "status": {
      console.log(`enabled: ${state.enabled ? "on" : "off"}`);
      console.log(`active:  ${state.url || "(none)"}`);
      console.log(`saved:   ${state.relays.length}`);
      return 0;
    }
    case "url": {
      const url = argv[1];
      if (!url) return usage(), 1;
      addRelay(state, url, "manual");
      saveRelayState(state);
      console.log(`saved: ${url}`);
      return 0;
    }
    case "use": {
      const url = argv[1];
      if (!url) return usage(), 1;
      addRelay(state, url, "manual");
      saveRelayState({ ...state, url, enabled: true });
      console.log(`active & enabled: ${url}`);
      return 0;
    }
    case "list": {
      for (const r of state.relays) {
        console.log(`${r.url === state.url ? "★" : " "} ${r.url}${r.label ? `  [${r.label}]` : ""}`);
      }
      return 0;
    }
    case "remove": {
      const url = argv[1];
      if (!url) return usage(), 1;
      if (state.url === url) {
        console.error("can't remove the active relay — switch first (bansos relay use <URL>)");
        return 1;
      }
      saveRelayState(removeRelay(state, url));
      console.log(`removed: ${url}`);
      return 0;
    }
    case "deploy": {
      // TODO(M4): prompt for a Vercel token (one-shot, never stored).
      void deployVercelRelay;
      console.log("deploy lands in M4 — bring your own relay for now:");
      console.log("  bansos relay use https://<your-relay>.vercel.app");
      return 0;
    }
    case "help":
    case "-h":
    case undefined:
      usage();
      return 0;
    default:
      console.error(`bansos relay: unknown command "${cmd}"`);
      usage();
      return 1;
  }
}
