# Develop & test

## Checks and commands

Requirements: Node.js 22 (`.nvmrc`; the table below was produced on 2026-11-22 on the host's Node 24.14.0 after `npm ci --ignore-scripts` and again in the CI image `node:22.22.2-alpine3.23`), Docker for the image, Python 3.12 for the docs check. The commands below are the ones the shared pipeline (`platform-demo-workflows`, `service-ci-node`) runs, so a failure can be reproduced without pushing. `Running locally` above has the run commands.

| Step | Command | Result on 2026-11-22 |
|---|---|---|
| Format | `npm run format:check` | run on Node 24.14.0 (host) and on Node 22.22.2 (`node:22.22.2-alpine3.23` container, full `npm ci`): all matched files use Prettier code style |
| Typecheck | `npm run typecheck` | run on both, passed |
| Lint | `npm run lint` | run on both, 0 errors, 5 warnings (`no-explicit-any`) |
| Build | `npm run build` | run on both, passed |
| Unit tests | `npm run test:ci` | run on both: 84 passed in 6 suites; coverage 93.5 % statements, 85.1 % branches (`--coverage`, `server.ts`, `telemetry.ts` and `client.ts` are excluded) |
| Dependency audit | `npm audit --audit-level=high --omit=dev` (CI) | run on both: found 0 vulnerabilities. The full `npm audit` (with dev dependencies) lists 6 moderate findings, all one `minimatch` ReDoS advisory (GHSA-g3hv-75wg-m249) reached through the dev-only `@typescript-eslint` 7 packages; see the accepted exception in `limitations.md` |
| SAST | `semgrep scan --config p/typescript --config p/nodejs --config p/secrets --error --metrics=off` (semgrep 1.180.0, as CI) | run, 111 rules on 51 files: 0 findings |
| Image | `docker build --platform linux/amd64 -t platform-demo/currency-service:local .` | run, passed; both `FROM` lines carry `@sha256:`; content size 71 MB (322 MB unpacked disk usage), user `10001:10001` |
| Image scan | `trivy image --severity CRITICAL,HIGH --exit-code 1 platform-demo/currency-service:local` (Trivy 0.76.1) | run, exit 0 (alpine 3.23.4 and all Node packages: 0 findings) |
| Container | `docker ps` health, whole shop `local/up.sh` + `local/smoke.sh` | run: the exec-form `HEALTHCHECK` reports `healthy`; `SMOKE PASSED` (87 PASS) three times in a row with this image in the shop; 0 error log lines from the service |
| Secret scan | `pre-commit run --all-files` (`.pre-commit-config.yaml`, gitleaks) or `gitleaks git --redact` | run with the gitleaks binary of the pre-commit cache (`gitleaks git --redact`, full history, 56 commits): no leaks found |
| Workflow lint | `actionlint` | run on 2026-11-21 (actionlint 1.7.12), no findings; not re-run for the workflows v3.8.0 pin change |
| Docs | `mkdocs build --strict` (mkdocs 1.6.1 + mkdocs-techdocs-core 1.7.1, Python 3.12 venv) and the link check `python3 -I tools/check-md-links.py .` from `platform-demo-workflows` (relative links in `README.md` and `docs/`) | run, both passed |

Not run: OTLP export against a real collector (the metrics are pushed, there is no scrape endpoint; the unit tests cover `build_info` and the RPC instruments), several replicas, `docker stop` timing of this image.

## Running locally

Requirements: Node.js 22 (`.nvmrc`), Docker, [`grpcurl`](https://github.com/fullstorydev/grpcurl).

```bash
npm ci
npm run build && npm start          # compiled
npm run dev                         # ts-node, no build step
npm run client                      # built-in smoke-test client (talks to localhost:$PORT)
npm test                            # jest: unit tests + a process test (ts-node, telemetry unset, SIGTERM exits 0)
npm run lint && npm run typecheck

docker build -t currency-service .
docker run --rm -p 7000:7000 -e PORT=7000 currency-service
```

### Manual gRPC testing (reflection is on; `-proto` also works)

```bash
grpcurl -plaintext -proto proto/currency.proto -d '{}' \
  localhost:7000 hipstershop.CurrencyService/GetSupportedCurrencies

grpcurl -plaintext -proto proto/currency.proto \
  -d '{"from": {"currency_code": "USD", "units": 100, "nanos": 0}, "to_code": "EUR"}' \
  localhost:7000 hipstershop.CurrencyService/Convert

grpcurl -plaintext -proto proto/health.proto localhost:7000 grpc.health.v1.Health/Check
```

## Project structure

```
├── src/
│   ├── server.ts        # gRPC server bootstrap, handlers (GetSupportedCurrencies, Convert, Check), SIGTERM
│   ├── currency.ts      # pure conversion logic (carry, convertMoney)
│   ├── telemetry.ts     # OTel SDK, RPC metrics, runtime gauges, Pyroscope (each only when enabled), bounded shutdown
│   ├── telemetryConfig.ts  # telemetry contract (pure functions, unit tested)
│   ├── metrics.ts       # build_info gauge
│   ├── reflection.ts    # gRPC server reflection (v1, v1alpha)
│   ├── logger.ts        # pino factory: shared log shape, trace ids from the active span
│   ├── fatal.ts         # uncaught exceptions / rejections as one JSON line, exit 1
│   └── client.ts        # smoke-test client
├── proto/               # currency.proto, health.proto (loaded at runtime by @grpc/proto-loader)
├── data/currency_conversion.json   # EUR-based rates (33 currencies)
├── package.json / package-lock.json / tsconfig.json
├── Dockerfile
├── .dockerignore / .nvmrc / .eslintrc.cjs / .prettierrc / .trivyignore
└── docs/                # TechDocs pages (mkdocs.yml in the root), docs/adr/ = decisions
```
