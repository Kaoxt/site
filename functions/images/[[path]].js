const RAW_BASE =
  "https://raw.githubusercontent.com/Kaoxt/The-Kollection/refs/heads/main";

export async function onRequest(context) {
  const { request } = context;

  // This function only needs to serve images.
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  }

  const url = new URL(request.url);

  // Preserve the exact /images/... path from kollection.tv.
  // Also preserve a query string so ?v=2 can be used as a cache-buster.
  const upstreamUrl = `${RAW_BASE}${url.pathname}${url.search}`;

  const upstream = await fetch(upstreamUrl, {
    method: request.method,
    redirect: "follow",

    // Cloudflare edge-cache settings.
    cf: {
      cacheEverything: true,
      cacheTtlByStatus: {
        "200-299": 3600, // 1 hour at Cloudflare's edge
        "404": 60,      // only cache missing files for 1 minute
        "500-599": 0,   // don't cache upstream server errors
      },
    },
  });

  const headers = new Headers(upstream.headers);

  // Nuvio and browser clients may load these from other origins.
  headers.set("Access-Control-Allow-Origin", "*");

  // Browser/device cache: 5 minutes.
  // Cloudflare's edge TTL above remains 1 hour.
  headers.set(
    "Cache-Control",
    "public, max-age=300, stale-while-revalidate=86400"
  );

  // Helpful when testing the route.
  headers.set("X-Kollection-Image-Proxy", "github-edge-cache");

  return new Response(request.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}
