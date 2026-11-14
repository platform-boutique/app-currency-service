import { context, INVALID_SPAN_CONTEXT, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import { createLogger, levelFromEnv, severityOf } from '../src/logger';
import { fatalLine } from '../src/fatal';

function capture(opts: Parameters<typeof createLogger>[2] = {}) {
  const lines: string[] = [];
  const logger = createLogger(
    'currency-service',
    { write: (l: string) => void lines.push(l) },
    {
      version: '1.2.3',
      now: () => new Date('2026-11-13T10:00:00.123Z'),
      ...opts,
    },
  );
  return { logger, parsed: () => lines.map((l) => JSON.parse(l)) };
}

describe('log shape', () => {
  it('golden line outside a span: no trace ids', () => {
    const { logger, parsed } = capture();
    logger.warn({ from: 'USD' }, 'Conversion failed');
    expect(parsed()).toEqual([
      {
        severity: 'warning',
        timestamp: '2026-11-13T10:00:00.123Z',
        service: 'currency-service',
        version: '1.2.3',
        from: 'USD',
        message: 'Conversion failed',
      },
    ]);
  });

  it.each([
    ['debug', 'debug'],
    ['info', 'info'],
    ['warn', 'warning'],
    ['error', 'error'],
    ['fatal', 'error'],
    ['trace', 'debug'],
  ])('pino %s -> severity %s', (label, want) => {
    expect(severityOf(label)).toBe(want);
  });

  it('an error becomes one string without a stack', () => {
    const { logger, parsed } = capture();
    logger.error({ error: new TypeError('boom') }, 'failed');
    expect(parsed()[0].error).toBe('TypeError: boom');
    expect(JSON.stringify(parsed()[0])).not.toContain('stack');
  });

  it.each([
    [undefined, 'info'],
    ['', 'info'],
    ['debug', 'debug'],
    [' WARNING ', 'warn'],
    ['warn', 'warn'],
    ['error', 'error'],
    ['verbose', 'info'],
  ])('LOG_LEVEL %j -> %s', (raw, want) => {
    expect(levelFromEnv(raw === undefined ? {} : { LOG_LEVEL: raw })).toBe(want);
  });

  it('LOG_LEVEL filters', () => {
    const { logger, parsed } = capture({ level: 'warn' });
    logger.info('hidden');
    logger.warn('shown');
    expect(parsed().map((l) => l.message)).toEqual(['shown']);
  });
});

describe('trace correlation', () => {
  const cm = new AsyncLocalStorageContextManager().enable();
  beforeAll(() => context.setGlobalContextManager(cm));
  afterAll(() => context.disable());

  it('trace_id and span_id inside a span (also after an await), absent outside', async () => {
    const tracer = new BasicTracerProvider().getTracer('t');
    const { logger, parsed } = capture();
    logger.info('before');
    await tracer.startActiveSpan('work', async (span) => {
      logger.info('inside');
      await new Promise((r) => setTimeout(r, 1));
      logger.info('after await');
      const ctx = span.spanContext();
      expect(parsed()[1]).toMatchObject({ trace_id: ctx.traceId, span_id: ctx.spanId });
      expect(parsed()[2]).toMatchObject({ trace_id: ctx.traceId, span_id: ctx.spanId });
      expect(ctx.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(ctx.spanId).toMatch(/^[0-9a-f]{16}$/);
      span.end();
    });
    logger.info('outside');
    const lines = parsed();
    expect(lines[0]).not.toHaveProperty('trace_id');
    expect(lines[3]).not.toHaveProperty('trace_id');
    expect(lines[3]).not.toHaveProperty('span_id');
  });

  it('a non-recording invalid span writes no ids', () => {
    const { logger, parsed } = capture();
    context.with(trace.setSpan(context.active(), trace.wrapSpanContext(INVALID_SPAN_CONTEXT)), () =>
      logger.info('x'),
    );
    expect(parsed()[0]).not.toHaveProperty('trace_id');
  });
});

describe('fatal line', () => {
  it('is one JSON object in the shared shape', () => {
    const line = fatalLine(
      new Error('bad port'),
      'uncaught exception',
      {},
      new Date('2026-11-13T10:00:00.000Z'),
    );
    expect(line.endsWith('\n')).toBe(true);
    expect(JSON.parse(line)).toEqual({
      timestamp: '2026-11-13T10:00:00.000Z',
      severity: 'error',
      message: 'uncaught exception',
      service: 'currency-service',
      version: 'dev',
      error: 'Error: bad port',
    });
  });
});
