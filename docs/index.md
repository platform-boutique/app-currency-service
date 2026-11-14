# currency-service

<div class="pd-hero" markdown>
<span class="pd-kicker">service · platform-demo</span>

A gRPC service that converts monetary amounts between currencies for the platform-demo e-commerce platform. It reads a static table of exchange rates (relative to EUR) from a JSON file baked into the image and converts through EUR. It is stateless, has no downstream dependencies, and is called by `frontend` and `checkout-service`.
</div>

<div class="pd-facts" markdown>
<div><span>Runtime</span><strong>Node 22</strong><small>TypeScript</small></div>
<div><span>Listens on</span><strong>7000</strong><small>gRPC</small></div>
<div><span>State</span><strong>Stateless</strong></div>
<div><span>Image</span><strong>currency-service</strong><small>mladenovskistefan/</small></div>
</div>

## Where it sits

Called by `frontend`, `checkout-service`. It has no downstream dependencies.

```mermaid
flowchart LR
  currency_service["<b>currency-service</b><br/>7000 (gRPC)"]:::me
  frontend["frontend"] --> currency_service
  checkout_service["checkout-service"] --> currency_service
  classDef me stroke-width:3px;
```

## At a glance

| | |
|---|---|
| **Language / runtime** | TypeScript on Node.js 22 (`@grpc/grpc-js`) |
| **Image** | `mladenovskistefan/currency-service` |
| **Protocol / port** | gRPC (HTTP/2, plaintext) on `7000` |
| **Metrics** | Pushed over OTLP/gRPC to Alloy → Mimir every 15 s (no scrape endpoint). Dashboard names: `rpc_server_duration_seconds_{bucket,count,sum}`, `rpc_server_requests_total`, `rpc_server_active_requests`, `build_info` |
| **Health** | `grpc.health.v1.Health/Check` on `7000` — static `SERVING` |
| **State** | None. Rates are read from `data/currency_conversion.json` (static, not live) |
| **Depends on** | Nothing (optional: OTLP collector, Pyroscope) |
| **Called by** | `frontend` (`GetSupportedCurrencies`, `Convert`), `checkout-service` (`Convert`) |
| **gRPC reflection** | Enabled (v1 and v1alpha, `@grpc/reflection`): `grpcurl -plaintext localhost:7000 list` works without the proto files |

## Find it elsewhere

<div class="pd-cards" markdown>
<div><h4><a href="https://argocd.platform-demo.click/applications/argocd/dev-currency-service">Argo CD</a></h4><p>Sync and health of <code>dev-currency-service</code>.</p></div>
<div><h4><a href="https://grafana.platform-demo.click/d/currency-service-overview">Grafana</a></h4><p>Latency, traffic and errors (<code>currency-service-overview</code>).</p></div>
<div><h4><a href="https://github.com/platform-boutique/app-currency-service">Repository</a></h4><p>Source, pull requests and releases of <code>app-currency-service</code>.</p></div>
</div>

!!! info "Part of the platform-demo platform"
    Cross-cutting facts (service wiring, observability contract, Kubernetes translation, CI/CD) are in the
    [master reference](https://github.com/platform-boutique/platform-demo-docs). This site only describes currency-service.
