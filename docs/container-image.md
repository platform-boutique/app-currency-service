# Container image

Multi-stage [`Dockerfile`](https://github.com/platform-boutique/app-currency-service/tree/main/Dockerfile):

| Stage | Base | What happens |
|---|---|---|
| builder | `node:22.22.2-alpine3.23` | `npm ci --ignore-scripts`, `npm run build` (tsc → `dist/`), `npm prune --omit=dev` |
| runtime | `node:22.22.2-alpine3.23` | copies `node_modules`, `dist/`, `proto/`, `data/`; runs as non-root |

- **Entrypoint:** `node dist/server.js` (working dir `/app`).
- **User:** numeric `USER 10001:10001` (`appuser`/`appgroup`, created with these fixed ids; `id` in the container prints `uid=10001(appuser) gid=10001(appgroup)`). Build args `SERVICE_VERSION` (default `dev`) and `SERVICE_COMMIT` (default `unknown`) set the OCI labels `version`/`revision` (plus `source`, `licenses=Apache-2.0`) and the ENV of the same names.
- **EXPOSE:** `7000` only.
- **Docker `HEALTHCHECK`:** a `grpc-js` client connecting to `localhost:$PORT`, falling back to 7000 like the server (it used to probe `localhost:undefined` when `PORT` was unset; fixed and checked on a rebuilt image: `healthy` with `PORT` unset). Kubernetes ignores this check anyway.
- **Image size:** content size 71 MB (322 MB unpacked on disk), measured 2026-11-22.
