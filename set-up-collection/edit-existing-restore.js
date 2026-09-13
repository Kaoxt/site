(() => {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const editExisting = params.get('edit') === '1' && Boolean(params.get('saved'));
  if (!editExisting) return;

  let active = false;
  let busy = false;
  let reachedCustomize = false;
  let originVerified = false;
  const $ = (selector, root = document) => root.querySelector(selector);

  function currentStep() {
    const text = $('#mobileStepText')?.textContent || '';
    const match = text.match(/Step\s+(\d+)\s+of/i);
    return match ? Math.max(0, Number(match[1]) - 1) : -1;
  }

  function clickOnce(button, delay = 50) {
    if (!button || busy || button.disabled || !originVerified) return false;
    busy = true;
    setTimeout(() => {
      try { button.click(); }
      finally { setTimeout(() => { busy = false; }, 250); }
    }, delay);
    return true;
  }

  function findButtonByText(pattern) {
    return Array.from(document.querySelectorAll('#panelHost button')).find((button) => pattern.test((button.textContent || '').trim()));
  }

  async function readJson(response) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`);
    return body;
  }

  function showInvalid(message) {
    active = false;
    originVerified = false;
    const status = $('#saveSetupStatus');
    if (status) {
      status.textContent = 'Invalid collection';
      status.dataset.kind = 'error';
    }
    const sync = $('#saveSetupBtn');
    if (sync) {
      sync.disabled = true;
      sync.textContent = 'Sync unavailable';
    }
    const panel = $('#panelHost');
    if (!panel) return;
    const safe = String(message || '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[c]));
    panel.innerHTML = `
      <div class="panel">
        <div class="panel-head">
          <div class="kicker"><i></i>COLLECTION VERIFICATION</div>
          <h2>Invalid collection</h2>
          <p>${safe}</p>
        </div>
        <div class="card">
          <div class="callout warn"><strong>Editing is disabled.</strong> The Kollection only edits collection groups that match the IDs created by kollection.tv, so another creator's collection cannot be modified accidentally.</div>
          <div class="actions"><a class="ghost" href="/account">Back to account</a><a class="btn" href="/set-up-collection">Set up The Kollection</a></div>
        </div>
      </div>`;
  }

  async function verifyOrigin() {
    try {
      const savedId = params.get('saved');
      const saved = await readJson(await fetch(`/api/account/collections/${encodeURIComponent(savedId)}`, {
        credentials: 'same-origin', cache: 'no-store',
      }));
      const item = saved?.collection || {};
      if (Number(item.draftStep || 0) < 7) {
        originVerified = true;
        active = true;
        return;
      }

      const expected = Array.isArray(item?.config?.selectedCollectionGroupIds)
        ? item.config.selectedCollectionGroupIds.map(v => String(v || '').trim()).filter(Boolean)
        : [];
      const profileId = Number(item.nuvioProfileId);
      if (!Number.isFinite(profileId) || profileId < 1 || !expected.length) {
        showInvalid('This saved setup cannot be matched safely to a Kollection installed on its Nuvio profile.');
        return;
      }

      const token = await window.KollectionNuvioAuth?.getAccessToken?.();
      if (!token?.accessToken) throw new Error('Sign in with Nuvio so The Kollection can verify this setup.');
      const cfg = window.KOLLECTION_CONFIG || {};
      const apiBase = String(cfg.nuvioApiBase || 'https://api.nuvio.tv').replace(/\/+$/, '');
      const response = await fetch(`${apiBase}/rest/v1/rpc/sync_pull_collections`, {
        method: 'POST',
        headers: {
          apikey: String(cfg.nuvioPublishableKey || ''),
          Authorization: `Bearer ${token.accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ p_profile_id: profileId }),
        cache: 'no-store',
      });
      const result = await response.json().catch(() => []);
      if (!response.ok) throw new Error(`Could not verify the Nuvio profile (HTTP ${response.status}).`);
      const rows = Array.isArray(result) ? result : [];
      const live = rows.length ? (rows[0]?.collections_json || []) : [];
      const liveIds = new Set((live || []).map(group => String(group?.id || '').trim()).filter(Boolean));
      if (!expected.some(id => liveIds.has(id))) {
        showInvalid('This Nuvio profile does not contain the Kollection groups created by kollection.tv. It may be using another creator’s collection, or The Kollection may have been removed.');
        return;
      }

      originVerified = true;
      active = true;
      driveToCustomize();
    } catch (error) {
      showInvalid(error?.message || 'The Kollection could not verify this setup against Nuvio.');
    }
  }

  function driveToCustomize() {
    if (!active || !originVerified || reachedCustomize) return;
    const step = currentStep();

    if (step >= 4) {
      reachedCustomize = true;
      active = false;
      const status = $('#saveSetupStatus');
      if (status && /Loading saved setup|restor/i.test(status.textContent || '')) {
        status.textContent = 'Saved setup restored.';
        status.dataset.kind = 'success';
      }
      return;
    }

    if (step === 0) {
      clickOnce($('#startBtn'));
      return;
    }

    if (step === 1) {
      const profile = $('#profile');
      const next = $('#nextBtn');
      if (profile && profile.value && next && !next.disabled) clickOnce(next);
      return;
    }

    if (step === 2) {
      const builtIn = $('#builtInTab')?.classList.contains('active');
      const custom = $('#customTab')?.classList.contains('active');
      const next = $('#nextBtn');
      if (builtIn) {
        const mdblist = $('#mdblist')?.value?.trim();
        const host = $('#aiHost')?.value;
        if (mdblist && host && next && !next.disabled) clickOnce(next, 80);
        return;
      }
      if (custom) return;
    }

    if (step === 3) {
      const customize = findButtonByText(/Customize collection/i);
      if (customize && !customize.disabled) {
        clickOnce(customize, 80);
        return;
      }
      const next = $('#nextBtn');
      const panelText = $('#panelHost')?.textContent || '';
      if (next && !next.disabled && /Bingecat is skipped|manifest is ready|Bingecat connected/i.test(panelText)) clickOnce(next, 80);
    }
  }

  function init() {
    const panel = $('#panelHost');
    if (panel) {
      new MutationObserver(() => setTimeout(driveToCustomize, 25))
        .observe(panel, { childList: true, subtree: true, characterData: true });
    }
    document.addEventListener('input', () => setTimeout(driveToCustomize, 20), true);
    document.addEventListener('change', () => setTimeout(driveToCustomize, 20), true);
    window.addEventListener('kollection:nuvio-signed-in', () => setTimeout(() => {
      if (!originVerified) verifyOrigin(); else driveToCustomize();
    }, 150));

    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      driveToCustomize();
      if ((!active && originVerified) || reachedCustomize || tries > 300) clearInterval(timer);
    }, 100);

    verifyOrigin();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
