# 1. Static EUR-based rates in a JSON file, converted through EUR

Status: accepted (reconstructed from the code and the earlier README).

## Context

The shop shows prices in six currencies, and the exchange rates are demo data: nothing is bought for real, and a live rate feed would add an external dependency and a source of flaky tests.

## Decision

Keep the rates in `data/currency_conversion.json` as `"CODE": "rate-per-1-EUR"` strings (33 currencies), baked into the image, and convert `from -> EUR -> to`. The file is read on every request, so a new file mounted over `/app/data/currency_conversion.json` takes effect without a restart.

## Consequences

- No network dependency, deterministic results.
- Rates are a snapshot and are never refreshed; the file is parsed on every request (cheap for 33 entries, but not free).
- The arithmetic is floating point and truncates, so results can be a nano-unit off. The API exposes no rate, so a caller cannot compute the same result itself; the frontend caches this service's answers instead (see the frontend's ADR 2).
