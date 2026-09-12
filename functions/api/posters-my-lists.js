const API = 'https://api.mdblist.com';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

const clean = (value) => String(value || '').trim().replace(/^@/, '');
const slugify = (value) => clean(value).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');

function normalizeLists(payload, fallbackUsername = '') {
  const source = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.lists)
      ? payload.lists
      : Array.isArray(payload?.results)
        ? payload.results
        : Array.isArray(payload?.items)
          ? payload.items
          : [];

  return source.map((item) => {
    const owner = clean(
      item?.username ||
      item?.user?.username ||
      item?.user ||
      item?.owner?.username ||
      item?.owner ||
      fallbackUsername
    );
    const slug = clean(item?.slug || item?.list_slug || item?.name_slug || item?.id || slugify(item?.name || item?.title));
    if (!owner || !slug) return null;
    return {
      id: `mdblist:${owner}:${slug}`,
      provider: 'MDBList',
      username: owner,
      name: String(item?.name || item?.title || slug.replace(/[-_]+/g, ' ')),
      description: String(item?.description || ''),
      itemCount: Number(item?.items || item?.item_count || item?.count || 0) || 0,
      likes: Number(item?.likes || item?.like_count || 0) || 0,
      slug,
      url: String(item?.url || `https://mdblist.com/lists/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}`),
      personal: true,
    };
  }).filter(Boolean);
}

async function fetchJson(path, apiKey) {
  const joiner = path.includes('?') ? '&' : '?';
  const response = await fetch(`${API}${path}${joiner}apikey=${encodeURIComponent(apiKey)}`, {
    headers: { accept: 'application/json', 'user-agent': 'The Kollection/1.0' },
  });
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

function usernameFromUser(user) {
  return clean(
    user?.username ||
    user?.user_name ||
    user?.user?.username ||
    user?.profile?.username ||
    user?.trakt_username ||
    user?.name
  );
}

export async function onRequestPost({ request }) {
  let body = {};
  try { body = await request.json(); } catch {}
  const apiKey = String(body?.apiKey || '').trim();
  if (!apiKey || apiKey.length > 256) return json({ error: 'A valid MDBList API key is required.' }, 400);

  try {
    const user = await fetchJson('/user', apiKey);
    if (!user || user?.response === false) return json({ error: 'MDBList rejected this API key.' }, 401);

    const username = usernameFromUser(user);
    const embedded = normalizeLists(user?.lists || user?.my_lists || [], username);
    if (embedded.length) return json({ username, items: embedded });

    const attempts = [];
    if (username) {
      attempts.push(`/lists/${encodeURIComponent(username)}`);
      attempts.push(`/lists/users/?username=${encodeURIComponent(username)}`);
    }
    attempts.push('/user/lists');
    attempts.push('/lists/user');
    attempts.push('/lists');

    for (const path of attempts) {
      const payload = await fetchJson(path, apiKey);
      const items = normalizeLists(payload, username);
      if (items.length) return json({ username: username || items[0]?.username || '', items });
    }

    return json({ username, items: [] });
  } catch (error) {
    return json({ error: error?.message || 'Could not load MDBList My Lists.' }, 502);
  }
}

export function onRequestGet() {
  return json({ error: 'POST only.' }, 405);
}
