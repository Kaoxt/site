export async function onRequest({ request }) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);

  // /poster/{type}/{mode}/{id}.webp
  const type = parts[1] || '';
  const mode = parts[2] || 'smart';
  const idPart = parts[3] || '';
  const rawId = idPart.replace(/\.webp$/i, '');

  if (!type || !rawId) {
    return new Response('Expected /poster/{type}/{mode}/{id}.webp', {
      status: 400,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const source = mode === 'tmdb' ? 'tmdb' : mode === 'inherit' ? 'inherit' : 'smart';
  const target = new URL(`/api/posters-v2/${encodeURIComponent(type)}/${encodeURIComponent(rawId)}.webp`, url.origin);

  for (const [key, value] of url.searchParams) target.searchParams.append(key, value);
  if (!target.searchParams.has('source')) target.searchParams.set('source', source);
  if (!target.searchParams.has('tags')) target.searchParams.set('tags', 'trend,rating');
  if (!target.searchParams.has('ratingSource')) target.searchParams.set('ratingSource', 'average');

  return new Response(null, {
    status: 302,
    headers: {
      location: target.toString(),
      'cache-control': 'no-store',
      'x-kollection-poster-route': 'v2-sharp',
    },
  });
}
