function allowed(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'bingecat.com' || u.hostname.endsWith('.bingecat.com'));
  } catch { return false; }
}

export async function onRequestGet({ request }) {
  const input = new URL(request.url).searchParams.get('url');
  if (!input || !allowed(input)) return new Response('Only HTTPS Bingecat manifest URLs are allowed.', { status: 400 });

  let current = input;
  for (let i = 0; i < 4; i++) {
    const response = await fetch(current, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'The-Kollection-Set-Up-Collection/1.0' },
      redirect: 'manual',
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('Location');
      if (!location) return new Response('Bingecat returned a redirect without a location.', { status: 502 });
      current = new URL(location, current).toString();
      if (!allowed(current)) return new Response('Bingecat redirected to a non-Bingecat host.', { status: 400 });
      continue;
    }
    if (!response.ok) return new Response(`Bingecat manifest returned HTTP ${response.status}.`, { status: 502 });
    const text = await response.text();
    try { JSON.parse(text); } catch { return new Response('Manifest response was not valid JSON.', { status: 502 }); }
    return new Response(text, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }
  return new Response('Too many Bingecat redirects.', { status: 502 });
}
