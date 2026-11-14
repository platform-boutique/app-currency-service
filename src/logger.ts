import { pino, type Logger, type DestinationStream } from 'pino';
import { isSpanContextValid, trace } from '@opentelemetry/api';

type Env = Record<string, string | undefined>;

const PINO_LEVELS: Record<string, string> = {
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  warning: 'warn',
  error: 'error',
};

/** LOG_LEVEL (debug, info, warning/warn, error; any case), default info; an unknown value means info. */
export function levelFromEnv(env: Env = process.env): string {
  return PINO_LEVELS[(env.LOG_LEVEL ?? '').trim().toLowerCase()] ?? 'info';
}

/** pino level label -> the shared severity vocabulary (debug, info, warning, error). */
export function severityOf(label: string): string {
  switch (label) {
    case 'trace':
    case 'debug':
      return 'debug';
    case 'warn':
      return 'warning';
    case 'error':
    case 'fatal':
      return 'error';
    default:
      return 'info';
  }
}

export interface LoggerOptions {
  /** service.version, the `version` field. */
  version?: string;
  level?: string;
  /** Injectable clock for the `timestamp` field (tests). */
  now?: () => Date;
}

/**
 * The shared log shape (OBS-30): one JSON object per line with `timestamp` (RFC3339 UTC, milliseconds),
 * `severity` (debug, info, warning, error), `message`, `service`, `version`, `trace_id` and `span_id`
 * (hex, only while a valid span is active) and `error` (string; pass `{ error: err }`).
 */
export function createLogger(
  name: string,
  destination?: DestinationStream,
  opts: LoggerOptions = {},
): Logger {
  const now = opts.now ?? (() => new Date());
  const options = {
    level: opts.level ?? levelFromEnv(),
    messageKey: 'message',
    errorKey: 'error',
    base: { service: name, version: opts.version ?? 'dev' },
    timestamp: () => `,"timestamp":"${now().toISOString()}"`,
    formatters: {
      level(label: string) {
        return { severity: severityOf(label) };
      },
    },
    serializers: {
      // An error becomes one string, never an object with a stack trace.
      error: (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e)),
    },
    // trace_id / span_id of the span that is active when the line is written (a gRPC server span while a
    // request is handled). Absent outside a span; the OTel API alone is enough (no SDK needed).
    mixin() {
      const ctx = trace.getActiveSpan()?.spanContext();
      return ctx && isSpanContextValid(ctx) ? { trace_id: ctx.traceId, span_id: ctx.spanId } : {};
    },
  };
  return destination ? pino(options, destination) : pino(options);
}

export type { Logger };
