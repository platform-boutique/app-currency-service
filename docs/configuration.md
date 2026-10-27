# Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `7000` | gRPC listen port. **Must be set when relying on the Docker `HEALTHCHECK`** (see below) |
| `NODE_ENV` | `production` (set in image) | |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset (telemetry off) | OTLP/**gRPC** endpoint for **traces, metrics and logs** (scheme required), e.g. `http://alloy.monitoring.svc.cluster.local:4317`. Legacy fallback: `COLLECTOR_SERVICE_ADDR` (`host:port`). Telemetry is on only when one of them is set and non-empty |
| `OTEL_SDK_DISABLED` | — | `true` forces telemetry off even with an endpoint set (the legacy `ENABLE_TRACING=0` does the same) |
| `OTEL_METRIC_EXPORT_INTERVAL` | `15000` | Milliseconds between metric pushes |
| `OTEL_SERVICE_NAME` | `currency-service` | `service.name` — becomes the Prometheus `job` and the Loki `service_name`; keep the default, dashboards depend on it |
| `SERVICE_VERSION` | `1.0.0` | `service.version` resource attribute |
| `PYROSCOPE_ADDR` | unset (profiling off) | Profiles use the Pyroscope SDK push protocol (**not** OTLP). Point it at Alloy (`http://alloy.monitoring.svc.cluster.local:4040`), which forwards to Pyroscope, or directly at Pyroscope. Profiling is on only when this is set and non-empty |
| `ENABLE_PROFILING` | — | `0` forces profiling off even with `PYROSCOPE_ADDR` set; any other value (or unset) leaves the decision to `PYROSCOPE_ADDR` |

Notes:

- Telemetry is **pushed**, not scraped: traces, metrics and logs share one OTLP/gRPC endpoint (Alloy); profiles go to Pyroscope (via Alloy). `service.instance.id` is the pod hostname, so replicas stay distinct in Mimir.
- The former Prometheus endpoint (`METRICS_PORT`) no longer exists. Logs go to stdout as JSON and, with telemetry on, are additionally exported over OTLP with trace ids.
- With every telemetry variable unset the service starts with telemetry and profiling off: the `NodeSDK` and Pyroscope are not started (the modules are still loaded), the RPC instruments and runtime gauges are OpenTelemetry API no-ops, and the only startup line is `CurrencyService gRPC server started (telemetry off, profiling off)` (verified from the build and in the image).
- With an endpoint set but no reachable collector, the service keeps serving and still exits promptly on `SIGTERM` (measured: 0.09 s).
