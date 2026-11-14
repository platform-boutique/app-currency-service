import { spawn } from 'child_process';
import { createServer, type Socket } from 'net';
import path from 'path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { settleWithin } from '../src/telemetryConfig';

describe('settleWithin()', () => {
  it('returns when the promise settles', async () => {
    await expect(settleWithin(Promise.resolve(1), 1000)).resolves.toBeUndefined();
    await expect(settleWithin(Promise.reject(new Error('x')), 1000)).resolves.toBeUndefined();
  });

  it('gives up after the timeout', async () => {
    const started = Date.now();
    await settleWithin(new Promise(() => undefined), 50);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

// ---------------------------------------------------------------------------
// Real process: JSON log shape, trace correlation, JSON startup failure, SIGTERM, blackholed collector
// ---------------------------------------------------------------------------

const ROOT = path.join(__dirname, '..');
const TELEMETRY_VARS = [
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'COLLECTOR_SERVICE_ADDR',
  'OTEL_SDK_DISABLED',
  'ENABLE_TRACING',
  'PYROSCOPE_ADDR',
  'ENABLE_PROFILING',
  'LOG_LEVEL',
  'SERVICE_VERSION',
];
const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

function start(extra: Record<string, string>) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of TELEMETRY_VARS) delete env[name];
  // Set by VS Code terminals; makes node-gyp-build look for an Electron build of the pprof native module.
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    process.execPath,
    ['-r', 'ts-node/register/transpile-only', 'src/server.ts'],
    { cwd: ROOT, env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (err += d));
  const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
  const waitFor = async (text: string, ms = 30000) => {
    const end = performance.now() + ms; // monotonic: the host wall clock jumps
    while (!out.includes(text)) {
      if (performance.now() > end)
        throw new Error(`timeout waiting for ${text}; out=${out} err=${err}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  // every line must be JSON
  const lines = () =>
    out
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  return { child, exited, waitFor, lines, stderr: () => err };
}

function client(port: number) {
  const proto = grpc.loadPackageDefinition(
    protoLoader.loadSync(path.join(ROOT, 'proto/currency.proto'), { keepCase: true }),
  ) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  return new proto.hipstershop.CurrencyService(
    `127.0.0.1:${port}`,
    grpc.credentials.createInsecure(),
  );
}

function convert(c: any, md?: grpc.Metadata): Promise<void> {
  // eslint-disable-line @typescript-eslint/no-explicit-any
  return new Promise<void>((resolve, reject) =>
    c.convert(
      { from: { currency_code: 'EUR', units: 10, nanos: 0 }, to_code: 'USD' },
      md ?? new grpc.Metadata(),
      (err: Error | null) => (err ? reject(err) : resolve()),
    ),
  );
}

describe('server process', () => {
  it('telemetry off: JSON shape without trace ids, SIGTERM exits 0 promptly', async () => {
    const port = await freePort();
    const p = start({ PORT: String(port) });
    try {
      await p.waitFor('"starting"');
      const c = client(port);
      const codes = await new Promise<string[]>((resolve, reject) =>
        c.getSupportedCurrencies({}, (err: Error | null, res: { currency_codes: string[] }) =>
          err ? reject(err) : resolve(res.currency_codes),
        ),
      );
      expect(codes).toContain('EUR');
      await convert(c);
      c.close();

      const signalledAt = performance.now();
      p.child.kill('SIGTERM');
      expect(await p.exited).toBe(0);
      expect(performance.now() - signalledAt).toBeLessThan(5000); // 2 s drain + 2 s flush at most
      expect(p.stderr()).toBe(''); // nothing noisy with telemetry off

      const lines = p.lines();
      for (const l of lines) {
        expect(l).toEqual(
          expect.objectContaining({
            timestamp: expect.stringMatching(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/),
            service: 'currency-service',
            version: 'dev',
          }),
        );
        expect(['debug', 'info', 'warning', 'error']).toContain(l.severity);
        for (const old of ['time', 'level', 'msg', 'name', 'pid', 'hostname']) {
          expect(l).not.toHaveProperty(old);
        }
        expect(l).not.toHaveProperty('trace_id');
        expect(l).not.toHaveProperty('span_id');
      }
      const messages = lines.map((l) => l.message as string);
      expect(messages[0]).toBe('starting');
      expect(lines[0]).toMatchObject({
        commit: 'unknown',
        telemetry: 'off: no OTEL_EXPORTER_OTLP_ENDPOINT',
        profiling: 'off: no PYROSCOPE_ADDR',
      });
      expect(messages).toContain('Received signal, shutting down');
      expect(messages[messages.length - 1]).toBe('CurrencyService stopped');
    } finally {
      if (p.child.exitCode === null) p.child.kill('SIGKILL');
    }
  }, 60000);

  it('telemetry on (collector port closed): request logs carry the incoming trace id', async () => {
    const dead = await freePort();
    const port = await freePort();
    const q = start({
      PORT: String(port),
      OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${dead}`,
      SERVICE_VERSION: '9.9.9',
    });
    try {
      await q.waitFor('"starting"');
      const c = client(port);
      const md = new grpc.Metadata();
      md.set('traceparent', `00-${TRACE_ID}-b7ad6b7169203331-01`);
      await convert(c, md);
      c.close();
      const signalledAt = performance.now();
      q.child.kill('SIGTERM');
      expect(await q.exited).toBe(0);
      expect(performance.now() - signalledAt).toBeLessThan(10000);

      const lines = q.lines();
      const ok = lines.find((l) => l.message === 'Currency conversion successful');
      expect(ok).toMatchObject({ trace_id: TRACE_ID, version: '9.9.9', from: 'EUR', to: 'USD' });
      expect(ok.span_id).toMatch(/^[0-9a-f]{16}$/);
      expect(ok.span_id).not.toBe('b7ad6b7169203331');
      expect(lines.find((l) => l.message === 'starting')).not.toHaveProperty('trace_id');
    } finally {
      if (q.child.exitCode === null) q.child.kill('SIGKILL');
    }
  }, 60000);

  it('LOG_LEVEL=WARNING (any case) hides info lines', async () => {
    const port = await freePort();
    const p = start({ PORT: String(port), LOG_LEVEL: 'WARNING' });
    try {
      const c = client(port);
      await new Promise<void>((resolve, reject) =>
        c.waitForReady(Date.now() + 30000, (e: Error | undefined) => (e ? reject(e) : resolve())),
      );
      await convert(c);
      c.close();
      p.child.kill('SIGTERM');
      expect(await p.exited).toBe(0);
      expect(p.lines()).toEqual([]);
    } finally {
      if (p.child.exitCode === null) p.child.kill('SIGKILL');
    }
  }, 60000);

  it('collector that accepts connections and never answers (blackhole): serves, SIGTERM exits within 10 s', async () => {
    const sockets: Socket[] = [];
    const hole = createServer((s) => {
      sockets.push(s); // accept, never read, never write, never close
      s.on('error', () => undefined);
    });
    await new Promise<void>((r) => hole.listen(0, '127.0.0.1', r));
    const holePort = (hole.address() as { port: number }).port;
    const port = await freePort();
    const p = start({
      PORT: String(port),
      OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${holePort}`,
      OTEL_METRIC_EXPORT_INTERVAL: '200',
    });
    try {
      await p.waitFor('"starting"');
      const c = client(port);
      await convert(c);
      c.close();
      await new Promise((r) => setTimeout(r, 1000)); // let the exporters try
      const signalledAt = performance.now();
      p.child.kill('SIGTERM');
      expect(await p.exited).toBe(0);
      expect(performance.now() - signalledAt).toBeLessThan(10000);
    } finally {
      if (p.child.exitCode === null) p.child.kill('SIGKILL');
      sockets.forEach((s) => s.destroy());
      hole.close();
    }
  }, 60000);

  it('an unusable setting is one JSON line and exit 1, no stack on stdout', async () => {
    const taken = createServer();
    await new Promise<void>((r) => taken.listen(0, '::', r));
    const port = (taken.address() as { port: number }).port;
    try {
      const p = start({ PORT: String(port) });
      expect(await p.exited).toBe(1);
      const last = p.lines().pop();
      expect(last).toMatchObject({ severity: 'error', service: 'currency-service' });
      expect(typeof last.error).toBe('string');
      expect(JSON.stringify(last)).not.toContain('    at ');
    } finally {
      taken.close();
    }
  }, 60000);
});
