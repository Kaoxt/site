# The Kollection Posters v2 (Sharp)

Minimal BetterPosters-style renderer for The Kollection.

## Scope

- Poster-only rendering
- Genuine WebP output
- Sharp-based compositing
- Rounded pill overlays
- Trend, Rating, Genre, Age Rating
- Smart Layout or TMDB-original placement
- No backdrops, logos, thumbnails, anime-specific pipeline, or Cloudflare Images transformations

## Endpoints

Container:

- `GET /health`
- `POST /render`

Pages/Worker test endpoint:

- `/api/posters-v2/movie/27205.webp?tags=trend,rating`
- `/api/posters-v2/tv/{tmdb_id}.webp?tags=trend,rating,genre,age`

## Safety

The public v2 endpoint uses the existing Posters safety guard before calling the renderer. Cached responses are checked before a render slot is reserved.

Current policy:

- 95% application render budget: conservation mode
- 98% application render budget: hard stop for new uncached renders
- Cached posters continue serving

## Deployment

The renderer is intentionally isolated from the existing site and v1 Posters renderer.

Build the container using `poster-renderer-v2/Dockerfile`, deploy it to Cloudflare Containers (or another private container target), then expose its internal render URL to the site as `POSTERS_V2_RENDERER_URL`.

Do not switch `/posters` or the AIOmetadata URL generator to v2 until the Inception test render is successful and container usage has been benchmarked.
