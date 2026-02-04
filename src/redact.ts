const REDACT_ENABLED = process.env.CONSENSUS_REDACT_PII !== "0";
const REDACT_STRICT = process.env.CONSENSUS_REDACT_STRICT === "1";

const HOME_PATTERNS = [
  /\/Users\/[^/\s]+/g,
  /\/home\/[^/\s]+/g,
  /C:\\Users\\[^\\\s]+/gi,
];

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const KEY_VALUE_PATTERN =
  /\b(password|passwd|pwd|api[_-]?key|api[_-]?token|access[_-]?token|auth[_-]?token|secret|client[_-]?secret|session[_-]?token)\b\s*[:=]\s*([^\s,;]+)/gi;
const JSON_KEY_PATTERN =
  /(\"(?:password|passwd|pwd|api[_-]?key|api[_-]?token|access[_-]?token|auth[_-]?token|secret|client[_-]?secret|session[_-]?token)\"\\s*:\\s*\")([^\"]+)(\")/gi;
const STRICT_PATTERNS: Array<[RegExp, string]> = [
  [/AKIA[0-9A-Z]{16}/g, "<redacted-aws-key>"],
  [/ASIA[0-9A-Z]{16}/g, "<redacted-aws-key>"],
  [/ghp_[A-Za-z0-9]{36,}/g, "<redacted-github-token>"],
  [/gho_[A-Za-z0-9]{36,}/g, "<redacted-github-token>"],
  [/github_pat_[A-Za-z0-9_]{20,}/g, "<redacted-github-token>"],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/g, "<redacted-slack-token>"],
  [/sk-[A-Za-z0-9]{20,}/g, "<redacted-openai-key>"],
  [/AIza[0-9A-Za-z\\-_]{30,}/g, "<redacted-gcp-key>"],
  [/eyJ[A-Za-z0-9_=-]+\\.[A-Za-z0-9._=-]+\\.[A-Za-z0-9._=-]+/g, "<redacted-jwt>"],
  [
    /-----BEGIN (?:RSA|EC|DSA|OPENSSH|PGP) PRIVATE KEY-----[\\s\\S]+?-----END (?:RSA|EC|DSA|OPENSSH|PGP) PRIVATE KEY-----/g,
    "<redacted-private-key>",
  ],
  [/Bearer\\s+[A-Za-z0-9._=-]+/gi, "Bearer <redacted-token>"],
];

export function redactText(value?: string): string | undefined {
  if (!value || !REDACT_ENABLED) return value;
  let output = value;
  for (const pattern of HOME_PATTERNS) {
    output = output.replace(pattern, "~");
  }
  output = output.replace(EMAIL_PATTERN, "<redacted-email>");
  if (!REDACT_STRICT) return output;
  output = output.replace(KEY_VALUE_PATTERN, (_match, key: string) => {
    return `${key}=<redacted>`;
  });
  output = output.replace(JSON_KEY_PATTERN, (_match, prefix: string, _value: string, suffix: string) => {
    return `${prefix}<redacted>${suffix}`;
  });
  for (const [pattern, replacement] of STRICT_PATTERNS) {
    output = output.replace(pattern, replacement);
  }
  return output;
}

export function isRedactionEnabled(): boolean {
  return REDACT_ENABLED;
}
