# Poster delivery

The AIOMetadata pattern replaces only `poster`. It does not change a title's background, logo, or episode thumbnails. Use the pattern only in **Poster URL Pattern**.

## Cache hierarchy

1. A normalized edge key shares GET/HEAD requests and ignores unrelated query parameters.
2. An R2 image addressed by the requested IMDb/TMDB ID serves without external lookups. Credential or rendering outages do not block this path.
3. On an IMDb miss, cached ID metadata locates the existing TMDB-addressed R2 poster. That legacy poster is reused and an IMDb-addressed copy is saved to avoid future ID lookups. Both IDs still share one render lock.
4. Only a true cache miss renders a new image. Refreshes and cold requests share in-flight work; D1 leases coordinate separate Worker instances. The finished canonical R2 write completes before a successful lease is released.

The artwork version remains `production-cache-19`, preserving previously rendered 500×750 images. The delivery version is independent (`cold-pipeline-3`); generated client patterns use `v=20`.

## First loads

MDBList ratings start alongside TMDB artwork metadata and trends, using the known TMDB ID. TMDB ratings and OMDb still wait for the details they require. Quality lookups retain their own cache and only run when selected. Budget admission happens after all required metadata succeeds, using three database round trips instead of five after schema setup. Daily and hourly limits still apply.

Finished image bytes return before R2 and edge writes finish. `waitUntil` keeps those writes running; the canonical render lease is released only after its R2 write completes. Same-worker callers share the completed bytes during persistence, so an IMDb or TMDB request in that interval does not trigger another render. A storage failure retains the normal retry cooldown. The redundant pre-lease R2 read is removed, while the post-lease check still closes cache races.

Renderer `v2-bp-layout-24` renders directly on the delivered 500×750 canvas instead of building a 780×1170 canvas and shrinking it afterward. The approved overlay measurements are scaled from the existing design grid, so tag/genre/rating proportions stay consistent while Sharp processes substantially fewer pixels. Dynamic colors still use a materialized 64×64 sample, and color analysis is skipped when there is no trend badge. The renderer Worker hashes incoming render requests across two named container instances, matching the configured `max_instances: 2`, while `/health` stays pinned to one instance. The renderer deploy workflow runs image tests before deploying.

## Shared source artwork

TMDB poster bytes now have their own cache, separate from rendered overlays. The renderer asks a Workers-side R2 binding for the selected `w342` TMDB poster before decoding it. A miss is fetched once from TMDB and written under a source-only key that does not include ratings, trend tags, genre, quality, language, color, or any other overlay choice. Different overlay variants can therefore reuse the same source bytes.

The persistent source-art retention window is **30 days since source access**. Accesses refresh the retention timestamp, with persistent touches coalesced to at most once every 12 hours so popular artwork can stay cached indefinitely without rewriting the object for every request. A daily scheduled cleanup removes expired objects under the source-art prefix. Each renderer container also keeps a bounded in-memory LRU (96 images / 24 MB) so repeated variants can skip even the R2 read while the container remains warm.

Custom upstream-addon artwork still follows its existing direct-fetch path rather than being persisted into the shared TMDB source cache. This avoids mixing private or provider-specific artwork URLs into the shared store.

## Trend labels

Daily TMDB rank remains the first choice (`#N Today`). When a title is outside TMDB's page-one daily trend list, the overlay can still show a truthful release status from title metadata: `New` for a short just-released window, `In Cinema` during the bounded theatrical window before home release, or `Coming <date>` for future releases. TV titles can use `New` or `Coming <date>`. If none of those conditions is true, the trend label stays blank rather than inventing popularity.

## Freshness and failures

- Trend posters are fresh for up to six hours, never beyond their stored UTC day. They can be served stale for up to 48 more hours while revalidating through `waitUntil`.
- Other production posters are fresh for seven days and can survive a refresh failure for up to 30 additional days.
- Preview freshness is five minutes for trends, ten minutes for other overlays, or one hour for plain artwork. Its stale window is one hour.
- Stale responses have a 15-second client/CDN TTL, allowing refreshed tags to appear promptly. Internal edge retention is longer, because the Workers Cache API doesn't implement stale-while-revalidate.
- A failed refresh, rating-provider failure, or render-budget denial never overwrites an existing usable overlay. A truly cold title may still need an original-art fallback during an outage or exhausted budget; those responses are `no-store`, not cached as completed overlays.
- A new title still needs its first render. This system does not promise instantaneous cold loads or pre-render the entire TMDB catalog.

## Metadata reuse

TMDB ID lookup results are cached for 30 days, title details/artwork references for one day, and daily trend lists for 30 minutes (partitioned by UTC day). These records are independent of poster styles and rating-source choices, stored in R2 and the edge cache without API keys. MDBList keeps its existing 30-day D1 cache; concurrent rating-source variants share one full MDBList record lookup.

Quality Tags can optionally use AIOStreams without exposing its credentials in generated poster URLs. Configure `POSTERS_AIOSTREAMS_URL` and `POSTERS_AIOSTREAMS_AUTH` (or the compatible `AIOSTREAMS_URL` / `AIOSTREAMS_AUTH` names). The auth value may be a Base64 `user:password` value or a complete `Basic ...` header value. Quality is queried only when the `quality` tag is enabled. Resolved 4K/HD results are cached in D1 for one day on releases newer than two weeks and 30 days on older titles. If no quality source is configured, no quality badge is invented.

## Limits and diagnostics

Daily/hourly rendering safeguards are unchanged. A bounded local queue absorbs bursts; identical variants share work locally and through a short D1 lease. New rendering has a 25-second abort deadline, with shorter individual upstream timeouts. The D1 lease table is created automatically on the existing `DB` binding.

Responses expose `X-Kollection-Delivery`, `X-Kollection-Cache`, `X-Kollection-Persistent-Cache`, `X-Kollection-Stale`, `X-Kollection-Generated-At`, `X-Kollection-Fresh-Until`, `X-Kollection-Source-Cache`, `X-Kollection-Source-Cache-Version`, `X-Kollection-Source-Cache-Key`, and `X-Kollection-Source-Retention-Until` on freshly rendered posters. `Server-Timing: poster` measures origin-handler time, not Nuvio's complete loading time. Cold responses also report `lease`, `metadata`, `ratings`, `trend`, `quality` (when enabled), `admission`, and `renderer` durations. Parallel stages overlap, so their durations must not be added together. A CDN hit can replay those origin diagnostics; check `CF-Cache-Status` and measure client wall time separately.

## Tests

Run `node --test tests/poster-cache.test.mjs` with Node 24 for the delivery pipeline. In `poster-renderer-v2`, run `npm test` for image/source-cache tests. The renderer suite verifies sliding 30-day source retention, in-memory source reuse, and that trend/genre/rating/quality overlays remain visible when cached artwork is used. Tests use deterministic mocks and do not spend production lookups or renders.
