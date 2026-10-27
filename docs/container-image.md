# Container image

Multi-stage [`Dockerfile`](https://github.com/platform-boutique/app-currency-service/tree/main/Dockerfile):

| Stage | Base | What happens |
|---|---|---|
| builder | `node:22.22.2-alpine3.23` | `npm ci --ignore-scripts`, `npm run build` (tsc → `dist/`), `npm prune --omit=dev` |
| runtime | `node:22.22.2-alpine3.23` | copies `node_modules`, `dist/`, `proto/`, `data/`; runs as non-root |

- **Entrypoint:** `node dist/server.js` (working dir `/app`).
- **User:** numeric `USER 100:101` (`appuser`/`appgroup`, created with these fixed ids; `id` in the container prints `uid=100(appuser) gid=101(appgroup)`). Matches the chart's `runAsUser: 100` / `runAsGroup: 101`.
- **EXPOSE:** `7000` only.
- **Docker `HEALTHCHECK`:** a `grpc-js` client connecting to `localhost:$PORT`. Because the command reads `process.env.PORT` directly (no default), **it fails if `PORT` is not set** in the container — compose sets `PORT=7000`. Kubernetes ignores this check anyway, but set `PORT` explicitly in the Deployment for parity.
- **Image size:** ~73 MB.
