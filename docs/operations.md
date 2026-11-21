# Operations

## Health

`grpc.health.v1.Health/Check` on the gRPC port (`7000`) is a static `SERVING`. It stays `SERVING` during the shutdown drain. The image `HEALTHCHECK` is a `grpc-js` client that connects to `localhost:$PORT` (7000 when `PORT` is unset).

```bash
grpcurl -plaintext localhost:7000 grpc.health.v1.Health/Check
grpcurl -plaintext localhost:7000 list
```

## Shutdown

On SIGTERM or SIGINT the server stops accepting calls (`tryShutdown`) and in-flight RPCs get 2 s (`SHUTDOWN_GRACE_MS`); what is left is cancelled (`forceShutdown`), telemetry is flushed (at most 2 s, also with an unreachable collector) and the process exits 0. The process test in `__tests__` starts the service with telemetry unset and checks that SIGTERM exits 0. A measured `docker stop` was not run for this page.

## Scaling and replicas

Stateless: scale freely. Every replica reads the same baked-in file, so all give the same answer for the same input.

## Failure behaviour

| Failure | Behaviour |
|---|---|
| Unknown source or target currency code | `INVALID_ARGUMENT` |
| Rates file missing or unreadable | the call answers `INTERNAL` (`Failed to load currency data` or `Conversion failed`) and is logged at error level; the file is read on every request and the process keeps running |
| Uncaught exception or rejection | logged as one JSON line, exit 1 |
| Collector unreachable | the service keeps serving; export errors are logged |

## Runbook

| Symptom | Check |
|---|---|
| `INVALID_ARGUMENT` on convert | the code is not one of the 33 in the rates file; the frontend only offers USD, EUR, CAD, JPY, GBP and TRY |
| Prices differ by a cent between pages | the conversion is floating point and truncates; the frontend rounds to the nearest minor unit (see its README, Money display) |
| Rates must change | edit `data/currency_conversion.json` and rebuild the image, or mount a new file over `/app/data/currency_conversion.json` (read on every request, no restart) |

There is no dashboard or alert rule for this service in the repository yet (the dashboards are an open task).
