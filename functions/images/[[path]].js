export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  }

  if (!env.IMAGES) {
    return new Response("R2 binding IMAGES is not configured", {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const url = new URL(request.url);

  // R2 keys mirror the GitHub repository path:
  // /images/Discover/Popular/backdrop.webp
  // -> images/Discover/Popular/backdrop.webp
  let key;
  try {
    key = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  } catch {
    return new Response("Bad image path", {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (!key.startsWith("images/") || key.includes("..")) {
    return new Response("Bad image path", {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }

  // Keep already-saved Nuvio setups working when their artwork URLs use an
  // older display name, casing, or historical folder spelling. R2 keeps the
  // canonical repository keys, so normalize aliases before every lookup.
  key = key
    .replace(/^images\/Discover\/Recommended For You\//i, "images/Discover/For You/")
    .replace(/^images\/International Cinema\//i, "images/World/")
    .replace(/^images\/Networks\/Syfy\//i, "images/Networks/SYFY/")
    .replace(/^images\/Franchises\/Jurassic Park\//i, "images/Franchises/Jurrasic Park/")
    .replace(/^images\/Actors\/Robert Downey Jr\//i, "images/Actors/Robert Downey Jr./")
    .replace(/^images\/Directors\/Guillermo Del Toro\//i, "images/Directors/Guillermo del Toro/")
    .replace(/^images\/Based On\/True Events\//i, "images/Based On/True Stories/");

  // Cache GET responses at the Cloudflare edge.
  // Build the internal cache key from the current R2 ETag so replacing an
  // image at the same public URL is visible immediately without requiring
  // callers to add a ?v= cache-buster.
  if (request.method === "GET") {
    const objectHead = await env.IMAGES.head(key);

    if (objectHead === null) {
      return new Response("Image not found", {
        status: 404,
        headers: {
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
          "X-Kollection-Cache": "MISS",
        },
      });
    }

    const cache = caches.default;
    const cacheUrl = new URL(url.toString());
    cacheUrl.searchParams.set(
      "__r2etag",
      objectHead.httpEtag || objectHead.etag || "current"
    );
    const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });

    const cached = await cache.match(cacheKey);
    if (cached) {
      const headers = new Headers(cached.headers);
      // Do not let browsers or Cloudflare's outer HTTP cache pin a stale image
      // at the public URL. The Worker Cache API above is the only cache layer.
      headers.set("Cache-Control", "no-store, max-age=0");
      headers.set("CDN-Cache-Control", "no-store");
      headers.set("Cloudflare-CDN-Cache-Control", "no-store");
      headers.set("X-Kollection-Cache", "HIT");
      return new Response(cached.body, {
        status: cached.status,
        statusText: cached.statusText,
        headers,
      });
    }

    const object = await env.IMAGES.get(key);

    if (object === null) {
      return new Response("Image not found", {
        status: 404,
        headers: {
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
          "X-Kollection-Cache": "MISS",
        },
      });
    }

    const cacheHeaders = new Headers();
    object.writeHttpMetadata(cacheHeaders);
    cacheHeaders.set("etag", object.httpEtag);
    cacheHeaders.set("Access-Control-Allow-Origin", "*");
    cacheHeaders.set("Cache-Control", "public, max-age=0, s-maxage=3600");
    cacheHeaders.set("X-Kollection-Cache", "MISS");

    const cacheResponse = new Response(object.body, {
      status: 200,
      headers: cacheHeaders,
    });

    // Store a fast edge copy under the ETag-versioned internal cache key.
    context.waitUntil(cache.put(cacheKey, cacheResponse.clone()));

    // But never cache the public URL in the browser or Cloudflare's outer cache,
    // otherwise replacing backdrop.webp can keep returning the previous image.
    const publicHeaders = new Headers(cacheHeaders);
    publicHeaders.set("Cache-Control", "no-store, max-age=0");
    publicHeaders.set("CDN-Cache-Control", "no-store");
    publicHeaders.set("Cloudflare-CDN-Cache-Control", "no-store");

    return new Response(cacheResponse.body, {
      status: 200,
      headers: publicHeaders,
    });
  }

  // HEAD requests: return metadata without downloading the object body.
  const object = await env.IMAGES.head(key);

  if (object === null) {
    return new Response(null, {
      status: 404,
      headers: {
        "Cache-Control": "public, max-age=30, s-maxage=60",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Cache-Control", "no-store, max-age=0");
  headers.set("CDN-Cache-Control", "no-store");
  headers.set("Cloudflare-CDN-Cache-Control", "no-store");

  return new Response(null, {
    status: 200,
    headers,
  });
}
