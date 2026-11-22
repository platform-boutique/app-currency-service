# Known limitations

- Rates are a static snapshot; they are never refreshed.
- The rates file is read and parsed from disk on every request (cheap for 33 entries, but not free).
- Conversion uses floating-point arithmetic and truncates; results can be off by a nano-unit.
- With telemetry off the OTel SDK and Pyroscope modules are still loaded (static imports, including the pprof native module); they are just never started.
- Health stays `SERVING` during the 2 s shutdown drain (it is static).
- Accepted exception, 2026-11-22: `npm audit` (all dependencies) reports one moderate `minimatch` advisory (GHSA-g3hv-75wg-m249, ReDoS) through the dev-only `@typescript-eslint` 7 packages; the fix is a major bump of the lint toolchain (`@typescript-eslint` 8). It is not in the image (`npm prune --omit=dev`) and CI audits with `--omit=dev`, which finds 0. Revisit only if the lint toolchain is updated for another reason.
