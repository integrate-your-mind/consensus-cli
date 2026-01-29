import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export type ObservabilityConfig = {
  enabled: boolean;
  serviceName: string;
  serviceVersion: string;
  environment: string;
  otlpEndpoint: string | null;
  sampleRatio: number;
  metricIntervalMs: number;
  consoleFallback: boolean;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseBoolean(value: string | undefined): boolean {
  if (!value) return false;
  return value === "1" || value.toLowerCase() === "true" || value === "on";
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readPackageVersion(): string | undefined {
  try {
    const pkgPath = path.resolve(__dirname, "..", "..", "package.json");
    const raw = fs.readFileSync(pkgPath, "utf8");
    const data = JSON.parse(raw) as { version?: unknown; name?: unknown };
    return typeof data.version === "string" ? data.version : undefined;
  } catch {
    return undefined;
  }
}

export function readObservabilityConfig(): ObservabilityConfig {
  const env = process.env;
  const enabled = parseBoolean(env.CONSENSUS_OTEL_ENABLED);
  const serviceName = env.CONSENSUS_OTEL_SERVICE_NAME || "consensus-cli";
  const environment = env.CONSENSUS_OTEL_ENV || env.NODE_ENV || "development";
  const serviceVersion =
    env.CONSENSUS_OTEL_VERSION ||
    env.npm_package_version ||
    readPackageVersion() ||
    "unknown";
  const otlpEndpointRaw = env.CONSENSUS_OTEL_ENDPOINT || "";
  const otlpEndpoint = otlpEndpointRaw.trim() ? otlpEndpointRaw.trim() : null;
  const sampleRatio = clamp(
    parseNumber(env.CONSENSUS_OTEL_SAMPLE_RATIO, 1),
    0,
    1
  );
  const metricIntervalMs = Math.max(
    1000,
    parseNumber(env.CONSENSUS_OTEL_METRIC_INTERVAL_MS, 10000)
  );
  const consoleFallback = env.CONSENSUS_OTEL_CONSOLE_FALLBACK !== "0";

  return {
    enabled,
    serviceName,
    serviceVersion,
    environment,
    otlpEndpoint,
    sampleRatio,
    metricIntervalMs,
    consoleFallback,
  };
}
