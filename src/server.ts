import './fatal'; // first: uncaught errors, also while loading, are one JSON line
import { shutdownTelemetry, startRpcMetrics, telemetryConfig } from './telemetry'; // must be first — instruments before anything else loads
import path from 'path';
import fs from 'fs';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { createLogger } from './logger';
import { convertMoney, type Money, type CurrencyData } from './currency';
import { settleWithin } from './telemetryConfig';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const logger = createLogger(telemetryConfig.serviceName, undefined, {
  version: telemetryConfig.serviceVersion,
});

// ---------------------------------------------------------------------------
// Proto loading
// ---------------------------------------------------------------------------

const CURRENCY_PROTO_PATH = path.join(__dirname, '../proto/currency.proto');
const HEALTH_PROTO_PATH = path.join(__dirname, '../proto/health.proto');

function loadProto(protoPath: string) {
  const packageDefinition = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  return grpc.loadPackageDefinition(packageDefinition);
}

const currencyProto = (loadProto(CURRENCY_PROTO_PATH) as any).hipstershop;
const healthProto = (loadProto(HEALTH_PROTO_PATH) as any).grpc.health.v1;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CurrencyConversionRequest {
  from: Money;
  to_code: string;
}

// ---------------------------------------------------------------------------
// Currency data
// ---------------------------------------------------------------------------

const CURRENCY_DATA_PATH = path.join(__dirname, '../data/currency_conversion.json');

function getCurrencyData(): CurrencyData {
  const raw = fs.readFileSync(CURRENCY_DATA_PATH, 'utf-8');
  return JSON.parse(raw) as CurrencyData;
}

// ---------------------------------------------------------------------------
// gRPC handlers
// ---------------------------------------------------------------------------

function getSupportedCurrencies(
  _call: grpc.ServerUnaryCall<unknown, unknown>,
  callback: grpc.sendUnaryData<{ currency_codes: string[] }>,
): void {
  const endMetrics = startRpcMetrics('GetSupportedCurrencies');
  logger.info('Getting supported currencies');
  try {
    const data = getCurrencyData();
    endMetrics(grpc.status.OK);
    callback(null, { currency_codes: Object.keys(data) });
  } catch (err) {
    logger.error({ error: err }, 'Failed to get supported currencies');
    endMetrics(grpc.status.INTERNAL);
    callback({
      code: grpc.status.INTERNAL,
      message: 'Failed to load currency data',
    });
  }
}

function convert(
  call: grpc.ServerUnaryCall<CurrencyConversionRequest, Money>,
  callback: grpc.sendUnaryData<Money>,
): void {
  const endMetrics = startRpcMetrics('Convert');
  try {
    const data = getCurrencyData();
    const { from, to_code } = call.request;

    const result = convertMoney(from, to_code, data);

    if (!result.ok) {
      endMetrics(grpc.status.INVALID_ARGUMENT);
      callback({ code: grpc.status.INVALID_ARGUMENT, message: result.message });
      return;
    }

    logger.info({ from: from.currency_code, to: to_code }, 'Currency conversion successful');
    endMetrics(grpc.status.OK);
    callback(null, result.value);
  } catch (err) {
    logger.error({ error: err }, 'Currency conversion failed');
    endMetrics(grpc.status.INTERNAL);
    callback({ code: grpc.status.INTERNAL, message: 'Conversion failed' });
  }
}

function check(
  _call: grpc.ServerUnaryCall<unknown, unknown>,
  callback: grpc.sendUnaryData<{ status: string }>,
): void {
  callback(null, { status: 'SERVING' });
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

// In-flight RPCs get this long to finish after SIGTERM before they are cancelled. Drain (2 s) plus the telemetry
// flush (at most 2 s) stays inside the charts' terminationGracePeriodSeconds: 5.
const SHUTDOWN_GRACE_MS = 2000;

async function shutdown(server: grpc.Server, signal: NodeJS.Signals): Promise<void> {
  logger.info({ signal }, 'Received signal, shutting down');
  // tryShutdown stops accepting new calls and waits for in-flight ones; forceShutdown cancels what is left.
  const drained = new Promise<void>((resolve) => server.tryShutdown(() => resolve()));
  await settleWithin(drained, SHUTDOWN_GRACE_MS);
  server.forceShutdown();
  logger.info('CurrencyService stopped');
  await shutdownTelemetry();
  process.exit(0);
}

function main(): void {
  const port = process.env.PORT ?? '7000';

  const server = new grpc.Server();
  server.addService(currencyProto.CurrencyService.service, {
    getSupportedCurrencies,
    convert,
  });
  server.addService(healthProto.Health.service, { check });

  let stopping = false;
  const onSignal = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    void shutdown(server, signal);
  };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);

  server.bindAsync(`[::]:${port}`, grpc.ServerCredentials.createInsecure(), (err, boundPort) => {
    if (err) {
      logger.error({ error: err }, 'Failed to bind gRPC server');
      process.exit(1);
    }
    logger.info(
      {
        commit: telemetryConfig.serviceCommit,
        port: boundPort,
        telemetry: telemetryConfig.telemetryReason,
        profiling: telemetryConfig.profilingReason,
      },
      'starting',
    );
  });
}

main();
