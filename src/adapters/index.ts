import type { HarnessAdapter, SetupContext, ConfigWrite } from "./types";
import { START_MARKER, END_MARKER } from "./types";

const tomlBlock = (): Pick<ConfigWrite, "mode" | "markers"> => ({
  mode: "overwrite-block",
  markers: [`# ${START_MARKER}`, `# ${END_MARKER}`],
});

const yamlBlock = (): Pick<ConfigWrite, "mode" | "markers"> => ({
  mode: "overwrite-block",
  markers: [`# ${START_MARKER}`, `# ${END_MARKER}`],
});

function claudeCodeAdapter(): HarnessAdapter {
  return {
    id: "claude-code",
    name: "Claude Code",
    wire: "anthropic",
    configPaths: ["~/.claude/settings.json"],
    render(ctx: SetupContext): ConfigWrite[] {
      const haikuModel = ctx.specificModel ? ctx.defaultModel : (ctx.models.find((m) => !m.reasoning)?.id ?? "mimo-v2.5-free");
      const env = {
        ANTHROPIC_BASE_URL: ctx.baseUrl.replace(/\/v1$/, ""),
        ANTHROPIC_AUTH_TOKEN: "bansos",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: haikuModel,
        ANTHROPIC_DEFAULT_SONNET_MODEL: ctx.defaultModel,
        ANTHROPIC_DEFAULT_OPUS_MODEL: ctx.defaultModel,
      };
      return [
        {
          path: "~/.claude/settings.json",
          content: `${JSON.stringify({ env }, null, 2)}\n`,
          mode: "merge",
        },
      ];
    },
    undo(): string[] {
      return ["~/.claude/settings.json"];
    },
    // keys bansos adds to settings.json (--undo removes only these)
    undoKeys: [
      "env.ANTHROPIC_BASE_URL",
      "env.ANTHROPIC_AUTH_TOKEN",
      "env.ANTHROPIC_DEFAULT_HAIKU_MODEL",
      "env.ANTHROPIC_DEFAULT_SONNET_MODEL",
      "env.ANTHROPIC_DEFAULT_OPUS_MODEL",
    ],
  };
}

function aiderAdapter(): HarnessAdapter {
  return {
    id: "aider",
    name: "Aider",
    wire: "chat",
    configPaths: ["~/.aider.conf.yml", ".aider.conf.yml"],
    render(ctx: SetupContext): ConfigWrite[] {
      const lines = [
        `# ${START_MARKER}`,
        `openai_api_base: ${ctx.baseUrl}`,
        `openai_api_key: bansos`,
        `model: ${ctx.defaultModel}`,
        `# ${END_MARKER}`,
      ];
      return [
        {
          path: "~/.aider.conf.yml",
          content: `${lines.join("\n")}\n`,
          ...yamlBlock(),
        },
      ];
    },
    undo(): string[] {
      return ["~/.aider.conf.yml"];
    },
  };
}

function opencodeAdapter(): HarnessAdapter {
  return {
    id: "opencode",
    name: "OpenCode",
    wire: "chat",
    configPaths: [
      "~/.config/opencode/opencode.json",
      "~/.config/opencode/opencode.jsonc",
      "opencode.json",
      "opencode.jsonc",
    ],
    render(ctx: SetupContext): ConfigWrite[] {
      const modelEntries: Record<string, Record<string, unknown>> = {};
      if (ctx.specificModel) {
        modelEntries[ctx.defaultModel] = {};
      } else {
        const list = ctx.models.length > 0 ? ctx.models : [{ id: ctx.defaultModel }];
        for (const m of list) {
          modelEntries[m.id] = {};
        }
      }

      const provider = {
        bansos: {
          npm: "@ai-sdk/openai-compatible",
          options: { baseURL: ctx.baseUrl },
          models: modelEntries,
        },
      };
      return [
        {
          path: "~/.config/opencode/opencode.json",
          content: `${JSON.stringify({ provider }, null, 2)}\n`,
          mode: "merge",
        },
      ];
    },
    undo(): string[] {
      return [
        "~/.config/opencode/opencode.json",
        "~/.config/opencode/opencode.jsonc",
        "opencode.json",
        "opencode.jsonc",
      ];
    },
    undoKeys: ["provider.bansos"],
  };
}

function codexAdapter(): HarnessAdapter {
  return {
    id: "codex",
    name: "Codex CLI",
    wire: "responses",
    configPaths: ["~/.codex/config.toml", ".codex/config.toml"],
    render(ctx: SetupContext): ConfigWrite[] {
      const toml = [
        `# ${START_MARKER}`,
        `model = "${ctx.defaultModel}"`,
        `model_provider = "bansos"`,
        "",
        `[model_providers.bansos]`,
        `name = "Bansos Router"`,
        `base_url = "${ctx.baseUrl}"`,
        `env_key = "BANSOS_API_KEY"`,
        `wire_api = "responses"`,
        `# ${END_MARKER}`,
      ];
      return [
        {
          path: "~/.codex/config.toml",
          content: `${toml.join("\n")}\n`,
          ...tomlBlock(),
        },
      ];
    },
    undo(): string[] {
      return ["~/.codex/config.toml"];
    },
  };
}

function hermesAdapter(): HarnessAdapter {
  return {
    id: "hermes",
    name: "Hermes (Nous)",
    wire: "chat",
    configPaths: ["~/.hermes/config.yaml"],
    render(ctx: SetupContext): ConfigWrite[] {
      const yaml = [
        `# ${START_MARKER}`,
        `model:`,
        `  provider: custom`,
        `  default: "${ctx.defaultModel}"`,
        `  base_url: "${ctx.baseUrl}"`,
        `# ${END_MARKER}`,
      ];
      return [
        {
          path: "~/.hermes/config.yaml",
          content: `${yaml.join("\n")}\n`,
          ...yamlBlock(),
        },
      ];
    },
    undo(): string[] {
      return ["~/.hermes/config.yaml"];
    },
  };
}

function gooseAdapter(): HarnessAdapter {
  return {
    id: "goose",
    name: "Goose",
    wire: "chat",
    configPaths: ["~/.config/goose/custom_providers/bansos.json"],
    render(ctx: SetupContext): ConfigWrite[] {
      const models = ctx.specificModel
        ? [{ name: ctx.defaultModel, context_limit: 256000 }]
        : (ctx.models.length > 0 ? ctx.models : [{ id: ctx.defaultModel, contextWindow: 256000 }]).map((m) => ({
            name: m.id,
            context_limit: m.contextWindow || 256000,
          }));

      const provider = {
        name: "bansos",
        engine: "openai",
        display_name: "Bansos Router",
        base_url: ctx.baseUrl,
        models,
      };
      return [
        {
          path: "~/.config/goose/custom_providers/bansos.json",
          content: `${JSON.stringify(provider, null, 2)}\n`,
          mode: "merge",
        },
      ];
    },
    undo(): string[] {
      return ["~/.config/goose/custom_providers/bansos.json"];
    },
    // file is dedicated to bansos; undo removes it entirely
    undoKeys: ["name", "engine", "display_name", "base_url", "models"],
  };
}

function openclawAdapter(): HarnessAdapter {
  return {
    id: "openclaw",
    name: "OpenClaw",
    wire: "chat",
    configPaths: [
      "~/.openclaw/config.json",
      "~/.openclaw/openclaw.json",
      "openclaw.json",
    ],
    render(ctx: SetupContext): ConfigWrite[] {
      const models = ctx.specificModel
        ? [{ id: ctx.defaultModel }]
        : (ctx.models.length > 0 ? ctx.models : [{ id: ctx.defaultModel }]).map((m) => ({
            id: m.id,
          }));

      const config = {
        models: {
          providers: {
            bansos: {
              baseUrl: ctx.baseUrl,
              models,
            },
          },
        },
      };
      return [
        {
          path: "~/.openclaw/config.json",
          content: `${JSON.stringify(config, null, 2)}\n`,
          mode: "merge",
        },
      ];
    },
    undo(): string[] {
      return [
        "~/.openclaw/config.json",
        "~/.openclaw/openclaw.json",
        "openclaw.json",
      ];
    },
    undoKeys: ["models.providers.bansos"],
  };
}

function antigravityAdapter(): HarnessAdapter {
  return {
    id: "antigravity",
    name: "Antigravity CLI",
    wire: "chat",
    configPaths: ["~/.config/antigravity/config.toml"],
    render(ctx: SetupContext): ConfigWrite[] {
      const toml = [
        `# ${START_MARKER}`,
        `base_url = "${ctx.baseUrl}"`,
        `model = "${ctx.defaultModel}"`,
        `api_key = "bansos"`,
        `# ${END_MARKER}`,
      ];
      return [
        {
          path: "~/.config/antigravity/config.toml",
          content: `${toml.join("\n")}\n`,
          ...tomlBlock(),
        },
      ];
    },
    undo(): string[] {
      return ["~/.config/antigravity/config.toml"];
    },
  };
}

function jcodeAdapter(): HarnessAdapter {
  return {
    id: "jcode",
    name: "JCode",
    wire: "chat",
    configPaths: ["~/.jcode/config.toml"],
    render(ctx: SetupContext): ConfigWrite[] {
      const toml = [
        `# ${START_MARKER}`,
        `default_provider = "bansos"`,
        `default_model = "${ctx.defaultModel}"`,
        "",
        `[providers.bansos]`,
        `type = "openai-compatible"`,
        `base_url = "${ctx.baseUrl}"`,
        `# ${END_MARKER}`,
      ];
      return [
        {
          path: "~/.jcode/config.toml",
          content: `${toml.join("\n")}\n`,
          ...tomlBlock(),
        },
      ];
    },
    undo(): string[] {
      return ["~/.jcode/config.toml"];
    },
  };
}

function nineRouterAdapter(): HarnessAdapter {
  return {
    id: "9router",
    name: "9Router",
    wire: "chat",
    configPaths: ["~/.9router/db.json"],
    render(ctx: SetupContext): ConfigWrite[] {
      const db = {
        providerNodes: [
          {
            id: "bansos",
            name: "Bansos Router",
            type: "custom",
            prefix: "bansos",
            apiType: "openai",
            baseUrl: ctx.baseUrl,
          },
        ],
        providerConnections: [
          {
            id: "bansos-default",
            provider: "bansos",
            authType: "api_key",
            name: "Bansos Router",
            priority: 1,
            isActive: true,
            apiKey: "bansos",
          },
        ],
      };
      return [
        {
          path: "~/.9router/db.json",
          content: `${JSON.stringify(db, null, 2)}\n`,
          mode: "merge",
        },
      ];
    },
    undo(): string[] {
      return ["~/.9router/db.json"];
    },
    undoKeys: [
      "providerNodes.bansos",
      "providerConnections.bansos-default",
    ],
  };
}

export const ADAPTERS: HarnessAdapter[] = [
  claudeCodeAdapter(),
  aiderAdapter(),
  opencodeAdapter(),
  codexAdapter(),
  hermesAdapter(),
  gooseAdapter(),
  openclawAdapter(),
  antigravityAdapter(),
  jcodeAdapter(),
  nineRouterAdapter(),
];

export function findAdapter(id: string): HarnessAdapter | undefined {
  return ADAPTERS.find((a) => a.id === id);
}
