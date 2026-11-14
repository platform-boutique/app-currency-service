import { pyroscopeTags, resolveTelemetryConfig, resourceAttributes } from '../src/telemetryConfig';

// ---------------------------------------------------------------------------
// Contract (pure)
// ---------------------------------------------------------------------------

const EP = 'http://alloy:4317';
const PY = 'http://pyroscope:4040';

describe('resolveTelemetryConfig() env matrix', () => {
  it.each([
    [{}, null],
    [{ OTEL_EXPORTER_OTLP_ENDPOINT: '' }, null],
    [{ OTEL_EXPORTER_OTLP_ENDPOINT: '   ' }, null],
    [{ OTEL_EXPORTER_OTLP_ENDPOINT: EP }, EP],
    [{ OTEL_EXPORTER_OTLP_ENDPOINT: ` ${EP} ` }, EP],
    [
      { OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otel.example.com:4317' },
      'https://otel.example.com:4317',
    ],
    // malformed: off, never a crash
    [{ OTEL_EXPORTER_OTLP_ENDPOINT: 'alloy:4317' }, null],
    [{ OTEL_EXPORTER_OTLP_ENDPOINT: 'alloy' }, null],
    [{ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://' }, null],
    [{ OTEL_EXPORTER_OTLP_ENDPOINT: 'ftp://alloy:4317' }, null],
    [{ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://alloy:99999' }, null],
    [{ OTEL_EXPORTER_OTLP_ENDPOINT: 'not a url' }, null],
    // OTEL_SDK_DISABLED=true (trimmed, any case) forces off
    [{ OTEL_EXPORTER_OTLP_ENDPOINT: EP, OTEL_SDK_DISABLED: 'true' }, null],
    [{ OTEL_EXPORTER_OTLP_ENDPOINT: EP, OTEL_SDK_DISABLED: 'TRUE' }, null],
    [{ OTEL_EXPORTER_OTLP_ENDPOINT: EP, OTEL_SDK_DISABLED: ' True ' }, null],
    [{ OTEL_EXPORTER_OTLP_ENDPOINT: EP, OTEL_SDK_DISABLED: 'false' }, EP],
    [{ OTEL_EXPORTER_OTLP_ENDPOINT: EP, OTEL_SDK_DISABLED: '' }, EP],
    // the legacy switches are gone
    [{ COLLECTOR_SERVICE_ADDR: 'alloy:4317' }, null],
    [{ COLLECTOR_SERVICE_ADDR: 'b:4317', OTEL_EXPORTER_OTLP_ENDPOINT: EP }, EP],
    [{ OTEL_EXPORTER_OTLP_ENDPOINT: EP, ENABLE_TRACING: '0' }, EP],
  ])('%j -> otlpEndpoint %j', (env, expected) => {
    expect(resolveTelemetryConfig(env).otlpEndpoint).toBe(expected);
  });

  it.each([
    [{}, null],
    [{ PYROSCOPE_ADDR: '' }, null],
    [{ PYROSCOPE_ADDR: PY }, PY],
    [{ PYROSCOPE_ADDR: PY, ENABLE_PROFILING: '1' }, PY],
    [{ ENABLE_PROFILING: '1' }, null], // no default address
    [{ PYROSCOPE_ADDR: PY, ENABLE_PROFILING: '0' }, null],
    [{ PYROSCOPE_ADDR: 'pyroscope:4040' }, null],
    [{ PYROSCOPE_ADDR: 'http://' }, null],
    [{ PYROSCOPE_ADDR: PY, OTEL_SDK_DISABLED: 'true' }, null], // forces everything off
    [{ PYROSCOPE_ADDR: PY, OTEL_SDK_DISABLED: 'false' }, PY],
  ])('%j -> pyroscopeAddr %j', (env, expected) => {
    expect(resolveTelemetryConfig(env).pyroscopeAddr).toBe(expected);
  });

  it('defaults', () => {
    const c = resolveTelemetryConfig({ HOSTNAME: 'pod-1' });
    expect(c.serviceName).toBe('currency-service');
    expect(c.serviceVersion).toBe('dev');
    expect(c.serviceCommit).toBe('unknown');
    expect(c.metricExportIntervalMs).toBe(15000);
    expect(c.telemetryReason).toMatch(/^off/);
    expect(c.profilingReason).toMatch(/^off/);
  });

  it('resource attributes and Pyroscope tags', () => {
    const c = resolveTelemetryConfig({ HOSTNAME: 'pod-1' });
    expect(resourceAttributes(c)).toEqual({
      'service.name': 'currency-service',
      'service.version': 'dev',
      'service.namespace': 'everly',
      'deployment.environment': 'local',
      'service.instance.id': 'pod-1',
    });
    const d = resolveTelemetryConfig({
      SERVICE_VERSION: '1.2.3',
      DEPLOYMENT_ENVIRONMENT: 'dev',
      HOSTNAME: 'pod-2',
    });
    expect(resourceAttributes(d)['service.version']).toBe('1.2.3');
    expect(resourceAttributes(d)['deployment.environment']).toBe('dev');
    expect(pyroscopeTags(d)).toEqual({
      service_name: 'currency-service',
      version: '1.2.3',
      environment: 'dev',
    });
  });
});

// ---------------------------------------------------------------------------
// The telemetry module itself, with the SDK and profiler mocked
// ---------------------------------------------------------------------------

const TELEMETRY_VARS = [
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'COLLECTOR_SERVICE_ADDR',
  'OTEL_SDK_DISABLED',
  'ENABLE_TRACING',
  'PYROSCOPE_ADDR',
  'ENABLE_PROFILING',
  'DEPLOYMENT_ENVIRONMENT',
  'SERVICE_VERSION',
];

function loadTelemetry(env: Record<string, string>) {
  const saved = { ...process.env };
  for (const k of TELEMETRY_VARS) delete process.env[k];
  Object.assign(process.env, env);

  const nodeSdk = { start: jest.fn(), shutdown: jest.fn().mockResolvedValue(undefined) };
  const NodeSDK = jest.fn(() => nodeSdk);
  const Pyroscope = {
    init: jest.fn(),
    start: jest.fn(),
    stop: jest.fn().mockResolvedValue(undefined),
  };
  jest.doMock('@opentelemetry/sdk-node', () => ({ NodeSDK }));
  jest.doMock('@pyroscope/nodejs', () => ({ __esModule: true, default: Pyroscope }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mod: any;
  jest.isolateModules(() => {
    mod = require('../src/telemetry');
  });
  process.env = saved;
  return { mod, NodeSDK, nodeSdk, Pyroscope };
}

afterEach(() => {
  jest.dontMock('@opentelemetry/sdk-node');
  jest.dontMock('@pyroscope/nodejs');
});

describe('telemetry module', () => {
  it('off path: with everything unset no SDK or profiler is started, metrics are no-ops', async () => {
    const { mod, NodeSDK, Pyroscope } = loadTelemetry({});
    expect(NodeSDK).not.toHaveBeenCalled();
    expect(Pyroscope.init).not.toHaveBeenCalled();
    expect(Pyroscope.start).not.toHaveBeenCalled();
    expect(mod.sdk).toBeUndefined();
    expect(mod.telemetryEnabled).toBe(false);
    expect(mod.profilingEnabled).toBe(false);
    expect(() => mod.startRpcMetrics('Convert')(0)).not.toThrow();
    await mod.shutdownTelemetry();
    expect(Pyroscope.stop).not.toHaveBeenCalled();
  });

  it('on path: endpoint and Pyroscope set -> both started with the contract tags, shutdown flushes', async () => {
    const { mod, NodeSDK, nodeSdk, Pyroscope } = loadTelemetry({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:9',
      PYROSCOPE_ADDR: 'http://127.0.0.1:9',
      SERVICE_VERSION: '1.2.3',
      DEPLOYMENT_ENVIRONMENT: 'dev',
    });
    expect(NodeSDK).toHaveBeenCalledTimes(1);
    expect(nodeSdk.start).toHaveBeenCalledTimes(1);
    expect(Pyroscope.init).toHaveBeenCalledWith(
      expect.objectContaining({
        serverAddress: 'http://127.0.0.1:9',
        appName: 'currency-service',
        tags: { service_name: 'currency-service', version: '1.2.3', environment: 'dev' },
      }),
    );
    // the resource handed to the SDK carries the five contract attributes
    const resource = (
      NodeSDK.mock.calls as unknown as [{ resource: { attributes: Record<string, unknown> } }][]
    )[0][0].resource;
    expect(resource.attributes).toMatchObject({
      'service.name': 'currency-service',
      'service.version': '1.2.3',
      'service.namespace': 'everly',
      'deployment.environment': 'dev',
    });
    expect(typeof resource.attributes['service.instance.id']).toBe('string');

    await mod.shutdownTelemetry();
    expect(nodeSdk.shutdown).toHaveBeenCalled();
    expect(Pyroscope.stop).toHaveBeenCalled();
  });

  it('a hanging flush is cut off after the timeout', async () => {
    const { mod, nodeSdk } = loadTelemetry({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:9' });
    nodeSdk.shutdown.mockReturnValue(new Promise(() => undefined));
    jest.useFakeTimers();
    try {
      const p = mod.shutdownTelemetry(2000);
      await jest.advanceTimersByTimeAsync(2000);
      await p;
    } finally {
      jest.useRealTimers();
    }
  });

  it('OTEL_SDK_DISABLED=true keeps the SDK and the profiler off despite the addresses', () => {
    const { NodeSDK, Pyroscope } = loadTelemetry({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:9',
      PYROSCOPE_ADDR: 'http://127.0.0.1:9',
      OTEL_SDK_DISABLED: 'true',
    });
    expect(NodeSDK).not.toHaveBeenCalled();
    expect(Pyroscope.init).not.toHaveBeenCalled();
  });

  it('the legacy COLLECTOR_SERVICE_ADDR alone starts nothing', () => {
    const { NodeSDK } = loadTelemetry({ COLLECTOR_SERVICE_ADDR: 'alloy:4317' });
    expect(NodeSDK).not.toHaveBeenCalled();
  });
});
