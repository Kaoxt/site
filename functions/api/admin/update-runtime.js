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

const RECOMMENDATION_TITLES = /^(for you|recommend(?:ed)? for you)$/i;
const PLACEHOLDER_ADDON = 'com.aicat.kollection-placeholder.nuvio';

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function normalizeType(value) {
  const v = String(value || '').toLowerCase();
  if (v === 'movie' || v === 'movies') return 'movie';
  if (['series', 'show', 'shows', 'tv'].includes(v)) return 'series';
  if (v === 'all') return 'all';
  return v || 'movie';
}

function getCollections(parsed) {
  if (Array.isArray(parsed)) return parsed;
  for (const key of ['collections', 'data', 'collectionPack']) {
    if (Array.isArray(parsed?.[key])) return parsed[key];
  }
  return null;
}

function getAioConfig(parsed) {
  return parsed?.config && typeof parsed.config === 'object' ? parsed.config : parsed;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function bingecatPlaceholders(withProvider) {
  const rows = [];

  for (let i = 1; i <= 3; i++) {
    rows.push({
      type: 'movie',
      genre: '',
      addonId: PLACEHOLDER_ADDON,
      ...(withProvider ? { provider: 'addon' } : {}),
      catalogId: `aicat_placeholder_movie_${i}`,
    });

    rows.push({
      type: 'series',
      genre: '',
      addonId: PLACEHOLDER_ADDON,
      ...(withProvider ? { provider: 'addon' } : {}),
      catalogId: `aicat_placeholder_series_${i}`,
    });
  }

  return rows;
}

function normalizeSource(source, catalogList = false) {
  if (!source || typeof source !== 'object') return source;

  const out = { ...source };
  out.type = normalizeType(out.type);
  if (out.genre == null) out.genre = '';

  if (!catalogList && out.addonId && !out.provider) out.provider = 'addon';
  if (catalogList) delete out.provider;

  return out;
}

function normalizeCollection(collections) {
  return collections.map((group, index) => {
    const out = clone(group);
    const baseId = String(out.id || `kollection-section-${index + 1}`);
    out.id = /-community$/i.test(baseId) ? baseId : `${baseId}-community`;

    out.folders = (out.folders || []).map((folder) => {
      const f = clone(folder);
      const isRecommendation = RECOMMENDATION_TITLES.test(String(f.title || '').trim());

      if (isRecommendation) {
        f.sources = bingecatPlaceholders(true);
        f.catalogSources = bingecatPlaceholders(false);
      } else {
        if (Array.isArray(f.sources)) {
          f.sources = f.sources.map((source) => normalizeSource(source, false));
        }
        if (Array.isArray(f.catalogSources)) {
          f.catalogSources = f.catalogSources.map((source) => normalizeSource(source, true));
        }
      }

      return f;
    });

    return out;
  });
}

function sanitizeBaseConfig(config) {
  const out = clone(config);
  delete out.catalogs;
  delete out.sessionId;
  delete out.configHash;

  if (out.apiKeys && typeof out.apiKeys === 'object') {
    for (const key of Object.keys(out.apiKeys)) out.apiKeys[key] = '';
  }

  if ('lastModified' in out) out.lastModified = 0;
  if ('configVersion' in out) out.configVersion = 1;

  return out;
}

function collectStats(collections, catalogs) {
  let folders = 0;
  const refs = new Set();

  for (const group of collections) {
    folders += (group.folders || []).length;

    for (const folder of (group.folders || [])) {
      for (const list of [folder.sources, folder.catalogSources]) {
        for (const source of (list || [])) {
          if (source?.addonId === 'aio-metadata' && source?.catalogId) {
            refs.add(String(source.catalogId));
          }
        }
      }
    }
  }

  return {
    sections: collections.length,
    folders,
    catalogs: catalogs.length,
    referencedCatalogs: refs.size,
  };
}

function utf8Base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunk = 0x8000;

  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }

  return btoa(binary);
}

function githubHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'the-kollection-admin',
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
    throw new Error(data?.message || `GitHub API failed (${res.status}).`);
  }

  return data;
}

async function commitFilesAtomic({ token, owner, repo, branch, files, message }) {
  const ref = await gh(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(branch)}`
  );

  const parentSha = ref.object.sha;
  const parent = await gh(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits/${parentSha}`
  );

  const entries = [];

  for (const file of files) {
    const blob = await gh(
      token,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: utf8Base64(file.content),
          encoding: 'base64',
        }),
      }
    );

    entries.push({
      path: file.path,
      mode: '100644',
      type: 'blob',
      sha: blob.sha,
    });
  }

  const tree = await gh(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        base_tree: parent.tree.sha,
        tree: entries,
      }),
    }
  );

  const commit = await gh(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        tree: tree.sha,
        parents: [parentSha],
      }),
    }
  );

  await gh(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs/heads/${encodeURIComponent(branch)}`,
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
    url: `https://github.com/${owner}/${repo}/commit/${commit.sha}`,
  };
}

export async function onRequestPost(context) {
  try {
    const env = context.env || {};

    if (!authServerReady(env) || !env.GITHUB_TOKEN) {
      return response({
        error: 'Server setup is incomplete. Add GITHUB_TOKEN, KOLLECTION_SESSION_SECRET, and NUVIO_ADMIN_USER_ID or NUVIO_ADMIN_EMAIL in Cloudflare.',
      }, 500);
    }

    if (!assertSameOrigin(context.request)) {
      return response({ error: 'Cross-origin publish requests are not allowed.' }, 403);
    }

    const session = await readSession(context.request, env);

    if (!session) {
      return response({ error: 'Sign in with Nuvio before publishing.' }, 401);
    }

    if (!isAdminUser(session, env)) {
      return response({ error: 'This Nuvio account is not authorized to publish runtime updates.' }, 403);
    }

    const form = await context.request.formData();
    const nuvioFile = form.get('nuvio');
    const aioFile = form.get('aio');

    if (
      !nuvioFile || typeof nuvioFile.text !== 'function' ||
      !aioFile || typeof aioFile.text !== 'function'
    ) {
      return response({ error: 'Upload both JSON files.' }, 400);
    }

    if ((nuvioFile.size || 0) > 8_000_000 || (aioFile.size || 0) > 8_000_000) {
      return response({ error: 'One of the files is unexpectedly large (8 MB maximum each).' }, 413);
    }

    let nuvioParsed;
    let aioParsed;

    try {
      [nuvioParsed, aioParsed] = await Promise.all([
        nuvioFile.text().then(JSON.parse),
        aioFile.text().then(JSON.parse),
      ]);
    } catch {
      return response({ error: 'One of the uploaded files is not valid JSON.' }, 400);
    }

    const rawCollections = getCollections(nuvioParsed);

    if (
      !rawCollections?.length ||
      !rawCollections.every((group) => group && Array.isArray(group.folders))
    ) {
      return response({ error: 'The Nuvio file does not contain the expected collection array.' }, 400);
    }

    const aioConfig = getAioConfig(aioParsed);

    if (!aioConfig || !Array.isArray(aioConfig.catalogs)) {
      return response({ error: 'The AIOMetadata file does not contain config.catalogs.' }, 400);
    }

    const collections = normalizeCollection(rawCollections);
    const catalogs = clone(aioConfig.catalogs);
    const base = sanitizeBaseConfig(aioConfig);
    const summary = collectStats(collections, catalogs);
    const now = new Date().toISOString();

    const aioIds = new Set(
      catalogs
        .map((catalog) => String(catalog?.id || ''))
        .filter(Boolean)
    );

    const missing = new Set();

    for (const group of collections) {
      for (const folder of (group.folders || [])) {
        for (const list of [folder.sources, folder.catalogSources]) {
          for (const source of (list || [])) {
            if (
              source?.addonId === 'aio-metadata' &&
              source?.catalogId &&
              !aioIds.has(String(source.catalogId))
            ) {
              missing.add(String(source.catalogId));
            }
          }
        }
      }
    }

    const database = `window.NUVIO_DATABASE = ${JSON.stringify(collections, null, 2)};\n`;
    const catalogJson = JSON.stringify({ catalogs }, null, 2) + '\n';
    const baseJson = JSON.stringify(base, null, 2) + '\n';

    const info = {
      generatedAt: now,
      sourceFiles: {
        nuvio: nuvioFile.name,
        aio: aioFile.name,
      },
      aiometadataVersion: aioParsed?.version || null,
      ...summary,
      missingCatalogIds: [...missing],
      notes: 'Generated by The Kollection admin updater. API keys and session-specific AIOMetadata values were removed.',
    };

    const files = [
      { path: 'runtime/database.kaoxt.js', content: database },
      { path: 'runtime/kaoxt-aio-catalogs.json', content: catalogJson },
      { path: 'runtime/kaoxt-aio-base-config.json', content: baseJson },
      { path: 'runtime/runtime-info.json', content: JSON.stringify(info, null, 2) + '\n' },
    ];

    const owner = env.GITHUB_OWNER || 'Kaoxt';
    const repo = env.GITHUB_REPO || 'site';
    const branch = env.GITHUB_BRANCH || 'main';

    const requestedMessage = String(form.get('message') || '').trim();
    const message =
      requestedMessage ||
      `Update The Kollection runtime (${summary.sections} sections, ${summary.catalogs} catalogs)`;

    const commit = await commitFilesAtomic({
      token: env.GITHUB_TOKEN,
      owner,
      repo,
      branch,
      files,
      message,
    });

    return response({
      ok: true,
      commitSha: commit.sha,
      commitUrl: commit.url,
      summary,
      missingCatalogIds: [...missing],
    });
  } catch (error) {
    console.error(error);
    return response({ error: error?.message || 'Runtime update failed.' }, 500);
  }
}

export function onRequestGet() {
  return response({ error: 'POST only.' }, 405);
}
