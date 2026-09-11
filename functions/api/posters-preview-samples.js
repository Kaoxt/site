const TMDB_API = 'https://api.themoviedb.org/3';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': status === 200 ? 'public, max-age=300, s-maxage=900' : 'no-store',
    },
  });
}

async function tmdbFetch(path, key) {
  const joiner = path.includes('?') ? '&' : '?';
  const response = await fetch(`${TMDB_API}${path}${joiner}api_key=${encodeURIComponent(key)}`, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`TMDB ${response.status}`);
  return response.json();
}

export async function onRequestGet({ env }) {
  if (!env.TMDB_API_KEY) return json({ error: 'TMDB_API_KEY is not configured.' }, 503);

  try {
    const [movies, tv] = await Promise.all([
      tmdbFetch('/trending/movie/day?language=en-US&page=1', env.TMDB_API_KEY),
      tmdbFetch('/trending/tv/day?language=en-US&page=1', env.TMDB_API_KEY),
    ]);

    const movieItems = (movies.results || []).filter((item) => item?.id).slice(0, 2).map((item) => ({
      type: 'movie',
      id: String(item.id),
    }));
    const tvItem = (tv.results || []).find((item) => item?.id);
    const samples = [...movieItems];
    if (tvItem) samples.push({ type: 'tv', id: String(tvItem.id) });

    if (samples.length < 3) {
      const fallback = [
        { type: 'movie', id: '27205' },
        { type: 'movie', id: '155' },
        { type: 'tv', id: '1399' },
      ];
      for (const item of fallback) {
        if (samples.length >= 3) break;
        if (!samples.some((sample) => sample.type === item.type && sample.id === item.id)) samples.push(item);
      }
    }

    return json({ samples: samples.slice(0, 3) });
  } catch (error) {
    return json({ error: error?.message || 'Could not load preview samples.' }, 502);
  }
}
