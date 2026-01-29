import { Layer } from "effect";
import { NodeSdk } from "@effect/opentelemetry";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-base";
import {
  ConsoleMetricExporter,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { readObservabilityConfig } from "./config.js";

const config = readObservabilityConfig();

function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/\/$/, "");
}

function otlpUrl(endpoint: string, path: string): string {
  const normalized = normalizeEndpoint(endpoint);
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${normalized}${suffix}`;
}

function buildTraceExporter() {
  if (config.otlpEndpoint) {
    return new OTLPTraceExporter({
      url: otlpUrl(config.otlpEndpoint, "/v1/traces"),
    });
  }
  if (config.consoleFallback) {
    return new ConsoleSpanExporter();
  }
  return null;
}

function buildMetricExporter() {
  if (config.otlpEndpoint) {
    return new OTLPMetricExporter({
      url: otlpUrl(config.otlpEndpoint, "/v1/metrics"),
    });
  }
  if (config.consoleFallback) {
    return new ConsoleMetricExporter();
  }
  return null;
}

const traceExporter = buildTraceExporter();
const metricExporter = buildMetricExporter();
const exporterEnabled = Boolean(traceExporter) && Boolean(metricExporter);
const spanProcessor = traceExporter ? new BatchSpanProcessor(traceExporter) : null;
const metricReader = metricExporter
  ? new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: config.metricIntervalMs,
    })
  : null;
const sampler = new ParentBasedSampler({
  root: new TraceIdRatioBasedSampler(config.sampleRatio),
});

const resource = {
  serviceName: config.serviceName,
  serviceVersion: config.serviceVersion,
  attributes: {
    "deployment.environment": config.environment,
  },
};

export const observabilityConfig = config;
export const observabilityEnabled = config.enabled && exporterEnabled;

export const observabilityLayer = observabilityEnabled
  ? NodeSdk.layer(() => ({
      resource,
      spanProcessor: spanProcessor as BatchSpanProcessor,
      metricReader: metricReader as PeriodicExportingMetricReader,
      sampler,
    }))
  : Layer.empty;
