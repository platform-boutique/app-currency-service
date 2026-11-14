import { hostname } from 'os';

/**
 * Uniform telemetry contract (pure: reads only the env object it is given).
 *
 * - Traces, metrics and logs over OTLP are ON only if OTEL_EXPORTER_OTLP_ENDPOINT is a valid
 *   absolute http(s) URL. Empty or malformed means off (never a crash). OTEL_SDK_DISABLED=true
 *   (trimmed, any case) forces EVERYTHING off, profiling included.
 * - Profiling (Pyroscope) is ON only if PYROSCOPE_ADDR is a valid absolute http(s) URL and
 *   ENABLE_PROFILING is not 0. There is no default address; ENABLE_PROFILING=1 alone starts nothing.
 *
 * The legacy COLLECTOR_SERVICE_ADDR and ENABLE_TRACING are not read any more.
 * With nothing set, both are off and nothing tries to connect anywhere.
 */
export interface TelemetryConfig {
  serviceName: string;
  serviceVersion: string;
  /** Commit id from SERVICE_COMMIT, or "unknown". */
  serviceCommit: string;
  deploymentEnvironment: string;
  /** Hostname (the pod name in Kubernetes). */
  instanceId: string;
  /** OTLP/gRPC endpoint, or null when telemetry is off. */
  otlpEndpoint: string | null;
  /** Pyroscope server address, or null when profiling is off. */
  pyroscopeAddr: string | null;
  metricExportIntervalMs: number;
  /** Human-readable reason for the on/off decisions, for the startup log. */
  telemetryReason: string;
  profilingReason: string;
}

type Env = Record<string, string | undefined>;

export const SERVICE_NAMESPACE = 'everly';

const nonEmpty = (v: string | undefined): string | undefined =>
  v !== undefined && v.trim() !== '' ? v.trim() : undefined;

const isOff = (v: string | undefined): boolean =>
  v !== undefined && ['0', 'false'].includes(v.trim().toLowerCase());

/** True for an absolute http(s) URL with a host and a valid port. */
export function isValidHttpUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const u = new URL(value);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname !== '';
  } catch {
    return false;
  }
}

export function resolveTelemetryConfig(env: Env): TelemetryConfig {
  const sdkDisabled = (env.OTEL_SDK_DISABLED ?? '').trim().toLowerCase() === 'true';

  const endpoint = nonEmpty(env.OTEL_EXPORTER_OTLP_ENDPOINT);
  let otlpEndpoint: string | null = null;
  let telemetryReason: string;
  if (sdkDisabled) {
    telemetryReason = 'off: OTEL_SDK_DISABLED=true';
  } else if (!endpoint) {
    telemetryReason = 'off: no OTEL_EXPORTER_OTLP_ENDPOINT';
  } else if (!isValidHttpUrl(endpoint)) {
    telemetryReason = 'off: OTEL_EXPORTER_OTLP_ENDPOINT is not an absolute http(s) URL';
  } else {
    otlpEndpoint = endpoint;
    telemetryReason = `on: ${endpoint}`;
  }

  const pyro = nonEmpty(env.PYROSCOPE_ADDR);
  let pyroscopeAddr: string | null = null;
  let profilingReason: string;
  if (sdkDisabled) {
    profilingReason = 'off: OTEL_SDK_DISABLED=true';
  } else if (isOff(env.ENABLE_PROFILING)) {
    profilingReason = 'off: ENABLE_PROFILING=0';
  } else if (!pyro) {
    profilingReason = 'off: no PYROSCOPE_ADDR';
  } else if (!isValidHttpUrl(pyro)) {
    profilingReason = 'off: PYROSCOPE_ADDR is not an absolute http(s) URL';
  } else {
    pyroscopeAddr = pyro;
    profilingReason = `on: ${pyro}`;
  }

  const interval = parseInt(env.OTEL_METRIC_EXPORT_INTERVAL ?? '', 10);
  return {
    serviceName: nonEmpty(env.OTEL_SERVICE_NAME) ?? 'currency-service',
    serviceVersion: nonEmpty(env.SERVICE_VERSION) ?? 'dev',
    serviceCommit: nonEmpty(env.SERVICE_COMMIT) ?? 'unknown',
    deploymentEnvironment: nonEmpty(env.DEPLOYMENT_ENVIRONMENT) ?? 'local',
    instanceId: nonEmpty(env.HOSTNAME) ?? hostname(),
    otlpEndpoint,
    pyroscopeAddr,
    metricExportIntervalMs: Number.isFinite(interval) && interval > 0 ? interval : 15000,
    telemetryReason,
    profilingReason,
  };
}

/** Resource attributes of every signal (OBS-02). */
export function resourceAttributes(c: TelemetryConfig): Record<string, string> {
  return {
    'service.name': c.serviceName,
    'service.version': c.serviceVersion,
    'service.namespace': SERVICE_NAMESPACE,
    'deployment.environment': c.deploymentEnvironment,
    'service.instance.id': c.instanceId,
  };
}

/** Pyroscope tags (OBS-40). */
export function pyroscopeTags(c: TelemetryConfig): Record<string, string> {
  return {
    service_name: c.serviceName,
    version: c.serviceVersion,
    environment: c.deploymentEnvironment,
  };
}

/** Resolves after `promise` settles or after `ms`, whichever comes first (never rejects). */
export async function settleWithin(promise: Promise<unknown>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  try {
    await Promise.race([promise.then(noop, noop), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function noop(): void {}
