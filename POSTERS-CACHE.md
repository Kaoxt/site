# Poster delivery

The AIOMetadata pattern replaces only `poster`. It does not change a title's background, logo, or episode thumbnails. Use the pattern only in **Poster URL Pattern**.

## Cache hierarchy

1. A normalized edge key shares GET/HEAD requests and ignores unrelated query parameters.
2. An R2 image addressed by the requested IMDb/TMDB ID serves without external lookups. Credential or rendering outages do not block this path.
3. On an IMDb miss, cached ID metadata locates the existing TMDB-addressed R2 poster. That legacy poster is reused and an IMDb-addressed copy is saved to avoid future ID lookups. Both IDs still share one render lock.
4. Only a true cache miss renders a new image. Refreshes and cold requests share in-flight work; D1 leases coordinate separate Worker instances. The finished canonical R2 write completes before a successful lease is released.

The artwork version remains `production-cache-19`, preserving previously rendered 500×750 images. The delivery version is independent (`cold-pipeline-3`); generated client patterns use `v=24`. The layout version is part of both edge and persistent cache keys, so visual revisions do not require a global artwork-cache purge.

## First loads

MDBList ratings start alongside TMDB artwork metadata and trends, using the known TMDB ID. TMDB ratings and OMDb still wait for the details they require. Quality lookups retain their own cache and only run when selected. Budget admission happens after all required metadata succeeds, using three database round trips instead of five after schema setup. Daily and hourly limits still apply.

Finished image bytes return before R2 and edge writes finish. `waitUntil` keeps those writes running; the canonical render lease is released only after its R2 write completes. Same-worker callers share the completed bytes during persistence, so an IMDb or TMDB request in that interval does not trigger another render. A storage failure retains the normal retry cooldown. The redundant pre-lease R2 read is removed, while the post-lease check still closes cache races.

Renderer `v2-bp-layout-26` renders directly on the delivered 500×750 canvas instead of building a 780×1170 canvas and shrinking it afterward. Its overlay geometry follows the compact BetterPosters-style presentation: a shorter top tab with rounded lower corners, Inter typography, split trend-left/quality-right placement, a subtler age badge, and smaller genre/rating text over a restrained bottom gradient. Adaptive trend colors are intentionally darkened for reliable white-text contrast. The renderer Worker hashes incoming render requests across four named container instances, matching the configured `max_instances: 4`, while `/health` stays pinned to one instance. The renderer deploy workflow runs image tests before deploying.

## Shared source artwork

Renderer `v2-bp-layout-29` keeps the same 500×750 WebP delivery size while increasing the on-poster Trend, quality, audio, age, genre, and rating typography/padding for better readability in Nuvio. The `v=24` client layout key isolates these larger overlays from previously cached v23 artwork. It also retains the source-art coalescing behavior from layout-28, including origin fallback, so overlay variants share one download. Successful centered title logos are cached after trimming and fitting for 24 hours, with an LRU limit of 64 logos / 8 MB per container; concurrent requests share the same logo work and failed lookups remain retryable. The selected TMDB logo source is also retained in the shared source-art R2 cache at `w500`, so a later container can reuse it instead of downloading the logo from TMDB again. Title placement, output dimensions, WebP quality, and finished-poster cache keys are unchanged.

Compositing now feeds the WebP encoder directly, removing a redundant full-canvas raw-buffer export and reload. A local fixture comparison produced byte-identical output for plain, centered-logo, title-text, and quality-tag variants. A 20-variant fixture batch reduced logo downloads from 20 to 1 and renderer elapsed time from 3035 ms to 2580 ms (about 15%). This is a local renderer measurement, not an end-to-end Nuvio latency guarantee; first-time provider lookups and container startup still apply.

TMDB poster bytes now have their own cache, separate from rendered overlays. The renderer asks a Workers-side R2 binding for the selected `w342` TMDB poster before decoding it. A miss is fetched once from TMDB and written under a source-only key that does not include ratings, trend tags, genre, quality, language, color, or any other overlay choice. Different overlay variants can therefore reuse the same source bytes.

The persistent source-art retention window is **30 days since source access**. Accesses refresh the retention timestamp, with persistent touches coalesced to at most once every seven days so normal repeat loads do not pause for an R2 writeback. A daily scheduled cleanup removes expired objects under the poster- and logo-source prefixes. Each renderer container also keeps a bounded in-memory LRU (96 source images / 24 MB) so repeated variants can skip even the R2 read while the container remains warm.

Independent overlay assets are now built concurrently inside the Sharp renderer (top tags, age badge, centered title/logo, and bottom info) while preserving the same final composite order and WebP settings. This reduces CPU time on cold compositions without invalidating existing finished-poster cache keys.\n\nOn a cold finished-poster miss, the API now begins warming the selected TMDB poster source and title-logo source as soon as the TMDB metadata response identifies them. That warm request is pinned to the same renderer shard that will do the final composition and runs in parallel with rating, trend, and quality lookups. It is deliberately kept off the critical response path: if the final render catches up to an in-progress source warm, the renderer's single-flight source loader shares that work instead of starting a second download.

For AIOMetadata custom poster patterns, generated Kollection configs leave `usePosterProxy` off. New Smart Poster setups use a deterministic configuration token URL such as `https://kollection.tv/p/k1sd0sf/{language_short}/{type}/{id}.webp`. The token represents the normalized poster preferences, not a user account: identical settings produce the same token, while changing tags, rating source, source style, or Trend Tag details produces a different token. This lets users keep editable preferences while maximizing shared cache reuse across Nuvio profiles. The token route has its own Cloudflare edge lookup and then delegates misses to the existing v2/R2 poster engine. The older query-string endpoint remains available for internal previews and diagnostics, but new setup output uses the token route.

Custom upstream-addon artwork still follows its existing direct-fetch path rather than being persisted into the shared TMDB source cache. This avoids mixing private or provider-specific artwork URLs into the shared store.

## Trend Tag details

The Trend Tag is now a configurable discovery slot rather than only a TMDB rank/release label. Poster URLs carry a `trendDetails` list with independently selectable values: `studio,director,cast,inCinema,rank,newMovie,comingSoon,newSeries,returningSeries,limitedSeries`. The default priority is notable studio, notable director, notable cast, **In Cinema**, daily rank, New Movie, Coming Soon, New Series, Returning Series, then Limited Series. This lets a matching title show labels such as `Christopher Nolan Film`, `A24 Film`, or `In Cinema`, and every movie/series lifecycle label can be disabled on its own without turning off the overall Trend Tag.

Director/cast credits are appended to the existing TMDB details request only when those Trend Tag details are selected. The daily trending endpoint is skipped when Daily Rank is disabled, so user choices can also reduce upstream work. Movie lifecycle signals are evaluated independently, so a film can qualify for both New Movie and In Cinema and the selected priority decides which label is shown. Existing v22 configs that used the old grouped `release` choice are automatically expanded to all six lifecycle choices. The selected detail list is included in edge and persistent poster cache variants.

## Rich quality tags

AIOStreams quality parsing now preserves one useful token from each available category: resolution (`4K`/`HD`), source (`REMUX`/`WEB-DL`), visual format (`DV`/`HDR10+`/`HDR`), and audio (`Atmos`/`DTS:X`). The top-right quality tag combines resolution and visual format (for example `4K · DV`), while audio is rendered as a smaller companion tag underneath. Cached legacy `4K`/`HD` values remain readable.

## Trend labels

Daily TMDB rank remains the first choice (`#N Today`). When a title is outside TMDB's page-one daily trend list, the overlay can still show a truthful release status from title metadata: `New` for a short just-released window, `In Cinema` during the bounded theatrical window before home release, or `Coming <date>` for future releases. TV titles can use `New Series`, `Limited Series`, `Returning`, or `Coming <date>` based on TMDB lifecycle metadata. If none of those conditions is true, the trend label stays blank rather than inventing popularity.

## Freshness and failures

- Dynamic Trend posters (daily rank and release/lifecycle labels) are fresh for up to six hours, never beyond their stored UTC day. They can be served stale for up to 48 more hours while revalidating through `waitUntil`.
- Static curated Trend labels such as director, studio, and cast spotlights are treated like stable production artwork: they stay fresh for seven days instead of being needlessly refreshed every day. This is especially important for rows such as Christopher Nolan films.
- Other production posters are fresh for seven days and can survive a refresh failure for up to 30 additional days.
- Preview freshness is five minutes for trends, ten minutes for other overlays, or one hour for plain artwork. Its stale window is one hour.
- Stable production responses now advertise up to seven days of client/CDN freshness. Dynamic Trend responses keep their shorter six-hour cap. Stale responses have a 15-second client/CDN TTL, allowing refreshed tags to appear promptly. Internal edge retention is longer, because the Workers Cache API doesn't implement stale-while-revalidate.
- Persistent R2 hits expose their ETag and exact content length. Conditional requests can return HTTP 304 without retransferring the WebP bytes. Clearing Nuvio's local cache still forces a download, but it does not remove the shared R2 or edge copies and must not trigger a new render.
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
