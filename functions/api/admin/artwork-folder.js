import { assertSameOrigin, authServerReady, isAdminUser, readSession } from '../../_lib/nuvio-session.js';

const repo = '/repos/Kaoxt/The-Kollection';
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

async function github(token, path, method = 'GET', body) {
  const res = await fetch(`https://api.github.com${repo}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'kollection-artwork-admin', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`GitHub operation failed (${res.status}). No further deletion was attempted.`);
  return data;
}

export async function onRequestPost({ request, env }) {
  try {
    if (!authServerReady(env) || !env.GITHUB_TOKEN || !env.IMAGES) return reply({ error: 'Artwork administration is not configured.' }, 503);
    if (!assertSameOrigin(request)) return reply({ error: 'Cross-origin requests are not allowed.' }, 403);
    const session = await readSession(request, env);
    if (!session) return reply({ error: 'Sign in before managing artwork.' }, 401);
    if (!isAdminUser(session, env)) return reply({ error: 'Administrator access required.' }, 403);
    const body = await request.json().catch(() => null);
    const { category, folder, action } = body || {};
    const validPart = part => typeof part === 'string' && part.length > 0 && part === part.trim() && part !== '.' && part !== '..' && !/[\\/\u0000-\u001f\u007f]/.test(part);
    if (!validPart(category) || typeof folder !== 'string' || !folder.split('/').every(validPart) || !['preview', 'delete'].includes(action)) return reply({ error: 'Choose a valid artwork folder.' }, 400);
    const prefix = `images/${category}/${folder}/`;
    const gh = (path, method, data) => github(env.GITHUB_TOKEN, path, method, data);
    const ref = await gh('/git/ref/heads/main');
    const parent = await gh(`/git/commits/${ref.object.sha}`);
    const tree = await gh(`/git/trees/${parent.tree.sha}?recursive=1`);
    if (tree.truncated) return reply({ error: 'Repository listing is incomplete. Folder deletion was stopped.' }, 409);
    const sourceFiles = tree.tree.filter(item => item.type === 'blob' && item.path.startsWith(prefix));
    const objects = [];
    let cursor;
    do {
      const page = await env.IMAGES.list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
      objects.push(...page.objects);
      if (page.truncated && (!page.cursor || page.cursor === cursor)) throw new Error('Incomplete artwork listing. Deletion stopped.');
      cursor = page.truncated ? page.cursor : null;
    } while (cursor);
    const files = [...new Set([...sourceFiles.map(x => x.path), ...objects.map(x => x.key)])].sort();
    // Compare both sources at confirmation time; a new/replaced file requires a fresh preview.
    const snapshot = JSON.stringify([sourceFiles.map(x => [x.path, x.sha]).sort(), objects.map(x => [x.key, x.etag || x.httpEtag, x.uploaded]).sort()]);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(snapshot));
    const revision = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
    if (action === 'preview') return reply({ folder: `${category}/${folder}`, files, revision });
    if (!body.revision || body.revision !== revision) return reply({ error: 'The folder changed. Review its files again before deleting.' }, 409);
    if (!files.length) return reply({ error: 'This folder is already empty.' }, 404);
    // Commit source deletion first, so a later sync cannot restore these files.
    if (sourceFiles.length) {
      const nextTree = await gh('/git/trees', 'POST', { base_tree: parent.tree.sha, tree: sourceFiles.map(x => ({ path: x.path, mode: x.mode, type: 'blob', sha: null })) });
      const commit = await gh('/git/commits', 'POST', { message: `Delete artwork folder: ${category}/${folder}`, tree: nextTree.sha, parents: [ref.object.sha] });
      await gh('/git/refs/heads/main', 'PATCH', { sha: commit.sha, force: false });
    }
    try {
      for (let i = 0; i < objects.length; i += 1000) await env.IMAGES.delete(objects.slice(i, i + 1000).map(x => x.key));
    } catch {
      return reply({ error: 'GitHub deletion succeeded, but some R2 files could not be removed. Refresh and use Delete Folder again to finish cleanup.' }, 502);
    }
    return reply({ message: `Deleted ${category}/${folder} (${files.length} files).`, deleted: files });
  } catch (error) {
    console.error('Artwork folder deletion:', error);
    return reply({ error: error.message || 'Folder deletion failed. Refresh before retrying.' }, 502);
  }
}
