function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': status === 200 ? 'public, max-age=300, s-maxage=900, stale-while-revalidate=3600' : 'no-store',
    },
  });
}

const decodeHtml = (value = '') => String(value)
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&nbsp;/g, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n) || 32));

const stripTags = (value = '') => decodeHtml(String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
const titleCaseSlug = (slug = '') => decodeURIComponent(slug).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function extractPopularLists(html) {
  const seen = new Set();
  const items = [];
  const anchorRegex = /<a\b[^>]*href=["'](?:https?:\/\/(?:www\.)?mdblist\.com)?\/lists\/([^\/"'?#]+)\/([^"'?#\/]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorRegex.exec(html)) && items.length < 120) {
    const username = decodeURIComponent(match[1] || '').trim();
    const slug = decodeURIComponent(match[2] || '').trim();
    if (!username || !slug || username === 'official') continue;
    const key = `${username.toLowerCase()}:${slug.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const rawText = stripTags(match[3]);
    let name = rawText;
    if (!name || name.length > 120 || /^view|^open|^details$/i.test(name)) name = titleCaseSlug(slug);
    name = name.replace(/\s+by\s+@?[a-z0-9._-]+.*$/i, '').trim() || titleCaseSlug(slug);

    items.push({
      id: `mdblist:${username}:${slug}`,
      provider: 'MDBList',
      username,
      name,
      slug,
      url: `https://mdblist.com/lists/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`,
      itemCount: 0,
      likes: 0,
    });
  }

  return items;
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'user-agent': 'Mozilla/5.0 TheKollection/1.0',
    },
  });
  if (!response.ok) throw new Error(`MDBList ${response.status}`);
  return response.text();
}

export async function onRequestGet() {
  try {
    let sourceUrl = 'https://mdblist.com/toplists/';
    let html = await fetchHtml(sourceUrl);
    let items = extractPopularLists(html);

    if (!items.length) {
      sourceUrl = 'https://mdblist.com/';
      html = await fetchHtml(sourceUrl);
      items = extractPopularLists(html);
    }

    if (!items.length) {
      return json({ error: 'MDBList popular lists are temporarily unavailable.', items: [] }, 502);
    }

    return json({ source: 'MDBList', url: sourceUrl, items });
  } catch (error) {
    return json({ error: error?.message || 'Could not load MDBList popular lists.', items: [] }, 502);
  }
}
