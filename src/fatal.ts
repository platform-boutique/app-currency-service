/**
 * Uncaught exceptions and unhandled rejections (also while the modules are still loading) become ONE JSON
 * line on stdout, then exit code 1: no stack trace in the output, same field set as the logger.
 * Imported FIRST by server.ts. Self-contained on purpose (no pino): it must work when other modules fail.
 */
import { resolveTelemetryConfig } from './telemetryConfig';

export function fatalLine(
  error: unknown,
  message: string,
  env = process.env,
  now = new Date(),
): string {
  const c = resolveTelemetryConfig(env);
  return (
    JSON.stringify({
      timestamp: now.toISOString(),
      severity: 'error',
      message,
      service: c.serviceName,
      version: c.serviceVersion,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    }) + '\n'
  );
}

function die(error: unknown, message: string): void {
  try {
    process.stdout.write(fatalLine(error, message));
  } finally {
    process.exit(1);
  }
}

process.on('uncaughtException', (err) => die(err, 'uncaught exception'));
process.on('unhandledRejection', (reason) => die(reason, 'unhandled rejection'));
