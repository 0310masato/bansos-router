export type SecretType =
  | "openai_api_key"
  | "anthropic_api_key"
  | "github_pat"
  | "aws_access_key"
  | "private_key"
  | "ssh_private_key"
  | "credential_assignment";

export interface SecretScanResult {
  blocked: boolean;
  secretTypes: SecretType[];
}

const KNOWN_SECRET_PATTERNS: ReadonlyArray<{
  type: SecretType;
  pattern: RegExp;
}> = [
  {
    type: "anthropic_api_key",
    pattern: /\bsk-ant-(?:api\d{2}-)?[A-Za-z0-9_-]{16,}\b/,
  },
  {
    type: "openai_api_key",
    pattern: /\bsk-(?!ant-)(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/,
  },
  {
    type: "github_pat",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
  },
  {
    type: "aws_access_key",
    pattern: /\b(?:AKIA|ASIA|AIDA|AROA|AIPA|ANPA|ANVA|ASCA)[A-Z0-9]{16}\b/,
  },
  {
    type: "ssh_private_key",
    pattern: /-----BEGIN (?:OPENSSH PRIVATE KEY|SSH2 ENCRYPTED PRIVATE KEY)-----/,
  },
  {
    type: "private_key",
    pattern: /-----BEGIN (?:RSA |EC |DSA |PKCS8 |ENCRYPTED )?PRIVATE KEY-----/,
  },
];

const SENSITIVE_KEYS = new Set([
  "password",
  "passwd",
  "pwd",
  "token",
  "accesstoken",
  "authtoken",
  "refreshtoken",
  "apikey",
  "secret",
  "clientsecret",
  "signingsecret",
]);

const INLINE_ASSIGNMENT =
  /\b(password|passwd|pwd|token|access[_-]?token|auth[_-]?token|refresh[_-]?token|api[_-]?key|secret|client[_-]?secret|signing[_-]?secret)\b\s*[:=]\s*(?:"([^"]+)"|'([^']+)'|([^\s,;]+))/gi;

const PLACEHOLDER_VALUE = /^(?:example|sample|test|dummy|placeholder|redacted|masked|changeme|password|secret|token|api[_-]?key|your(?:[-_ ].+)?|none|null|undefined|bansos|x+|\*+|<[^>]+>|\$\{[^}]+\}|process\.env\.[A-Za-z0-9_]+)$/i;

function isLikelyCredentialValue(value: string): boolean {
  const clean = value.trim().replace(/^["']|["']$/g, "");
  if (clean.length < 8 || PLACEHOLDER_VALUE.test(clean)) return false;
  if (/\s/.test(clean) && clean.length < 16) return false;
  return true;
}

function inspectString(value: string, found: Set<SecretType>): void {
  for (const { type, pattern } of KNOWN_SECRET_PATTERNS) {
    if (pattern.test(value)) found.add(type);
  }

  INLINE_ASSIGNMENT.lastIndex = 0;
  for (let match = INLINE_ASSIGNMENT.exec(value); match; match = INLINE_ASSIGNMENT.exec(value)) {
    const assigned = match[2] ?? match[3] ?? match[4] ?? "";
    if (isLikelyCredentialValue(assigned)) found.add("credential_assignment");
  }
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function inspectValue(
  value: unknown,
  found: Set<SecretType>,
  seen: WeakSet<object>,
  key?: string,
): void {
  if (typeof value === "string") {
    inspectString(value, found);
    if (key && SENSITIVE_KEYS.has(normalizeKey(key)) && isLikelyCredentialValue(value)) {
      found.add("credential_assignment");
    }
    return;
  }

  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) inspectValue(item, found, seen);
    return;
  }

  for (const [childKey, childValue] of Object.entries(value)) {
    inspectValue(childValue, found, seen, childKey);
  }
}

export function scanRequestBody(body: unknown): SecretScanResult {
  let parsed = body;
  if (typeof body === "string") {
    try {
      parsed = JSON.parse(body) as unknown;
    } catch {
      parsed = body;
    }
  }

  const found = new Set<SecretType>();
  inspectValue(parsed, found, new WeakSet<object>());
  const secretTypes = [...found].sort();
  return { blocked: secretTypes.length > 0, secretTypes };
}
