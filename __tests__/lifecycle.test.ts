import { spawn } from 'child_process';
import { createServer } from 'net';
import path from 'path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { otlpEndpoint, pyroscopeAddress, settleWithin } from '../src/telemetryConfig';

// ---------------------------------------------------------------------------
// Telemetry contract (pure functions)
// ---------------------------------------------------------------------------

describe('otlpEndpoint()', () => {
  it('is off when nothing is set', () => {
    expect(otlpEndpoint({})).toBeUndefined();
  });

  it('is off when the variables are empty', () => {
    expect(
      otlpEndpoint({ OTEL_EXPORTER_OTLP_ENDPOINT: '', COLLECTOR_SERVICE_ADDR: ' ' }),
    ).toBeUndefined();
  });

  it('uses OTEL_EXPORTER_OTLP_ENDPOINT', () => {
    expect(otlpEndpoint({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://alloy:4317' })).toBe(
      'http://alloy:4317',
    );
  });

  it('falls back to the legacy COLLECTOR_SERVICE_ADDR', () => {
    expect(otlpEndpoint({ COLLECTOR_SERVICE_ADDR: 'alloy:4317' })).toBe('http://alloy:4317');
  });

  it('prefers OTEL_EXPORTER_OTLP_ENDPOINT over the legacy variable', () => {
    expect(
      otlpEndpoint({
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://a:4317',
        COLLECTOR_SERVICE_ADDR: 'b:4317',
      }),
    ).toBe('http://a:4317');
  });

  it.each(['true', 'TRUE', ' True '])('is forced off by OTEL_SDK_DISABLED=%p', (v) => {
    expect(
      otlpEndpoint({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://alloy:4317', OTEL_SDK_DISABLED: v }),
    ).toBeUndefined();
  });

  it('stays on with OTEL_SDK_DISABLED=false', () => {
    expect(
      otlpEndpoint({
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://alloy:4317',
        OTEL_SDK_DISABLED: 'false',
      }),
    ).toBe('http://alloy:4317');
  });

  it('is forced off by the legacy ENABLE_TRACING=0', () => {
    expect(
      otlpEndpoint({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://alloy:4317', ENABLE_TRACING: '0' }),
    ).toBeUndefined();
  });
});

describe('pyroscopeAddress()', () => {
  it('is off when PYROSCOPE_ADDR is unset or empty', () => {
    expect(pyroscopeAddress({})).toBeUndefined();
    expect(pyroscopeAddress({ PYROSCOPE_ADDR: '' })).toBeUndefined();
    expect(pyroscopeAddress({ ENABLE_PROFILING: '1' })).toBeUndefined();
  });

  it('is on when PYROSCOPE_ADDR is set', () => {
    expect(pyroscopeAddress({ PYROSCOPE_ADDR: 'http://alloy:4040' })).toBe('http://alloy:4040');
    expect(pyroscopeAddress({ PYROSCOPE_ADDR: 'http://alloy:4040', ENABLE_PROFILING: '1' })).toBe(
      'http://alloy:4040',
    );
  });

  it('is forced off by ENABLE_PROFILING=0', () => {
    expect(
      pyroscopeAddress({ PYROSCOPE_ADDR: 'http://alloy:4040', ENABLE_PROFILING: '0' }),
    ).toBeUndefined();
  });
});

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
// Real process: everything unset, one RPC, SIGTERM
// ---------------------------------------------------------------------------

const ROOT = path.join(__dirname, '..');
const TELEMETRY_VARS = [
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'COLLECTOR_SERVICE_ADDR',
  'OTEL_SDK_DISABLED',
  'ENABLE_TRACING',
  'PYROSCOPE_ADDR',
  'ENABLE_PROFILING',
];

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

describe('server process', () => {
  it('starts with telemetry unset, serves, and exits 0 promptly on SIGTERM', async () => {
    const port = await freePort();
    const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port) };
    for (const name of TELEMETRY_VARS) delete env[name];
    // Set by VS Code terminals; makes node-gyp-build look for an Electron build of the pprof native module.
    delete env.ELECTRON_RUN_AS_NODE;

    const child = spawn(
      process.execPath,
      ['-r', 'ts-node/register/transpile-only', 'src/server.ts'],
      { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    const exited = new Promise<{ code: number | null; at: number }>((resolve) =>
      child.on('exit', (code) => resolve({ code, at: Date.now() })),
    );

    try {
      await new Promise<void>((resolve, reject) => {
        child.stdout.on('data', (d) => {
          stdout += d;
          if (stdout.includes('server started')) resolve();
        });
        exited.then(() => reject(new Error(`exited early: ${stderr}`)));
      });

      const proto = grpc.loadPackageDefinition(
        protoLoader.loadSync(path.join(ROOT, 'proto/currency.proto'), { keepCase: true }),
      ) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
      const client = new proto.hipstershop.CurrencyService(
        `127.0.0.1:${port}`,
        grpc.credentials.createInsecure(),
      );
      const codes = await new Promise<string[]>((resolve, reject) =>
        client.getSupportedCurrencies({}, (err: Error | null, res: { currency_codes: string[] }) =>
          err ? reject(err) : resolve(res.currency_codes),
        ),
      );
      client.close();
      expect(codes).toContain('EUR');

      const signalledAt = Date.now();
      child.kill('SIGTERM');
      const { code, at } = await exited;

      expect(code).toBe(0);
      expect(at - signalledAt).toBeLessThan(5000); // 2 s drain + 2 s flush at most; idle well under 1 s
      expect(stderr).toBe(''); // nothing noisy with telemetry off
      const messages = stdout
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line).message as string);
      expect(messages[0]).toContain('telemetry off, profiling off');
      expect(messages).toContain('Received signal, shutting down');
      expect(messages[messages.length - 1]).toBe('CurrencyService stopped');
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  }, 30000);
});
