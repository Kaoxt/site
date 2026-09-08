import {
  assertSameOrigin,
  authServerReady,
  isAdminUser,
  readSession,
} from '../../_lib/nuvio-session.js';

const OWNER = 'Kaoxt';
const REPO = 'site';
const BRANCH = 'main';
const MAX_EDIT_BYTES = 1_500_000;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_UPLOAD_FILES = 10;
const MAX_UPLOAD_BATCH_BYTES = 50 * 1024 * 1024;

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

const TEXT_EXTENSIONS = new Set([
  'html', 'htm', 'css', 'js', 'mjs', 'cjs', 'json', 'md', 'txt',
  'yml', 'yaml', 'xml', 'svg', 'toml', 'ini', 'csv', 'ts', 'tsx',
  'jsx', 'webmanifest', 'map',
]);

const TEXT_BASENAMES = new Set([
  '_headers',
  '_redirects',
  '.gitignore',
  '.gitattributes',
  'LICENSE',
]);

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
    'User-Agent': 'the-kollection-site-file-manager',
  };
}

async function gh(token, url, options = {}, allow404 = false) {
  const res = await fetch(`https://api.github.com${url}`, {
    ...options,
    headers: {
      ...githubHeaders(token),
      ...(options.headers || {}),
    },
  });

  if (allow404 && res.status === 404) return null;

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const error = new Error(data?.message || `GitHub API failed (${res.status}).`);
    error.status = res.status;
    error.data = data;
    throw error;
  }

  return data;
}

function cleanPath(value, allowEmpty = true) {
  const raw = String(value || '').trim().replace(/^\/+|\/+$/g, '');

  if (!raw) {
    if (allowEmpty) return '';
    throw new Error('A repository path is required.');
  }

  const parts = raw.split('/');

  if (
    parts.some((part) =>
      !part ||
      part === '.' ||
      part === '..' ||
      /[\u0000-\u001f]/.test(part)
    )
  ) {
    throw new Error('The repository path is not valid.');
  }

  return parts.join('/');
}

function cleanFileName(value) {
  const name = String(value || '').trim();
  if (
    !name ||
    name === '.' ||
    name === '..' ||
    /[/\\\u0000-\u001f]/.test(name)
  ) {
    throw new Error('A file name is not valid.');
  }
  return name;
}

function encodeRepoPath(path) {
  return String(path || '')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function basename(path) {
  return String(path || '').split('/').filter(Boolean).at(-1) || '';
}

function isEditable(path, size) {
  if (Number(size || 0) > MAX_EDIT_BYTES) return false;

  const name = basename(path);
  if (TEXT_BASENAMES.has(name)) return true;

  const dot = name.lastIndexOf('.');
  if (dot < 0) return true;

  return TEXT_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

function b64ToBytes(value) {
  const normalized = String(value || '').replace(/\s+/g, '');
  const binary = atob(normalized);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function bytesToB64(bytes) {
  let binary = '';
  const chunk = 0x8000;

  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }

  return btoa(binary);
}

function textToB64(text) {
  return bytesToB64(new TextEncoder().encode(String(text ?? '')));
}

function b64ToText(value) {
  return new TextDecoder('utf-8', { fatal: false }).decode(b64ToBytes(value));
}

function itemShape(item) {
  return {
    name: String(item.name || ''),
    path: String(item.path || ''),
    type: item.type === 'dir' ? 'dir' : 'file',
    size: Number(item.size || 0),
    sha: String(item.sha || ''),
    htmlUrl: item.html_url || null,
    downloadUrl: item.download_url || null,
  };
}

async function requireAdmin(context, write = false) {
  const env = context.env || {};

  if (!authServerReady(env)) {
    return {
      error: response({
        error: 'Administrator authentication is not configured on this Pages project.',
      }, 500),
    };
  }

  if (!env.GITHUB_TOKEN) {
    return {
      error: response({
        error: 'GITHUB_TOKEN is not configured on this Pages project.',
      }, 500),
    };
  }

  if (write && !assertSameOrigin(context.request)) {
    return {
      error: response({ error: 'Cross-origin repository changes are not allowed.' }, 403),
    };
  }

  const session = await readSession(context.request, env);

  if (!session) {
    return {
      error: response({ error: 'Sign in with Nuvio to use the file manager.' }, 401),
    };
  }

  if (!isAdminUser(session, env)) {
    return {
      error: response({ error: 'This Nuvio account is not authorized to manage the repository.' }, 403),
    };
  }

  return {
    token: env.GITHUB_TOKEN,
    session,
  };
}

async function getContents(token, path, allow404 = false) {
  const encoded = path ? `/${encodeRepoPath(path)}` : '';
  return gh(
    token,
    `/repos/${OWNER}/${REPO}/contents${encoded}?ref=${encodeURIComponent(BRANCH)}`,
    {},
    allow404
  );
}

async function getHead(token) {
  const ref = await gh(
    token,
    `/repos/${OWNER}/${REPO}/git/ref/heads/${encodeURIComponent(BRANCH)}`
  );

  const commit = await gh(
    token,
    `/repos/${OWNER}/${REPO}/git/commits/${ref.object.sha}`
  );

  return {
    refSha: ref.object.sha,
    treeSha: commit.tree.sha,
  };
}

async function createBlob(token, bytes) {
  const blob = await gh(
    token,
    `/repos/${OWNER}/${REPO}/git/blobs`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: bytesToB64(bytes),
        encoding: 'base64',
      }),
    }
  );

  return blob.sha;
}

async function commitTree(token, entries, message) {
  const head = await getHead(token);

  const tree = await gh(
    token,
    `/repos/${OWNER}/${REPO}/git/trees`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        base_tree: head.treeSha,
        tree: entries,
      }),
    }
  );

  const commit = await gh(
    token,
    `/repos/${OWNER}/${REPO}/git/commits`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: String(message || 'Update site files').slice(0, 140),
        tree: tree.sha,
        parents: [head.refSha],
      }),
    }
  );

  try {
    await gh(
      token,
      `/repos/${OWNER}/${REPO}/git/refs/heads/${encodeURIComponent(BRANCH)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sha: commit.sha,
          force: false,
        }),
      }
    );
  } catch (error) {
    if (error.status === 422) {
      const conflict = new Error('The repository changed while this action was being prepared. Refresh the file manager and try again.');
      conflict.status = 409;
      throw conflict;
    }
    throw error;
  }

  return commit;
}

export async function onRequestGet(context) {
  try {
    const auth = await requireAdmin(context, false);
    if (auth.error) return auth.error;

    const url = new URL(context.request.url);

    let path;
    try {
      path = cleanPath(url.searchParams.get('path') || '', true);
    } catch (error) {
      return response({ error: error.message }, 400);
    }

    const wantsContent = url.searchParams.get('content') === '1';
    const contents = await getContents(auth.token, path, false);

    if (Array.isArray(contents)) {
      const items = contents
        .map(itemShape)
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });

      return response({
        repository: `${OWNER}/${REPO}`,
        branch: BRANCH,
        path,
        items,
      });
    }

    const file = itemShape(contents);
    const editable = isEditable(file.path, file.size);
    let content = null;

    if (wantsContent && editable) {
      if (contents.encoding !== 'base64' || typeof contents.content !== 'string') {
        return response({
          error: 'GitHub did not return editable file content for this file.',
        }, 415);
      }

      content = b64ToText(contents.content);
    }

    return response({
      repository: `${OWNER}/${REPO}`,
      branch: BRANCH,
      file: {
        ...file,
        editable,
        content,
      },
    });
  } catch (error) {
    console.error('Site file manager GET error:', error);

    if (error.status === 404) {
      return response({ error: 'That repository path does not exist.' }, 404);
    }

    if (error.status === 403) {
      return response({
        error: 'GitHub denied access. Verify that GITHUB_TOKEN has Contents: Read and write access to Kaoxt/site.',
      }, 403);
    }

    return response({
      error: error.message || 'The repository could not be loaded.',
    }, error.status || 500);
  }
}

async function saveText(token, body) {
  const path = cleanPath(body.path, false);
  const suppliedSha = String(body.sha || '').trim();
  const current = await getContents(token, path, true);

  if (Array.isArray(current)) {
    const error = new Error('That path is a directory, not a file.');
    error.status = 400;
    throw error;
  }

  if (current && suppliedSha && String(current.sha || '') !== suppliedSha) {
    const error = new Error('This file changed in GitHub after it was opened. Refresh before saving.');
    error.status = 409;
    throw error;
  }

  if (current && !suppliedSha) {
    const error = new Error('That file already exists. Open it before replacing it.');
    error.status = 409;
    throw error;
  }

  const encoded = textToB64(body.content ?? '');

  const data = await gh(
    token,
    `/repos/${OWNER}/${REPO}/contents/${encodeRepoPath(path)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: String(body.message || (current ? `Update ${path}` : `Add ${path}`)).slice(0, 140),
        content: encoded,
        branch: BRANCH,
        ...(current ? { sha: current.sha } : {}),
      }),
    }
  );

  return {
    path,
    commitSha: data.commit?.sha || '',
    htmlUrl: data.content?.html_url || null,
  };
}

async function deleteFile(token, body) {
  const path = cleanPath(body.path, false);
  const suppliedSha = String(body.sha || '').trim();

  if (!suppliedSha) {
    const error = new Error('The current file SHA is required before deleting.');
    error.status = 400;
    throw error;
  }

  const current = await getContents(token, path, false);

  if (Array.isArray(current)) {
    const error = new Error('Folders cannot be deleted directly. Delete their files first.');
    error.status = 400;
    throw error;
  }

  if (String(current.sha || '') !== suppliedSha) {
    const error = new Error('This file changed in GitHub after it was opened. Refresh before deleting it.');
    error.status = 409;
    throw error;
  }

  const data = await gh(
    token,
    `/repos/${OWNER}/${REPO}/contents/${encodeRepoPath(path)}`,
    {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: String(body.message || `Delete ${path}`).slice(0, 140),
        sha: current.sha,
        branch: BRANCH,
      }),
    }
  );

  return {
    path,
    commitSha: data.commit?.sha || '',
  };
}

async function renameFile(token, body) {
  const sourcePath = cleanPath(body.sourcePath, false);
  const destinationPath = cleanPath(body.destinationPath, false);
  const suppliedSha = String(body.sha || '').trim();

  if (sourcePath === destinationPath) {
    const error = new Error('The source and destination paths are the same.');
    error.status = 400;
    throw error;
  }

  const [source, destination] = await Promise.all([
    getContents(token, sourcePath, false),
    getContents(token, destinationPath, true),
  ]);

  if (Array.isArray(source)) {
    const error = new Error('Folder moves are not supported in this version. Move files individually.');
    error.status = 400;
    throw error;
  }

  if (destination) {
    const error = new Error('A file or folder already exists at the destination path.');
    error.status = 409;
    throw error;
  }

  if (!suppliedSha || String(source.sha || '') !== suppliedSha) {
    const error = new Error('This file changed in GitHub after it was opened. Refresh before moving it.');
    error.status = 409;
    throw error;
  }

  const commit = await commitTree(
    token,
    [
      {
        path: destinationPath,
        mode: '100644',
        type: 'blob',
        sha: source.sha,
      },
      {
        path: sourcePath,
        mode: '100644',
        type: 'blob',
        sha: null,
      },
    ],
    body.message || `Move ${sourcePath} to ${destinationPath}`
  );

  return {
    sourcePath,
    destinationPath,
    commitSha: commit.sha,
  };
}

async function uploadFiles(token, form) {
  const directory = cleanPath(form.get('directory') || '', true);
  const baseMessage = String(
    form.get('message') || `Upload files to ${directory || 'site root'}`
  ).slice(0, 140);

  const incoming = form
    .getAll('files')
    .filter((file) => file && typeof file.arrayBuffer === 'function' && Number(file.size) >= 0);

  const relativePaths = form
    .getAll('paths')
    .map((value) => String(value || ''));

  if (!incoming.length) {
    const error = new Error('Choose at least one file to upload.');
    error.status = 400;
    throw error;
  }

  if (incoming.length > MAX_UPLOAD_FILES) {
    const error = new Error('This upload batch contains too many files. Refresh the file manager so automatic batching can run.');
    error.status = 400;
    throw error;
  }

  const batchBytes = incoming.reduce((total, file) => total + Number(file.size || 0), 0);

  if (batchBytes > MAX_UPLOAD_BATCH_BYTES) {
    const error = new Error('This upload batch is too large. Refresh the file manager so automatic batching can run.');
    error.status = 413;
    throw error;
  }

  const pendingFiles = [];
  const skipped = [];
  const treeEntries = [];

  for (let index = 0; index < incoming.length; index += 1) {
    const file = incoming[index];

    if (file.size > MAX_UPLOAD_BYTES) {
      const error = new Error(
        `${file.name} is larger than Cloudflare Pages' 25 MiB single-file asset limit.`
      );
      error.status = 413;
      throw error;
    }

    const fallbackName = cleanFileName(file.name);
    const requestedRelativePath = String(relativePaths[index] || fallbackName)
      .replace(/\\/g, '/');

    const relativePath = cleanPath(requestedRelativePath, false);
    const name = basename(relativePath);
    const path = cleanPath(
      directory ? `${directory}/${relativePath}` : relativePath,
      false
    );

    const current = await getContents(token, path, true);

    if (Array.isArray(current)) {
      const error = new Error(`${path} is a directory and cannot be replaced by a file.`);
      error.status = 409;
      throw error;
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const blobSha = await createBlob(token, bytes);

    // Git blob SHAs are content-addressed. If the existing file already has
    // the same blob SHA, skip it instead of creating a needless commit entry.
    if (current?.sha && String(current.sha) === String(blobSha)) {
      skipped.push({
        name,
        relativePath,
        path,
        size: file.size,
        reason: 'unchanged',
      });
      continue;
    }

    treeEntries.push({
      path,
      mode: '100644',
      type: 'blob',
      sha: blobSha,
    });

    pendingFiles.push({
      name,
      relativePath,
      path,
      size: file.size,
      replaced: Boolean(current?.sha),
      sha: blobSha,
      htmlUrl: `https://github.com/${OWNER}/${REPO}/blob/${BRANCH}/${encodeRepoPath(path)}`,
    });
  }

  if (!treeEntries.length) {
    return {
      commitSha: '',
      commits: [],
      files: [],
      skipped,
      unchanged: true,
    };
  }

  // Commit the entire browser-generated batch at once. This keeps large
  // folder uploads from generating one GitHub commit per individual file.
  const commit = await commitTree(token, treeEntries, baseMessage);

  return {
    commitSha: commit.sha,
    commits: [commit.sha],
    files: pendingFiles,
    skipped,
    unchanged: false,
  };
}

export async function onRequestPost(context) {
  try {
    const auth = await requireAdmin(context, true);
    if (auth.error) return auth.error;

    const contentType = context.request.headers.get('Content-Type') || '';

    if (contentType.includes('multipart/form-data')) {
      const form = await context.request.formData();
      const action = String(form.get('action') || '');

      if (action !== 'upload') {
        return response({ error: 'Unknown multipart action.' }, 400);
      }

      const result = await uploadFiles(auth.token, form);

      return response({
        ...result,
        repository: `${OWNER}/${REPO}`,
        branch: BRANCH,
        commitUrl: result.commitSha
          ? `https://github.com/${OWNER}/${REPO}/commit/${result.commitSha}`
          : null,
        message: result.unchanged
          ? 'The selected file already matches GitHub, so no new commit was needed.'
          : `${result.files.length} file${result.files.length === 1 ? '' : 's'} uploaded to GitHub.`,
      });
    }

    const body = await context.request.json().catch(() => null);

    if (!body || typeof body !== 'object') {
      return response({ error: 'A valid request body is required.' }, 400);
    }

    let result;

    switch (String(body.action || '')) {
      case 'save':
        result = await saveText(auth.token, body);
        break;

      case 'delete':
        result = await deleteFile(auth.token, body);
        break;

      case 'rename':
        result = await renameFile(auth.token, body);
        break;

      default:
        return response({ error: 'Unknown file-manager action.' }, 400);
    }

    return response({
      ...result,
      repository: `${OWNER}/${REPO}`,
      branch: BRANCH,
      commitUrl: result.commitSha
        ? `https://github.com/${OWNER}/${REPO}/commit/${result.commitSha}`
        : null,
    });
  } catch (error) {
    console.error('Site file manager POST error:', error);

    if (error.status === 403) {
      return response({
        error: 'GitHub denied this change. Verify that GITHUB_TOKEN has Contents: Read and write access to Kaoxt/site.',
      }, 403);
    }

    if (error.status === 404) {
      return response({ error: 'The requested repository path could not be found.' }, 404);
    }

    if (error.status === 409 || error.status === 422) {
      return response({
        error: error.message || 'The repository changed. Refresh and try again.',
      }, 409);
    }

    return response({
      error: error.message || 'The repository change could not be completed.',
    }, error.status || 500);
  }
}
