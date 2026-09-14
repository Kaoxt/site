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
- Per-client hourly limit: existing overlays still serve; a genuinely uncached title uses the uncached original-art fallback.
- Cached posters are served normally and do not consume the render budget.

## Admin status

When signed in as the configured `NUVIO_ADMIN_EMAIL`, request:

`/api/posters-safety-status`

The endpoint reports whether rendering is enabled, today's reserved render count, usage percentage, conservation state, hard-stop state, and the active configured limits.

## Production recommendation

Keep `POSTERS_SAFETY_FAIL_OPEN=0`. Start with the defaults while testing the new Sharp/Container renderer. Raise `POSTERS_MAX_DAILY_RENDERS` only after measuring actual render time and Cloudflare usage.

These controls limit application-level render work. They are not a substitute for Cloudflare account-level billing alerts or platform spending controls.

## Cache-first delivery

See [POSTERS-CACHE.md](POSTERS-CACHE.md) for the cache hierarchy, freshness windows, and tests. Cached overlays are checked before credentials, ID lookups, and render budgets. A saved trend overlay may be served for up to 48 hours beyond its freshness deadline while a background update is attempted; failed refreshes do not overwrite it with a plain poster.

Catalog bursts wait up to five seconds for a local rendering slot (maximum 64 queued requests). Rejected queue requests no longer consume a render reservation. Conservation mode reduces admission to one concurrent render; already admitted work may finish.

The existing `DB` binding also gets a small `poster_render_leases` table automatically. A 60-second owner-checked lease coalesces rendering of the same poster variant across Workers; failures impose a five-minute retry cooldown by default (`POSTERS_FAILURE_COOLDOWN_SECONDS`, minimum 30 seconds, maximum one hour). No new Cloudflare service or secrets are required. These changes do not raise daily or hourly budgets.
