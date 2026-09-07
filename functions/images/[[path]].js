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

  // Cache GET responses at the Cloudflare edge.
  // The full URL (including ?v=...) is the cache key, which means query
  // parameters can be used to immediately bypass an older cached copy.
  if (request.method === "GET") {
    const cache = caches.default;
    const cacheKey = new Request(url.toString(), { method: "GET" });

    const cached = await cache.match(cacheKey);
    if (cached) {
      const headers = new Headers(cached.headers);
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
          "Cache-Control": "public, max-age=30, s-maxage=60",
          "Access-Control-Allow-Origin": "*",
          "X-Kollection-Cache": "MISS",
        },
      });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set(
      "Cache-Control",
      "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400"
    );
    headers.set("X-Kollection-Cache", "MISS");

    const response = new Response(object.body, {
      status: 200,
      headers,
    });

    context.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
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
  headers.set(
    "Cache-Control",
    "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400"
  );

  return new Response(null, {
    status: 200,
    headers,
  });
}
