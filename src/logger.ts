

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(prefix: string): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  json?: boolean;
  prefix?: string;
}

export function createLogger(opts: LoggerOptions = {}): Logger {
  const level = opts.level ?? "info";
  const json = opts.json ?? process.env.BANSOS_LOG === "json";
  const prefix = opts.prefix ?? "";

  const write = (lvl: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    if (LEVEL_ORDER[lvl] < LEVEL_ORDER[level]) return;
    const line = prefix ? `[${prefix}] ${msg}` : msg;
    if (json) {
      process.stdout.write(
        `${JSON.stringify({ level: lvl, msg, ...(fields ?? {}) })}\n`,
      );
    } else {
      const tag = lvl === "error" ? "✗" : lvl === "warn" ? "⚠" : lvl === "debug" ? "·" : "✓";
      process.stdout.write(`${tag} ${line}\n`);
    }
  };

  return {
    debug: (m, f) => write("debug", m, f),
    info: (m, f) => write("info", m, f),
    warn: (m, f) => write("warn", m, f),
    error: (m, f) => write("error", m, f),
    child: (p) => createLogger({ level, json, prefix: p }),
  };
}
