import { assertSameOrigin } from '../_lib/nuvio-session.js';

// Never turn this recovery endpoint into a general URL proxy. Self-hosted
// installations are read directly by the browser, not by the Pages worker.
const MIDNIGHT = 'aiometadatafortheweebs.midnightignite.me';
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;

function allowed(input) {
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.hostname !== MIDNIGHT || url.port || url.username || url.password || url.hash) return false;
    const parts = url.pathname.split('/').slice(1).map(decodeURIComponent);
    if (parts.some(part => !part || part === '.' || part === '..' || /[\\/%]/.test(part))) return false;
    return parts.at(-1) === 'manifest.json' && (parts.length === 1 || parts.length >= 3 && parts[0] === 'stremio');
  } catch { return false; }
}

function reply(body, status = 200) {
  return Response.json(body, { status, headers: {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  } });
}

async function boundedJson(body, limit) {
  const reader = body?.getReader();
  if (!reader) throw new Error('invalid');
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new Error('too_large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function onRequestPost({ request }) {
  if (!assertSameOrigin(request)) return reply({ error: 'origin' }, 403);
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return reply({ error: 'input' }, 415);
  let input;
  try { input = (await boundedJson(request.body, 16384))?.url; }
  catch { return reply({ error: 'input' }, 400); }
  if (typeof input !== 'string' || !allowed(input)) return reply({ error: 'unsupported' }, 400);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    let current = input;
    for (let redirect = 0; redirect < 3; redirect++) {
      const response = await fetch(current, {
        headers: { Accept: 'application/json' }, redirect: 'manual', signal: controller.signal,
        cache: 'no-store',
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('Location');
        await response.body?.cancel();
        if (!location) return reply({ error: 'redirect' }, 502);
        current = new URL(location, current).href;
        if (!allowed(current)) return reply({ error: 'redirect' }, 502);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        return reply({ error: 'http', upstreamStatus: response.status }, 502);
      }
      let manifest;
      try { manifest = await boundedJson(response.body, MAX_MANIFEST_BYTES); }
      catch (error) {
        if (controller.signal.aborted) throw error;
        return reply({ error: 'invalid' }, 502);
      }
      if (!manifest || typeof manifest.id !== 'string' || !manifest.id ||
        (manifest.catalogs != null && !Array.isArray(manifest.catalogs)) ||
        (manifest.resources != null && !Array.isArray(manifest.resources))) return reply({ error: 'invalid' }, 502);
      return reply(manifest);
    }
    return reply({ error: 'redirect' }, 502);
  } catch {
    return reply({ error: controller.signal.aborted ? 'timeout' : 'network' }, 502);
  } finally { clearTimeout(timer); }
}
