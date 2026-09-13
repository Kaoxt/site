(() => {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const savedId = params.get('saved') || '';
  const editMode = params.get('edit') === '1';
  if (!savedId || !editMode) return;

  const NUVIO_API = 'https://api.nuvio.tv';
  const NUVIO_KEY = 'sb_publishable_1Clq8rlTVACkdcZuqr6_AD__xUUC_EN';
  window.__KOLLECTION_ORIGIN_CHECK_PENDING__ = true;

  async function readJson(response) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`);
    return body;
  }

  function cfg() {
    const config = window.KOLLECTION_CONFIG || {};
    return {
      apiBase: String(config.nuvioApiBase || NUVIO_API).replace(/\/+$/, ''),
      publishableKey: String(config.nuvioPublishableKey || NUVIO_KEY),
    };
  }

  async function pullCollections(profileId) {
    const token = await window.KollectionNuvioAuth?.getAccessToken?.();
    if (!token?.accessToken) throw new Error('Nuvio session unavailable.');
    const { apiBase, publishableKey } = cfg();
    const response = await fetch(`${apiBase}/rest/v1/rpc/sync_pull_collections`, {
      method: 'POST',
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${token.accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ p_profile_id: Number(profileId) }),
      cache: 'no-store',
    });
    const data = await response.json().catch(() => []);
    if (!response.ok) throw new Error(`Could not verify Nuvio collections (HTTP ${response.status}).`);
    const rows = Array.isArray(data) ? data : [];
    return rows.length ? (rows[0]?.collections_json || []) : [];
  }

  function showBlocked(message) {
    window.__KOLLECTION_ORIGIN_INVALID__ = true;
    const panel = document.getElementById('panelHost');
    const status = document.getElementById('saveSetupStatus');
    const sync = document.getElementById('saveSetupBtn');
    if (sync) {
      sync.disabled = true;
      sync.textContent = 'Sync unavailable';
    }
    if (status) {
      status.textContent = 'Invalid collection';
      status.dataset.kind = 'error';
    }
    if (panel) {
      panel.innerHTML = `
        <div class="panel">
          <div class="panel-head">
            <div class="kicker"><i></i>COLLECTION VERIFICATION</div>
            <h2>Invalid collection</h2>
            <p>${String(message || 'This setup cannot be edited because the linked Nuvio profile is not using The Kollection from kollection.tv.').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]))}</p>
          </div>
          <div class="card">
            <div class="callout warn"><strong>Editing is disabled for this saved setup.</strong> The Kollection only edits collection groups that match the IDs created by kollection.tv. This prevents another creator's collection from being modified accidentally.</div>
            <div class="actions"><a class="ghost" href="/account">Back to account</a><a class="btn" href="/set-up-collection">Set up The Kollection</a></div>
          </div>
        </div>`;
    }
  }

  async function verify() {
    try {
      const data = await readJson(await fetch(`/api/account/collections/${encodeURIComponent(savedId)}`, {
        credentials: 'same-origin', cache: 'no-store',
      }));
      const item = data?.collection || {};
      if (Number(item.draftStep || 0) < 7) return;
      const expected = Array.isArray(item?.config?.selectedCollectionGroupIds)
        ? item.config.selectedCollectionGroupIds.map(v => String(v || '').trim()).filter(Boolean)
        : [];
      const profileId = Number(item.nuvioProfileId);
      if (!Number.isFinite(profileId) || profileId < 1 || !expected.length) {
        showBlocked('This saved setup does not contain enough Kollection identity information to verify it safely.');
        return;
      }
      const live = await pullCollections(profileId);
      const liveIds = new Set((live || []).map(group => String(group?.id || '').trim()).filter(Boolean));
      const matched = expected.some(id => liveIds.has(id));
      if (!matched) {
        showBlocked('The saved Nuvio profile does not contain the Kollection groups created by kollection.tv. It may be using another creator’s collection, or The Kollection may have been removed.');
        return;
      }
      window.__KOLLECTION_ORIGIN_VERIFIED__ = true;
      window.dispatchEvent(new CustomEvent('kollection:origin-verified', { detail: { savedId, profileId } }));
    } catch (error) {
      showBlocked(error?.message || 'The Kollection could not verify this saved setup against Nuvio.');
    } finally {
      window.__KOLLECTION_ORIGIN_CHECK_PENDING__ = false;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', verify, { once: true });
  else verify();
})();
