function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store',
    },
  });
}

function parseCookies(request) {
  const header = request.headers.get('cookie') || '';
  return Object.fromEntries(header.split(';').map((part) => {
    const i = part.indexOf('=');
    return i < 0 ? ['', ''] : [part.slice(0, i).trim(), part.slice(i + 1).trim()];
  }).filter(([key]) => key));
}

function fromBase64url(value = '') {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function deriveKey(secret) {
  const raw = new TextEncoder().encode(secret);
  const digest = await crypto.subtle.digest('SHA-256', raw);
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['decrypt']);
}

async function decryptJson(value, secret) {
  const packed = fromBase64url(value);
  if (packed.length <= 12) throw new Error('invalid_session');
  const iv = packed.slice(0, 12);
  const ciphertext = packed.slice(12);
  const key = await deriveKey(secret);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(plain));
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function normalizeLists(payload) {
  const rows = Array.isArray(payload) ? payload : [];
  return rows.map((entry) => {
    const list = entry?.list || entry || {};
    return {
      id: list?.ids?.trakt || list?.ids?.slug || list?.name || '',
      name: list?.name || 'Untitled list',
      description: list?.description || '',
      privacy: list?.privacy || '',
      displayNumbers: Boolean(list?.display_numbers),
      allowComments: Boolean(list?.allow_comments),
      sortBy: list?.sort_by || '',
      sortHow: list?.sort_how || '',
      itemCount: Number(list?.item_count || 0) || 0,
      likes: Number(list?.likes || 0) || 0,
      commentCount: Number(list?.comment_count || 0) || 0,
      ids: list?.ids || {},
      provider: 'Trakt',
    };
  }).filter((item) => item.id || item.name);
}

export async function onRequestGet({ request, env }) {
  const clientId = String(env.TRAKT_CLIENT_ID || '').trim();
  const sessionSecret = String(env.POSTERS_TRAKT_SESSION_SECRET || '').trim();
  if (!clientId || !sessionSecret) {
    return json({ connected: false, error: 'trakt_not_configured', items: [] }, 503);
  }

  const sessionCookie = parseCookies(request).kollection_trakt || '';
  if (!sessionCookie) return json({ connected: false, items: [] }, 401);

  let session;
  try {
    session = await decryptJson(sessionCookie, sessionSecret);
  } catch {
    return json({ connected: false, error: 'invalid_session', items: [] }, 401);
  }

  const accessToken = String(session?.access_token || '').trim();
  if (!accessToken) return json({ connected: false, error: 'missing_token', items: [] }, 401);

  const now = Math.floor(Date.now() / 1000);
  const createdAt = Number(session?.created_at || 0) || 0;
  const expiresIn = Number(session?.expires_in || 0) || 0;
  if (createdAt && expiresIn && now >= createdAt + expiresIn - 60) {
    return json({ connected: false, error: 'token_expired', reconnect: true, items: [] }, 401);
  }

  const tokenHash = await sha256Hex(accessToken);
  const cacheKey = new Request(`https://kollection.internal/trakt/lists/${tokenHash}`, { method: 'GET' });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    const data = await cached.json().catch(() => null);
    if (data) return json({ ...data, cached: true });
  }

  const response = await fetch('https://api.trakt.tv/users/me/lists', {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`,
      'trakt-api-key': clientId,
      'trakt-api-version': '2',
    },
  });

  if (response.status === 401) {
    return json({ connected: false, error: 'trakt_unauthorized', reconnect: true, items: [] }, 401);
  }
  if (!response.ok) {
    return json({ connected: true, error: `trakt_${response.status}`, items: [] }, 502);
  }

  const payload = await response.json().catch(() => []);
  const body = {
    connected: true,
    source: 'Trakt',
    fetchedAt: new Date().toISOString(),
    items: normalizeLists(payload),
  };

  const cacheResponse = new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=900',
    },
  });
  await cache.put(cacheKey, cacheResponse);

  return json({ ...body, cached: false });
}
