function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': status === 200 ? 'public, max-age=120, s-maxage=300, stale-while-revalidate=900' : 'no-store',
    },
  });
}

const clean = (value) => String(value || '').trim().replace(/^@/, '');
const slugify = (value) => clean(value).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');

function normalizeTraktList(item, username) {
  const list = item?.list || item;
  const ids = list?.ids || {};
  const slug = ids.slug || slugify(list?.name);
  if (!slug) return null;
  return {
    id: `trakt:${username}:${slug}`,
    provider: 'Trakt',
    username,
    name: list?.name || slug,
    description: list?.description || '',
    itemCount: Number(list?.item_count || list?.items || 0) || 0,
    url: `https://trakt.tv/users/${encodeURIComponent(username)}/lists/${encodeURIComponent(slug)}`,
    slug,
  };
}

async function traktLists(username, clientId) {
  if (!clientId) return { items: [], available: false, error: 'TRAKT_CLIENT_ID is not configured.' };
  try {
    const response = await fetch(`https://api.trakt.tv/users/${encodeURIComponent(username)}/lists?extended=full`, {
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'trakt-api-key': clientId,
        'trakt-api-version': '2',
        'user-agent': 'The Kollection/1.0',
      },
    });
    if (!response.ok) throw new Error(`Trakt ${response.status}`);
    const data = await response.json();
    const items = (Array.isArray(data) ? data : []).map((item) => normalizeTraktList(item, username)).filter(Boolean).slice(0, 40);
    return { items, available: true };
  } catch (error) {
    return { items: [], available: true, error: error?.message || 'Trakt lookup failed.' };
  }
}

function extractMdblistHtml(html, username) {
  const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`href=["'](?:https?:\\/\\/(?:www\\.)?mdblist\\.com)?\\/lists\\/${escaped}\\/([^"'?#/]+)[^"']*["']`, 'gi');
  const seen = new Set();
  const items = [];
  let match;
  while ((match = regex.exec(html)) && items.length < 40) {
    const slug = decodeURIComponent(match[1]);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    items.push({
      id: `mdblist:${username}:${slug}`,
      provider: 'MDBList',
      username,
      name: slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      description: '',
      itemCount: 0,
      url: `https://mdblist.com/lists/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`,
      slug,
    });
  }
  return items;
}

function normalizeMdblistJson(data, username) {
  const source = Array.isArray(data) ? data : Array.isArray(data?.lists) ? data.lists : Array.isArray(data?.results) ? data.results : [];
  return source.map((item) => {
    const owner = clean(item?.username || item?.user || item?.owner || username) || username;
    const slug = clean(item?.slug || item?.list_slug || item?.name_slug || item?.id);
    if (!slug) return null;
    return {
      id: `mdblist:${owner}:${slug}`,
      provider: 'MDBList',
      username: owner,
      name: item?.name || item?.title || slug.replace(/[-_]+/g, ' '),
      description: item?.description || '',
      itemCount: Number(item?.items || item?.item_count || item?.count || 0) || 0,
      url: item?.url || `https://mdblist.com/lists/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}`,
      slug,
    };
  }).filter(Boolean).slice(0, 40);
}

async function mdblistLists(username, apiKey) {
  if (apiKey) {
    const attempts = [
      `https://api.mdblist.com/lists/${encodeURIComponent(username)}?apikey=${encodeURIComponent(apiKey)}`,
      `https://api.mdblist.com/lists/users/?username=${encodeURIComponent(username)}&apikey=${encodeURIComponent(apiKey)}`,
    ];
    for (const url of attempts) {
      try {
        const response = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'The Kollection/1.0' } });
        if (!response.ok) continue;
        const data = await response.json();
        const items = normalizeMdblistJson(data, username);
        if (items.length) return { items, available: true };
      } catch {}
    }
  }

  try {
    const response = await fetch(`https://mdblist.com/lists/${encodeURIComponent(username)}`, {
      headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0 TheKollection/1.0' },
    });
    if (!response.ok) throw new Error(`MDBList ${response.status}`);
    const html = await response.text();
    return { items: extractMdblistHtml(html, username), available: true };
  } catch (error) {
    return { items: [], available: false, error: error?.message || 'MDBList lookup failed.' };
  }
}

async function traktUser(username, clientId) {
  if (!clientId) return null;
  try {
    const response = await fetch(`https://api.trakt.tv/users/${encodeURIComponent(username)}?extended=full`, {
      headers: {
        accept: 'application/json',
        'trakt-api-key': clientId,
        'trakt-api-version': '2',
        'user-agent': 'The Kollection/1.0',
      },
    });
    if (!response.ok) return null;
    const data = await response.json();
    const handle = clean(data?.ids?.slug || data?.username || username);
    if (!handle) return null;
    return { provider: 'Trakt', username: handle, name: data?.name || handle, url: `https://trakt.tv/users/${encodeURIComponent(handle)}` };
  } catch { return null; }
}

async function mdblistUser(username) {
  try {
    const response = await fetch(`https://mdblist.com/lists/${encodeURIComponent(username)}`, { headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0 TheKollection/1.0' } });
    if (!response.ok) return null;
    return { provider: 'MDBList', username, name: username, url: `https://mdblist.com/lists/${encodeURIComponent(username)}` };
  } catch { return null; }
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const username = clean(url.searchParams.get('username'));
  const mode = url.searchParams.get('mode') === 'users' ? 'users' : 'lists';
  if (!username || username.length > 64) return json({ error: 'A valid username is required.' }, 400);

  if (mode === 'users') {
    const users = (await Promise.all([
      traktUser(username, env.TRAKT_CLIENT_ID),
      mdblistUser(username),
    ])).filter(Boolean);
    return json({ username, mode, users });
  }

  const [trakt, mdblist] = await Promise.all([
    traktLists(username, env.TRAKT_CLIENT_ID),
    mdblistLists(username, env.MDBLIST_API_KEY),
  ]);
  const items = [...trakt.items, ...mdblist.items];
  return json({
    username,
    mode,
    items,
    providers: {
      trakt: { available: trakt.available, error: trakt.error || null },
      mdblist: { available: mdblist.available, error: mdblist.error || null },
    },
  });
}
