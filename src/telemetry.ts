import { NodeSDK } from '@opentelemetry/sdk-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-grpc';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { GrpcInstrumentation } from '@opentelemetry/instrumentation-grpc';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import * as api from '@opentelemetry/api';
import { monitorEventLoopDelay } from 'perf_hooks';
import Pyroscope from '@pyroscope/nodejs';

import {
  pyroscopeTags,
  resolveTelemetryConfig,
  resourceAttributes,
  settleWithin,
} from './telemetryConfig';

// Telemetry contract: see telemetryConfig.ts. Unset = off: no localhost defaults.
export const telemetryConfig = resolveTelemetryConfig(process.env);
const SERVICE_NAME = telemetryConfig.serviceName;
const OTEL_ENDPOINT = telemetryConfig.otlpEndpoint ?? undefined;
const PYROSCOPE_ENDPOINT = telemetryConfig.pyroscopeAddr ?? undefined;
const METRIC_EXPORT_INTERVAL_MS = telemetryConfig.metricExportIntervalMs;

export const telemetryEnabled = OTEL_ENDPOINT !== undefined;
export const profilingEnabled = PYROSCOPE_ENDPOINT !== undefined;

function startSdk(endpoint: string): NodeSDK {
  const resource = resourceFromAttributes(resourceAttributes(telemetryConfig));

  // All three signals are pushed over OTLP/gRPC to the collector (Alloy), which fans out
  // to Tempo (traces), Mimir (metrics) and Loki (logs).
  const nodeSdk = new NodeSDK({
    resource,
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: endpoint }))],
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: endpoint }),
        exportIntervalMillis: METRIC_EXPORT_INTERVAL_MS,
      }),
    ],
    logRecordProcessors: [
      new BatchLogRecordProcessor({ exporter: new OTLPLogExporter({ url: endpoint }) }),
    ],
    // PinoInstrumentation forwards pino records to the OTel logs pipeline (OTLP records carry the active span).
    // The trace_id/span_id on stdout come from the logger's own mixin (logger.ts), so the instrumentation's
    // log correlation (extra trace_flags field, duplicate keys) is switched off.
    instrumentations: [
      new GrpcInstrumentation(),
      new PinoInstrumentation({ disableLogCorrelation: true }),
    ],
  });

  // Started on import — server.ts does `import './telemetry'` first, so the instrumentations
  // patch @grpc/grpc-js and pino before they are used.
  nodeSdk.start();
  return nodeSdk;
}

// With telemetry off the SDK is never started: the meters below are OpenTelemetry API no-ops.
const sdk: NodeSDK | undefined = OTEL_ENDPOINT ? startSdk(OTEL_ENDPOINT) : undefined;

// ---------------------------------------------------------------------------
// Custom gRPC server metrics
// The Node.js GrpcInstrumentation only produces traces, not metrics.
// We create manual instruments that match the OTel RPC semantic conventions
// so the Grafana dashboard can query them.
// ---------------------------------------------------------------------------

const meter = api.metrics.getMeter('currency-service-grpc');
const runtimeMeter = api.metrics.getMeter('currency-service-runtime');

const rpcServerDuration = meter.createHistogram('rpc_server_duration', {
  description: 'Duration of inbound gRPC calls in seconds',
  unit: 's',
  advice: {
    explicitBucketBoundaries: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  },
});

const rpcServerRequestsTotal = meter.createCounter('rpc_server_requests_total', {
  description: 'Total number of inbound gRPC calls',
});

const rpcServerActiveRequests = meter.createUpDownCounter('rpc_server_active_requests', {
  description: 'Number of in-flight gRPC calls',
});

// ---------------------------------------------------------------------------
// Node.js runtime metrics (observable gauges scraped on each /metrics request)
// ---------------------------------------------------------------------------

runtimeMeter
  .createObservableGauge('nodejs_process_resident_memory_bytes', {
    description: 'Resident memory size in bytes',
    unit: 'By',
  })
  .addCallback((obs) => {
    obs.observe(process.memoryUsage().rss);
  });

runtimeMeter
  .createObservableGauge('nodejs_heap_size_total_bytes', {
    description: 'V8 heap total size in bytes',
    unit: 'By',
  })
  .addCallback((obs) => {
    obs.observe(process.memoryUsage().heapTotal);
  });

runtimeMeter
  .createObservableGauge('nodejs_heap_size_used_bytes', {
    description: 'V8 heap used size in bytes',
    unit: 'By',
  })
  .addCallback((obs) => {
    obs.observe(process.memoryUsage().heapUsed);
  });

runtimeMeter
  .createObservableGauge('nodejs_external_memory_bytes', {
    description: 'V8 external memory in bytes',
    unit: 'By',
  })
  .addCallback((obs) => {
    obs.observe(process.memoryUsage().external);
  });

runtimeMeter
  .createObservableGauge('nodejs_array_buffers_bytes', {
    description: 'Memory allocated for ArrayBuffers and SharedArrayBuffers',
    unit: 'By',
  })
  .addCallback((obs) => {
    obs.observe(process.memoryUsage().arrayBuffers);
  });

runtimeMeter
  .createObservableGauge('nodejs_process_cpu_user_seconds', {
    description: 'CPU user time in seconds',
    unit: 's',
  })
  .addCallback((obs) => {
    obs.observe(process.cpuUsage().user / 1e6);
  });

runtimeMeter
  .createObservableGauge('nodejs_process_cpu_system_seconds', {
    description: 'CPU system time in seconds',
    unit: 's',
  })
  .addCallback((obs) => {
    obs.observe(process.cpuUsage().system / 1e6);
  });

runtimeMeter
  .createObservableGauge('nodejs_process_uptime_seconds', {
    description: 'Process uptime in seconds',
    unit: 's',
  })
  .addCallback((obs) => {
    obs.observe(process.uptime());
  });

// Event loop lag — sampled by Node's built-in histogram (cheap; a self-rescheduling setTimeout(0)
// loop would keep the process at ~25% CPU even when idle). Reported value = mean delay since the last scrape.
const eventLoopDelay = monitorEventLoopDelay({ resolution: 10 });
if (telemetryEnabled) eventLoopDelay.enable(); // nothing reads it with telemetry off

runtimeMeter
  .createObservableGauge('nodejs_eventloop_lag_seconds', {
    description: 'Event loop lag in seconds',
    unit: 's',
  })
  .addCallback((obs) => {
    const meanNs = eventLoopDelay.count > 0 ? eventLoopDelay.mean : 0;
    eventLoopDelay.reset();
    obs.observe(meanNs / 1e9);
  });

// Active handles and requests
runtimeMeter
  .createObservableGauge('nodejs_active_handles_total', {
    description: 'Number of active handles',
  })
  .addCallback((obs) => {
    obs.observe((process as any)._getActiveHandles?.().length ?? 0);
  });

runtimeMeter
  .createObservableGauge('nodejs_active_requests_total', {
    description: 'Number of active requests',
  })
  .addCallback((obs) => {
    obs.observe((process as any)._getActiveRequests?.().length ?? 0);
  });

/**
 * Call this at the start of each gRPC handler. Returns a function to call
 * when the handler finishes (pass the gRPC status code).
 */
export function startRpcMetrics(method: string): (grpcStatusCode: number) => void {
  const startTime = process.hrtime.bigint();
  const attrs = {
    rpc_system: 'grpc',
    rpc_service: 'hipstershop.CurrencyService',
    rpc_method: method,
  };

  rpcServerActiveRequests.add(1, attrs);

  return (grpcStatusCode: number) => {
    const elapsed = Number(process.hrtime.bigint() - startTime) / 1e9; // seconds
    const finalAttrs = {
      ...attrs,
      rpc_grpc_status_code: String(grpcStatusCode),
    };

    rpcServerDuration.record(elapsed, finalAttrs);
    rpcServerRequestsTotal.add(1, finalAttrs);
    rpcServerActiveRequests.add(-1, attrs);
  };
}

// --- Pyroscope continuous profiling (only when PYROSCOPE_ADDR is set) ---
if (PYROSCOPE_ENDPOINT) {
  Pyroscope.init({
    serverAddress: PYROSCOPE_ENDPOINT,
    appName: SERVICE_NAME,
    tags: pyroscopeTags(telemetryConfig),
  });
  Pyroscope.start();
}

/**
 * Flushes and stops the exporters and the profiler, waiting at most `timeoutMs` (an unreachable collector
 * must not hold the process). A no-op with telemetry and profiling off. Called by server.ts on SIGTERM.
 */
export async function shutdownTelemetry(timeoutMs = 2000): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  if (sdk) tasks.push(sdk.shutdown());
  if (PYROSCOPE_ENDPOINT) tasks.push(Pyroscope.stop());
  if (tasks.length === 0) return;
  await settleWithin(Promise.allSettled(tasks), timeoutMs);
}

export { sdk };
