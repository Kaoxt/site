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

function parseListUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return {};
  try {
    const url = new URL(raw, 'https://mdblist.com');
    const match = url.pathname.match(/^\/lists\/([^/]+)\/([^/?#]+)/i);
    if (!match) return {};
    return { username: decodeURIComponent(match[1]), slug: decodeURIComponent(match[2]) };
  } catch {
    return {};
  }
}

function normalizeLists(payload) {
  const source = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.lists)
      ? payload.lists
      : Array.isArray(payload?.results)
        ? payload.results
        : Array.isArray(payload?.items)
          ? payload.items
          : [];

  const seen = new Set();
  const items = [];
  for (const item of source) {
    const fromUrl = parseListUrl(item?.url || item?.list_url || item?.share_url || '');
    const owner = clean(
      item?.username ||
      item?.user?.username ||
      item?.user ||
      item?.owner?.username ||
      item?.owner ||
      fromUrl.username
    );
    const slug = clean(item?.slug || item?.list_slug || item?.name_slug || fromUrl.slug || item?.id || slugify(item?.name || item?.title));
    if (!owner || !slug) continue;
    const key = `${owner}:${slug}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      id: `mdblist:${owner}:${slug}`,
      provider: 'MDBList',
      username: owner,
      name: String(item?.name || item?.title || slug.replace(/[-_]+/g, ' ')),
      description: String(item?.description || ''),
      itemCount: Number(item?.items || item?.item_count || item?.count || 0) || 0,
      likes: Number(item?.likes || item?.like_count || 0) || 0,
      slug,
      url: String(item?.url || item?.list_url || `https://mdblist.com/lists/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}`),
      personal: true,
    });
    if (items.length >= 500) break;
  }
  return items;
}

export async function onRequestPost({ request }) {
  let body = {};
  try { body = await request.json(); } catch {}
  const apiKey = String(body?.apiKey || '').trim();
  if (!apiKey || apiKey.length > 256) return json({ error: 'A valid MDBList API key is required.' }, 400);

  try {
    const response = await fetch(`${API}/lists/user?apikey=${encodeURIComponent(apiKey)}`, {
      headers: { accept: 'application/json', 'user-agent': 'The Kollection/1.0' },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message = payload?.detail || payload?.error || payload?.message || `MDBList returned ${response.status}.`;
      return json({ error: String(message) }, response.status === 401 || response.status === 403 ? 401 : 502);
    }

    const items = normalizeLists(payload);
    return json({ items, count: items.length });
  } catch (error) {
    return json({ error: error?.message || 'Could not load MDBList My Lists.' }, 502);
  }
}

export function onRequestGet() {
  return json({ error: 'POST only.' }, 405);
}
