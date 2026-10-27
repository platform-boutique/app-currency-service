// Telemetry contract (same as the Go services), kept free of SDK imports so it can be unit tested:
// - traces, metrics and logs are exported over OTLP/gRPC only when OTEL_EXPORTER_OTLP_ENDPOINT (or the legacy
//   COLLECTOR_SERVICE_ADDR, host:port) is set and non-empty; OTEL_SDK_DISABLED=true (or the legacy
//   ENABLE_TRACING=0) forces it off;
// - profiling (Pyroscope) is on only when PYROSCOPE_ADDR is set and non-empty and ENABLE_PROFILING is not "0".

type Env = Record<string, string | undefined>;

const value = (env: Env, name: string): string => (env[name] ?? '').trim();

/** OTLP/gRPC endpoint (scheme included), or undefined when telemetry is off. */
export function otlpEndpoint(env: Env): string | undefined {
  if (
    value(env, 'OTEL_SDK_DISABLED').toLowerCase() === 'true' ||
    value(env, 'ENABLE_TRACING') === '0'
  ) {
    return undefined;
  }
  const endpoint = value(env, 'OTEL_EXPORTER_OTLP_ENDPOINT');
  if (endpoint) return endpoint;
  const legacy = value(env, 'COLLECTOR_SERVICE_ADDR');
  return legacy ? `http://${legacy}` : undefined;
}

/** Pyroscope server address, or undefined when profiling is off. */
export function pyroscopeAddress(env: Env): string | undefined {
  const addr = value(env, 'PYROSCOPE_ADDR');
  if (!addr || value(env, 'ENABLE_PROFILING') === '0') return undefined;
  return addr;
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
