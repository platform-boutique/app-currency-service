# Known limitations

- Rates are a static snapshot; they are never refreshed.
- The rates file is read and parsed from disk on every request (cheap for 33 entries, but not free).
- Conversion uses floating-point arithmetic and truncates; results can be off by a nano-unit.
- With telemetry off the OTel SDK and Pyroscope modules are still loaded (static imports, including the pprof native module); they are just never started.
- Health stays `SERVING` during the 2 s shutdown drain (it is static).
