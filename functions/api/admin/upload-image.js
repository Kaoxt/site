import {
  assertSameOrigin,
  authServerReady,
  isAdminUser,
  readSession,
} from '../../_lib/nuvio-session.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

const OWNER = 'Kaoxt';
const REPO = 'The-Kollection';
const BRANCH = 'main';
const MAX_FILE_SIZE = 12_000_000;

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

function githubHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'the-kollection-image-admin',
  };
}

async function gh(token, url, options = {}) {
  const res = await fetch(`https://api.github.com${url}`, {
    ...options,
    headers: {
      ...githubHeaders(token),
      ...(options.headers || {}),
    },
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const error = new Error(data?.message || `GitHub API failed (${res.status}).`);
    error.status = res.status;
    throw error;
  }

  return data;
}

function cleanSegment(value, label) {
  const text = String(value || '').trim();

  if (!text || text === '.' || text === '..' || /[\/\\\u0000-\u001f]/.test(text)) {
    throw new Error(`${label} is not valid.`);
  }

  return text;
}

function cleanNestedPath(value) {
  const parts = String(value || '')
    .split(/[\/\\]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (!parts.length || parts.some((part) => part === '.' || part === '..' || /[\u0000-\u001f]/.test(part))) {
    throw new Error('Folder path is not valid.');
  }

  return parts.join('/');
}

function bytesBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;

  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }

  return btoa(binary);
}

function publicUrl(origin, key, version = '') {
  const encoded = key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');

  const suffix = version ? `?v=${encodeURIComponent(version)}` : '';
  return `${origin}/${encoded}${suffix}`;
}

async function commitBinaryFiles({ token, files, message }) {
  const ref = await gh(
    token,
    `/repos/${encodeURIComponent(OWNER)}/${encodeURIComponent(REPO)}/git/ref/heads/${encodeURIComponent(BRANCH)}`
  );

  const parentSha = ref.object.sha;

  const parent = await gh(
    token,
    `/repos/${encodeURIComponent(OWNER)}/${encodeURIComponent(REPO)}/git/commits/${parentSha}`
  );

  const tree = [];

  for (const item of files) {
    const blob = await gh(
      token,
      `/repos/${encodeURIComponent(OWNER)}/${encodeURIComponent(REPO)}/git/blobs`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: bytesBase64(item.bytes),
          encoding: 'base64',
        }),
      }
    );

    tree.push({
      path: item.key,
      mode: '100644',
      type: 'blob',
      sha: blob.sha,
    });
  }

  const nextTree = await gh(
    token,
    `/repos/${encodeURIComponent(OWNER)}/${encodeURIComponent(REPO)}/git/trees`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        base_tree: parent.tree.sha,
        tree,
      }),
    }
  );

  const commit = await gh(
    token,
    `/repos/${encodeURIComponent(OWNER)}/${encodeURIComponent(REPO)}/git/commits`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        tree: nextTree.sha,
        parents: [parentSha],
      }),
    }
  );

  await gh(
    token,
    `/repos/${encodeURIComponent(OWNER)}/${encodeURIComponent(REPO)}/git/refs/heads/${encodeURIComponent(BRANCH)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sha: commit.sha,
        force: false,
      }),
    }
  );

  return {
    sha: commit.sha,
    url: `https://github.com/${OWNER}/${REPO}/commit/${commit.sha}`,
  };
}

export async function onRequestPost(context) {
  try {
    const env = context.env || {};

    if (!authServerReady(env) || !env.GITHUB_TOKEN) {
      return response({
        error: 'Server setup is incomplete. The admin session and GITHUB_TOKEN must be configured.',
      }, 500);
    }

    if (!env.IMAGES) {
      return response({
        error: 'The Cloudflare R2 binding named IMAGES is not configured.',
      }, 500);
    }

    if (!assertSameOrigin(context.request)) {
      return response({ error: 'Cross-origin image uploads are not allowed.' }, 403);
    }

    const session = await readSession(context.request, env);

    if (!session) {
      return response({ error: 'Sign in with Nuvio before uploading artwork.' }, 401);
    }

    if (!isAdminUser(session, env)) {
      return response({ error: 'This Nuvio account is not authorized to upload artwork.' }, 403);
    }

    const form = await context.request.formData();

    let category;
    let folder;

    try {
      category = cleanSegment(form.get('category'), 'Category');
      folder = cleanNestedPath(form.get('folder'));
    } catch (error) {
      return response({ error: error.message }, 400);
    }

    const slots = [
      ['cover', 'cover.webp', false],
      ['backdrop', 'backdrop.webp', false],
      ['logo', 'logo.webp', false],
      ['asIs', '', true],
    ];

    const selected = [];

    for (const [field, fixedFilename, preserveName] of slots) {
      const file = form.get(field);

      if (!file || typeof file.arrayBuffer !== 'function' || !file.size) continue;

      let filename = fixedFilename;
      if (preserveName) {
        try {
          filename = cleanSegment(file.name, 'Filename');
        } catch (error) {
          return response({ error: error.message }, 400);
        }
      }

      if (file.size > MAX_FILE_SIZE) {
        return response({ error: `${filename} is larger than the 12 MB upload limit.` }, 413);
      }

      const looksWebp =
        String(file.type || '').toLowerCase() === 'image/webp' ||
        /\.webp$/i.test(String(file.name || ''));

      if (!looksWebp || !/\.webp$/i.test(filename)) {
        return response({ error: `${filename || file.name} must be uploaded with a .webp filename.` }, 415);
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      const key = `images/${category}/${folder}/${filename}`;

      selected.push({
        field,
        filename,
        key,
        bytes,
      });
    }

    if (!selected.length) {
      return response({ error: 'Choose at least one WebP image to upload.' }, 400);
    }

    let commit;

    try {
      commit = await commitBinaryFiles({
        token: env.GITHUB_TOKEN,
        files: selected,
        message: `Update artwork: ${category}/${folder}`,
      });
    } catch (error) {
      const suffix = error.status === 403
        ? ' Ensure the Cloudflare GITHUB_TOKEN has Contents: Read and write access to Kaoxt/The-Kollection.'
        : '';

      return response({
        error: `GitHub upload failed: ${error.message}.${suffix}`,
      }, error.status === 403 ? 403 : 502);
    }

    const r2Results = await Promise.allSettled(
      selected.map((item) =>
        env.IMAGES.put(item.key, item.bytes, {
          httpMetadata: {
            contentType: 'image/webp',
          },
        })
      )
    );

    const url = new URL(context.request.url);
    const uploadedAt = new Date().toISOString();
    const versionToken = Date.now().toString(36);
    const files = selected.map((item) => ({
      key: item.key,
      path: item.key.replace(/^images\//, ''),
      url: publicUrl(url.origin, item.key, versionToken),
      filename: item.filename,
      category,
      folder,
      uploaded: uploadedAt,
    }));

    /* If an image was replaced, remove the old page-cache copy now. */
    const cache = caches.default;
    context.waitUntil(
      Promise.all(
        files.map((item) =>
          cache.delete(new Request(item.url.split('?')[0], { method: 'GET' })).catch(() => false)
        )
      )
    );

    const failedR2 = r2Results.filter((result) => result.status === 'rejected');

    if (failedR2.length) {
      return response({
        message: 'Artwork was committed to GitHub and will be restored to R2 by the automatic sync workflow.',
        warning: `${failedR2.length} immediate R2 write${failedR2.length === 1 ? '' : 's'} failed, but the GitHub source commit succeeded.`,
        githubCommitUrl: commit.url,
        files,
      }, 202);
    }

    return response({
      message: `${selected.length} artwork file${selected.length === 1 ? '' : 's'} uploaded to GitHub and R2.`,
      githubCommitUrl: commit.url,
      files,
    });
  } catch (error) {
    console.error('Admin image upload error:', error);
    return response({ error: 'The artwork upload could not be completed.' }, 500);
  }
}
