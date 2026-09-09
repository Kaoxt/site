# Posters safety controls

The Posters renderer is cache-first. Cache hits are returned before any render budget is consumed.

## Default safeguards

- `POSTERS_RENDERING_ENABLED=1` — master render switch. Set to `0` to stop all new renders immediately. Cached posters still serve.
- `POSTERS_MAX_DAILY_RENDERS=500` — global daily render budget.
- `POSTERS_MAX_CLIENT_HOURLY_RENDERS=60` — per-client hourly render budget. Client addresses are SHA-256 hashed before being stored.
- `POSTERS_MAX_CONCURRENT_RENDERS=4` — concurrent renderer cap per active runtime instance.
- `POSTERS_SAFETY_FAIL_OPEN=0` — fail closed if the D1 safety counter cannot be reached. Leave this at `0` for production.

The existing Cloudflare D1 binding must be named `DB`. The safety module creates its own `poster_usage_daily` and `poster_usage_client_hourly` tables automatically.

## What happens when a limit is reached

- Global daily budget: no new overlay render is attempted; the original TMDB poster is returned uncached.
- Concurrency limit: no new overlay render is attempted; the original TMDB poster is returned uncached.
- Emergency switch: no new overlay render is attempted; the original TMDB poster is returned uncached.
- Per-client hourly limit: HTTP 429 is returned.
- Cached posters are served normally and do not consume the render budget.

## Admin status

When signed in as the configured `NUVIO_ADMIN_EMAIL`, request:

`/api/posters-safety-status`

The endpoint reports whether rendering is enabled, today's reserved render count, and the active configured limits.

## Production recommendation

Keep `POSTERS_SAFETY_FAIL_OPEN=0`. Start with the defaults while testing the new Sharp/Container renderer. Raise `POSTERS_MAX_DAILY_RENDERS` only after measuring actual render time and Cloudflare usage.

These controls limit application-level render work. They are not a substitute for Cloudflare account-level billing alerts or platform spending controls.
