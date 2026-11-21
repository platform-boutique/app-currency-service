# Architecture

## Context

```mermaid
flowchart LR
    fe[frontend] -- "GetSupportedCurrencies, Convert :7000" --> cur[currency-service]
    co[checkout-service] -- "Convert" --> cur
    cur -- "reads on every request" --> file[(data/currency_conversion.json)]
    cur -. "OTLP gRPC, optional" .-> otel[OTLP collector]
    cur -. "push, optional" .-> pyro[Pyroscope]
```

currency-service is stateless and calls no other service. The rates are a static file baked into the image. The callers were checked in the `origin/main` code of the frontend (`cmd/server/rpc.go`, with its own cache in front, see the frontend's ADR 2) and checkout-service (`Convert` for items and shipping) on 2026-11-21.

## Conversion

```mermaid
sequenceDiagram
    participant C as caller
    participant S as currency-service
    C->>S: Convert(Money from, to_code)
    S->>S: read the rates file, look up from and to (EUR based)
    Note over S: from -> EUR -> to, floating point, carry of nanos into units
    S-->>C: Money (or INVALID_ARGUMENT for an unknown code)
```

## Components

| File | Role |
|---|---|
| `src/server.ts` | gRPC server bootstrap, the handlers (`GetSupportedCurrencies`, `Convert`, health `Check`), reflection, SIGTERM drain |
| `src/currency.ts` | the pure conversion logic (carry, `convertMoney`), unit tested |
| `src/telemetry.ts`, `telemetryConfig.ts`, `logger.ts`, `fatal.ts` | OTel SDK, RPC metrics, runtime gauges, Pyroscope (each only when enabled), pino JSON logs with trace ids, fatal handler |
| `proto/` | `currency.proto` and `health.proto`, loaded at runtime by `@grpc/proto-loader` |
| `data/currency_conversion.json` | EUR-based rates for 33 currencies |

## Decisions

[ADR 1](adr/0001-static-eur-rates-file.md).
