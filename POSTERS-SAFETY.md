# Posters safety controls

The Posters renderer is cache-first. Cache hits are returned before any render budget is consumed.

## Default safeguards

- `POSTERS_RENDERING_ENABLED=1` — master render switch. Set to `0` to stop all new renders immediately. Cached posters still serve.
- `POSTERS_MAX_DAILY_RENDERS=500` — application-level global daily render budget.
- `POSTERS_CONSERVE_AT_PERCENT=95` — enter conservation mode at 95% of the configured daily render budget.
- `POSTERS_HARD_STOP_AT_PERCENT=98` — stop all new expensive renders at 98% of the configured daily render budget.
- `POSTERS_MAX_CLIENT_HOURLY_RENDERS=60` — per-client hourly render budget. Client addresses are SHA-256 hashed before being stored.
- `POSTERS_MAX_CONCURRENT_RENDERS=4` — normal concurrent renderer cap per active runtime instance. Conservation mode reduces effective concurrency to 1.
- `POSTERS_SAFETY_FAIL_OPEN=0` — fail closed if the D1 safety counter cannot be reached. Leave this at `0` for production.

The existing Cloudflare D1 binding must be named `DB`. The safety module creates its own `poster_usage_daily` and `poster_usage_client_hourly` tables automatically.

## 95% / 98% policy

The percentages apply to the Kollection's own metered render budget, not Cloudflare's delayed billing counters.

With the default `POSTERS_MAX_DAILY_RENDERS=500`:

- Below 95%: normal rendering rules apply.
- At 95% (475 reserved renders): conservation mode begins and render concurrency is reduced to 1.
- At 98% (490 reserved renders): all new expensive overlay renders stop and the original TMDB poster is used instead.
- Cached finished posters continue to serve normally at every stage and do not consume the render budget.

This deliberately leaves headroom instead of trying to run to 100%.

## What happens when a limit is reached

- 95% conservation threshold: new renders are still allowed, but effective render concurrency is reduced to 1.
- 98% hard-stop threshold: no new overlay render is attempted; the original TMDB poster is returned uncached.
- Emergency switch: no new overlay render is attempted; the original TMDB poster is returned uncached.
- Per-client hourly limit: HTTP 429 is returned.
- Cached posters are served normally and do not consume the render budget.

## Admin status

When signed in as the configured `NUVIO_ADMIN_EMAIL`, request:

`/api/posters-safety-status`

The endpoint reports whether rendering is enabled, today's reserved render count, usage percentage, conservation state, hard-stop state, and the active configured limits.

## Production recommendation

Keep `POSTERS_SAFETY_FAIL_OPEN=0`. Start with the defaults while testing the new Sharp/Container renderer. Raise `POSTERS_MAX_DAILY_RENDERS` only after measuring actual render time and Cloudflare usage.

These controls limit application-level render work. They are not a substitute for Cloudflare account-level billing alerts or platform spending controls.
