# Kubernetes

**Workload:** stateless `Deployment`; scale freely (each pod has its own copy of the rates file).

**Ports to declare**

| Name | Port | Protocol | Expose via Service? |
|---|---|---|---|
| `grpc` | `7000` | TCP (HTTP/2) | Yes — callers dial `currency-service:7000` |

**Service DNS name expected by callers:** `currency-service` (`frontend`: `CURRENCY_SERVICE_ADDR=currency-service:7000`, `checkout-service`: `CURRENCY_SERVICE_ADDR=currency-service:7000`).

**Probes**

```yaml
readinessProbe:
  grpc: { port: 7000 }
  initialDelaySeconds: 3
  periodSeconds: 5
livenessProbe:
  grpc: { port: 7000 }
  periodSeconds: 10
  failureThreshold: 3
```

The Node health handler implements `Check` only (no `Watch`); Kubernetes `grpc:` probes only call `Check`, so this works. Startup takes ~1–2 s.

**Graceful shutdown:** on `SIGTERM` (and `SIGINT`) the server stops accepting new calls (`tryShutdown`), gives in-flight ones up to 2 s before `forceShutdown`, flushes telemetry when it is on (bounded at 2 s) and exits `0`. The worst case (4 s) fits the chart's `terminationGracePeriodSeconds: 5`. Measured: `docker stop` on the idle container returned in 0.24 s with exit code 0; running the build against a stub OTLP receiver, the final traces, metrics and logs batches arrived after `SIGTERM` and the process exited 0.

**Security context**

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 100
  runAsGroup: 101
  allowPrivilegeEscalation: false
  capabilities: { drop: ["ALL"] }
  readOnlyRootFilesystem: true   # verified (no /tmp needed)
```

**Resources** — requests sized from measured idle usage in the test stack (see the chart's `values.yaml` for limits):

```yaml
resources:
  requests: { cpu: 100m, memory: 64Mi }
  limits:   { cpu: "500m", memory: 192Mi }
```

**Config / secrets:** no secrets. The rates file can optionally be supplied via a `ConfigMap` mounted at `/app/data/currency_conversion.json` (e.g. `subPath`) for rate changes without a rebuild.

**Telemetry:** pushed, not scraped — OTLP/gRPC to Alloy (`global.monitoring.otlpEndpoint`), profiles to Alloy `:4040`. Metrics carry `job="currency-service"` and `instance=<pod>`; no scrape annotations or `ServiceMonitor` are needed.

**Helm chart:** [`platform-demo-helm/currency-service`](https://github.com/platform-boutique/platform-demo-helm/tree/main/currency-service) (built on the shared `platform-common` library chart). It ships with HA defaults — 2 replicas,
HPA, PodDisruptionBudget, topology spread, NetworkPolicy, restricted pod security context, probes and the full env contract (see Configuration) —
and was verified under the `restricted` Pod Security Standard on the earlier local 3-node kind cluster (since retired). The platform now targets AWS EKS, where this chart has not been deployed or verified yet.

**Deployment and admission policies:** Argo CD deploys the chart from `platform-demo-helm` (`envs/<env>/values/currency-service.yaml` pins the image digest; promotion is a pull request). In the cluster Kyverno enforces, for this service: pods named `app.kubernetes.io/name: currency-service` that run under the ServiceAccount of the same name (Cilium derives the network identity from that label), an image from this repository pinned by digest and signed by our release pipeline, a read-only root filesystem, resource requests and a memory limit, readiness and liveness probes and no API token. The Helm CI evaluates the rendered chart against these policies before merge; see [`platform-demo-helm/policies`](https://github.com/platform-boutique/platform-demo-helm/tree/main/policies).
