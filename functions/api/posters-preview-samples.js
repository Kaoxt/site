const TMDB_API = 'https://api.themoviedb.org/3';

const MOVIE_GENRES = new Map([
  [28, 'Action'], [12, 'Adventure'], [16, 'Animation'], [35, 'Comedy'], [80, 'Crime'],
  [99, 'Documentary'], [18, 'Drama'], [10751, 'Family'], [14, 'Fantasy'], [36, 'History'],
  [27, 'Horror'], [10402, 'Music'], [9648, 'Mystery'], [10749, 'Romance'],
  [878, 'Sci-Fi'], [10770, 'TV Movie'], [53, 'Thriller'], [10752, 'War'], [37, 'Western'],
]);

const TV_GENRES = new Map([
  [10759, 'Action & Adventure'], [16, 'Animation'], [35, 'Comedy'], [80, 'Crime'],
  [99, 'Documentary'], [18, 'Drama'], [10751, 'Family'], [10762, 'Kids'],
  [9648, 'Mystery'], [10763, 'News'], [10764, 'Reality'], [10765, 'Sci-Fi & Fantasy'],
  [10766, 'Soap'], [10767, 'Talk'], [10768, 'War & Politics'], [37, 'Western'],
]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': status === 200 ? 'public, max-age=300, s-maxage=900, stale-while-revalidate=3600' : 'no-store',
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

function sampleFromTrending(item, type, index) {
  const genreMap = type === 'tv' ? TV_GENRES : MOVIE_GENRES;
  const firstGenre = Array.isArray(item?.genre_ids) ? genreMap.get(Number(item.genre_ids[0])) || '' : '';
  const rating = Number(item?.vote_average);
  return {
    type,
    id: String(item.id),
    trend: `#${index + 1} Today`,
    rating: Number.isFinite(rating) && rating > 0 ? rating.toFixed(1) : '',
    genre: firstGenre,
    age: type === 'tv' ? 'TV-14' : 'PG-13',
    quality: '4K',
  };
}

export async function onRequestGet({ env }) {
  if (!env.TMDB_API_KEY) return json({ error: 'TMDB_API_KEY is not configured.' }, 503);

  try {
    const [movies, tv] = await Promise.all([
      tmdbFetch('/trending/movie/day?language=en-US&page=1', env.TMDB_API_KEY),
      tmdbFetch('/trending/tv/day?language=en-US&page=1', env.TMDB_API_KEY),
    ]);

    const movieResults = (movies.results || []).filter((item) => item?.id);
    const tvResults = (tv.results || []).filter((item) => item?.id);

    const samples = movieResults.slice(0, 2).map((item, index) => sampleFromTrending(item, 'movie', index));
    if (tvResults[0]) samples.push(sampleFromTrending(tvResults[0], 'tv', 0));

    if (samples.length < 3) {
      const fallback = [
        { type: 'movie', id: '27205', trend: '#1 Today', rating: '6.8', genre: 'Drama', age: 'PG-13', quality: '4K' },
        { type: 'movie', id: '155', trend: '#2 Today', rating: '8.5', genre: 'Crime', age: 'PG-13', quality: '4K' },
        { type: 'tv', id: '1399', trend: '#1 Today', rating: '9.2', genre: 'Drama', age: 'TV-MA', quality: '4K' },
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
