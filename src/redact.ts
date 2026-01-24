const REDACT_ENABLED = process.env.CONSENSUS_REDACT_PII !== "0";

const HOME_PATTERNS = [
  /\/Users\/[^/\s]+/g,
  /\/home\/[^/\s]+/g,
  /C:\\Users\\[^\\\s]+/gi,
];

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function redactText(value?: string): string | undefined {
  if (!value || !REDACT_ENABLED) return value;
  let output = value;
  for (const pattern of HOME_PATTERNS) {
    output = output.replace(pattern, "~");
  }
  output = output.replace(EMAIL_PATTERN, "<redacted-email>");
  return output;
}

export function isRedactionEnabled(): boolean {
  return REDACT_ENABLED;
}
