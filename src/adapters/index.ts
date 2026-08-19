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
      const env = {
        ANTHROPIC_BASE_URL: ctx.baseUrl.replace(/\/v1$/, ""),
        ANTHROPIC_AUTH_TOKEN: "bansos",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: ctx.defaultModel,
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
    configPaths: ["~/.config/opencode/opencode.json", "opencode.json"],
    render(ctx: SetupContext): ConfigWrite[] {
      const provider = {
        bansos: {
          npm: "@ai-sdk/openai-compatible",
          options: { baseURL: ctx.baseUrl },
          models: { [ctx.defaultModel]: {} },
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
      return ["~/.config/opencode/opencode.json"];
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
      const provider = {
        name: "bansos",
        engine: "openai",
        display_name: "Bansos Router",
        base_url: ctx.baseUrl,
        models: [{ name: ctx.defaultModel, context_limit: 256000 }],
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
    configPaths: ["~/.openclaw/config.json"],
    render(ctx: SetupContext): ConfigWrite[] {
      const config = {
        models: {
          providers: {
            bansos: {
              baseUrl: ctx.baseUrl,
              models: [{ id: ctx.defaultModel }],
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
      return ["~/.openclaw/config.json"];
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
