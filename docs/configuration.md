# Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `7000` | gRPC listen port. The Docker `HEALTHCHECK` falls back to 7000 too |
| `NODE_ENV` | `production` (set in image) | |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset (telemetry off) | OTLP/**gRPC** endpoint for **traces, metrics and logs**, an absolute `http(s)://host:port` URL, e.g. `http://alloy.monitoring.svc.cluster.local:4317`. Telemetry is on only if it is set to a valid URL; empty or malformed (`alloy:4317`, `http://`) means off, never a crash. The legacy `COLLECTOR_SERVICE_ADDR` and `ENABLE_TRACING` are no longer read |
| `OTEL_SDK_DISABLED` | unset | `true` (trimmed, any case) forces traces, metrics, logs **and profiling** off even if the endpoints are set |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `grpc` (fixed) | Not read: the service always exports OTLP/gRPC |
| `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG` | SDK default | Read by the OpenTelemetry Node SDK itself (not run here) |
| `OTEL_RESOURCE_ATTRIBUTES` | unset | Extra resource attributes, merged by the OpenTelemetry Node SDK (not run here); the five attributes of the service always come from the service |
| `OTEL_METRIC_EXPORT_INTERVAL` | `15000` | Milliseconds between metric pushes |
| `OTEL_SERVICE_NAME` | `currency-service` | `service.name`; becomes the Prometheus `job` and the Loki `service_name`; keep the default, dashboards depend on it |
| `SERVICE_VERSION` | `dev` | `service.version` resource attribute, the `version` field of every log line and the Pyroscope tag |
| `SERVICE_COMMIT` | `unknown` | Commit id, logged once in the `starting` line (the image build does not set it yet) |
| `DEPLOYMENT_ENVIRONMENT` | `local` | `deployment.environment` resource attribute, Pyroscope tag `environment` |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warning` (or `warn`) or `error`, any case; anything else means `info` |
| `PYROSCOPE_ADDR` | unset (profiling off) | Absolute `http(s)` URL. Profiles use the Pyroscope SDK push protocol (**not** OTLP). Point it at Alloy (`http://alloy.monitoring.svc.cluster.local:4040`), which forwards to Pyroscope, or directly at Pyroscope. No default address: profiling is on only if this is a valid URL |
| `ENABLE_PROFILING` | unset | `0` or `false` forces profiling off even with `PYROSCOPE_ADDR` set; `1` alone starts nothing |

Notes:

- Telemetry is **pushed**, not scraped: traces, metrics and logs share one OTLP/gRPC endpoint (Alloy); profiles go to Pyroscope (via Alloy). `service.instance.id` is the pod hostname, so replicas stay distinct in Mimir.
- The former Prometheus endpoint (`METRICS_PORT`) no longer exists. Logs go to stdout as JSON and, with telemetry on, are additionally exported over OTLP with trace ids.
- With every telemetry variable unset the service starts with telemetry and profiling off: the `NodeSDK` and Pyroscope are not started (the modules are still loaded), the RPC instruments and runtime gauges are OpenTelemetry API no-ops, and the `starting` line says so (`"telemetry":"off: no OTEL_EXPORTER_OTLP_ENDPOINT","profiling":"off: no PYROSCOPE_ADDR"`; verified by `__tests__/lifecycle.test.ts`, which runs the real server).
- With an endpoint set but no reachable collector, the service keeps serving and exits on `SIGTERM` within the 2 s drain plus a 2 s flush bound (tested against a closed port and against a port that accepts connections and never answers; both exit well under 10 s).
- Resource attributes on every signal: `service.name`, `service.version`, `service.namespace=everly`, `deployment.environment`, `service.instance.id` (hostname). Pyroscope tags: `service_name`, `version`, `environment`.
- Logs: one JSON object per line on stdout with `timestamp` (RFC3339 UTC, milliseconds; was `time` epoch ms), `severity` (`debug`, `info`, `warning`, `error`; was `level`), `message` (was `msg`), `service`, `version`, `trace_id` and `span_id` (only while a span is active, i.e. while a gRPC call is handled) and `error` (a string, never a stack). Uncaught exceptions and unhandled rejections are one JSON line too, then exit code 1. Only currency codes are logged, no personal data.
