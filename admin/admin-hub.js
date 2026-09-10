(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const el = {
    authState: $('authState'),
    authMessage: $('authMessage'),
    authLoading: $('authLoading'),
    loginPanel: $('loginPanel'),
    continueNuvioButton: $('continueNuvioButton'),
    nuvioAdminStatus: $('nuvioAdminStatus'),
    signedInCard: $('signedInCard'),
    signedInEmail: $('signedInEmail'),
    signedInRole: $('signedInRole'),
    signedInAvatar: $('signedInAvatar'),
    signOutButton: $('signOutButton'),
    adminTools: $('adminTools'),
    workersUsage: $('workersUsage'),
    workersUsageRefresh: $('workersUsageRefresh'),
    workersUsageAlert: $('workersUsageAlert'),
    workersDailyRenders: $('workersDailyRenders'),
    workersDailyLimit: $('workersDailyLimit'),
    workersUsagePercent: $('workersUsagePercent'),
    workersRendererState: $('workersRendererState'),
    workersRendererDetail: $('workersRendererDetail'),
    workersActiveRenders: $('workersActiveRenders'),
    workersConcurrencyLimit: $('workersConcurrencyLimit'),
    workersMeterText: $('workersMeterText'),
    workersMeterFill: $('workersMeterFill'),
    workersClientLimit: $('workersClientLimit'),
    omdbLookupsToday: $('omdbLookupsToday'),
    omdbLookupLimit: $('omdbLookupLimit'),
    omdbCachedRatings: $('omdbCachedRatings'),
    omdbCacheDetail: $('omdbCacheDetail'),
    omdbRemaining: $('omdbRemaining'),
  };

  let session = null;

  function setMessage(text) {
    el.authMessage.hidden = false;
    el.authMessage.className = 'admin-message error';
    el.authMessage.textContent = text;
  }

  function clearMessage() {
    el.authMessage.hidden = true;
    el.authMessage.textContent = '';
  }

  function setWorkersAlert(text = '', kind = '') {
    if (!el.workersUsageAlert) return;
    el.workersUsageAlert.hidden = !text;
    el.workersUsageAlert.className = `workers-usage-alert${kind ? ` ${kind}` : ''}`;
    el.workersUsageAlert.textContent = text;
  }

  function renderWorkersUsage(data) {
    const daily = Number(data?.dailyRenders ?? 0);
    const maxDaily = Number(data?.maxDaily ?? 0);
    const percent = Number.isFinite(Number(data?.usagePercent))
      ? Number(data.usagePercent)
      : (maxDaily > 0 ? (daily / maxDaily) * 100 : 0);
    const safePercent = Math.max(0, Math.min(100, percent));
    const conservation = Boolean(data?.conservationMode) || percent >= 95;
    const hardStop = Boolean(data?.hardStop) || percent >= 98;
    const enabled = data?.renderingEnabled !== false;

    const omdb = data?.omdb || {};
    const omdbLookups = Math.max(0, Number(omdb.lookupsToday ?? 0));
    const omdbLimit = Math.max(0, Number(omdb.dailyLimit ?? 0));
    const omdbRemaining = Math.max(0, Number(omdb.remaining ?? Math.max(0, omdbLimit - omdbLookups)));
    const omdbCached = Math.max(0, Number(omdb.cachedRatings ?? 0));
    const omdbCacheDays = Math.max(0, Number(omdb.cacheDays ?? 0));

    el.workersDailyRenders.textContent = daily.toLocaleString();
    el.workersDailyLimit.textContent = `of ${maxDaily.toLocaleString()} daily budget`;
    el.workersUsagePercent.textContent = `${percent.toFixed(percent >= 10 ? 0 : 1)}%`;
    el.workersActiveRenders.textContent = Number(data?.activeRenders ?? 0).toLocaleString();
    el.workersConcurrencyLimit.textContent = `of ${Number(data?.maxConcurrent ?? 0).toLocaleString()} concurrent`;
    el.workersMeterText.textContent = `${daily.toLocaleString()} / ${maxDaily.toLocaleString()}`;
    el.workersMeterFill.style.width = `${safePercent}%`;
    el.workersClientLimit.textContent = `Per-client hourly limit: ${Number(data?.maxClientHourly ?? 0).toLocaleString()} renders`;

    if (el.omdbLookupsToday) el.omdbLookupsToday.textContent = omdb.available === false ? 'Unavailable' : omdbLookups.toLocaleString();
    if (el.omdbLookupLimit) el.omdbLookupLimit.textContent = `of ${omdbLimit.toLocaleString()} daily API guard`;
    if (el.omdbCachedRatings) el.omdbCachedRatings.textContent = omdb.available === false ? 'Unavailable' : omdbCached.toLocaleString();
    if (el.omdbCacheDetail) el.omdbCacheDetail.textContent = `cached ratings · ${omdbCacheDays.toLocaleString()} day lifetime`;
    if (el.omdbRemaining) el.omdbRemaining.textContent = omdb.available === false
      ? 'OMDb usage meter unavailable'
      : `OMDb remaining today: ${omdbRemaining.toLocaleString()}`;

    el.workersUsage.classList.toggle('is-conservation', conservation && !hardStop);
    el.workersUsage.classList.toggle('is-hard-stop', hardStop || !enabled);

    if (!enabled) {
      el.workersRendererState.textContent = 'Disabled';
      el.workersRendererDetail.textContent = 'Emergency render switch is off';
      setWorkersAlert('New poster rendering is disabled. Cached posters can still be served.', 'danger');
    } else if (hardStop) {
      el.workersRendererState.textContent = 'Hard stop';
      el.workersRendererDetail.textContent = 'New renders blocked at 98%';
      setWorkersAlert('Poster rendering has reached the hard-stop threshold. New renders fall back to TMDB.', 'danger');
    } else if (conservation) {
      el.workersRendererState.textContent = 'Conserving';
      el.workersRendererDetail.textContent = '95% threshold reached';
      setWorkersAlert('Conservation mode is active. Poster rendering is being restricted to protect your Workers budget.', 'warning');
    } else if (omdb.available !== false && omdbLimit > 0 && omdbLookups >= omdbLimit) {
      el.workersRendererState.textContent = 'Normal';
      el.workersRendererDetail.textContent = 'Rendering enabled';
      setWorkersAlert('OMDb daily lookup guard has been reached. New uncached IMDb ratings will temporarily fall back to TMDB.', 'warning');
    } else {
      el.workersRendererState.textContent = 'Normal';
      el.workersRendererDetail.textContent = 'Rendering enabled';
      setWorkersAlert('');
    }
  }

  async function loadWorkersUsage() {
    if (!session?.isAdmin || !el.workersUsage) return;
    const button = el.workersUsageRefresh;
    if (button) {
      button.disabled = true;
      button.textContent = 'Refreshing…';
    }
    try {
      const response = await fetch('/api/posters-safety-status', {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        cache: 'no-store',
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || `Status request failed (${response.status})`);
      renderWorkersUsage(data || {});
    } catch (error) {
      setWorkersAlert(error.message || 'Could not load Posters usage.', 'danger');
      el.workersRendererState.textContent = 'Unavailable';
      el.workersRendererDetail.textContent = 'Could not read usage status';
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = 'Refresh';
      }
    }
  }

  function render() {
    const authenticated = Boolean(session?.authenticated);

    el.authLoading.hidden = true;
    el.loginPanel.hidden = authenticated;
    el.signedInCard.hidden = !authenticated;
    el.adminTools.hidden = true;
    if (el.workersUsage) el.workersUsage.hidden = true;

    if (!authenticated) {
      el.authState.textContent = 'Signed out';
      el.authState.className = 'auth-state';
      return;
    }

    const email = session.user?.email || 'Nuvio account';
    el.signedInEmail.textContent = email;
    el.signedInAvatar.textContent = email.charAt(0).toUpperCase() || 'N';

    if (session.isAdmin) {
      el.authState.textContent = 'Administrator';
      el.authState.className = 'auth-state good';
      el.signedInRole.textContent = 'Authorized administrator';
      el.adminTools.hidden = false;
      if (el.workersUsage) el.workersUsage.hidden = false;
      clearMessage();
      loadWorkersUsage();
    } else {
      el.authState.textContent = 'Not authorized';
      el.authState.className = 'auth-state bad';
      el.signedInRole.textContent = 'Valid Nuvio account · not an administrator';
      setMessage('This Nuvio account is not authorized to use The Kollection admin tools.');
    }
  }

  async function loadSession() {
    try {
      session = await window.KollectionNuvioAuth.getSession();
    } catch (error) {
      session = { authenticated: false, isAdmin: false };
      setMessage(error.message || 'Could not check your Kollection session.');
    }
    render();
  }

  el.continueNuvioButton.addEventListener('click', async () => {
    clearMessage();
    const oldText = el.continueNuvioButton.textContent;
    el.continueNuvioButton.disabled = true;
    el.continueNuvioButton.textContent = 'Opening Nuvio…';

    try {
      await window.KollectionNuvioAuth.continueWithNuvio({
        deviceName: 'The Kollection Admin',
        onStatus(message) {
          el.nuvioAdminStatus.textContent = message;
        },
      });
      session = await window.KollectionNuvioAuth.getSession();
      render();
    } catch (error) {
      setMessage(error.message || 'Could not sign in with Nuvio.');
    } finally {
      el.continueNuvioButton.disabled = false;
      el.continueNuvioButton.textContent = oldText;
    }
  });

  el.signOutButton.addEventListener('click', async () => {
    try {
      await window.KollectionNuvioAuth.signOut();
    } finally {
      session = { authenticated: false, isAdmin: false };
      el.nuvioAdminStatus.textContent = '';
      render();
    }
  });

  if (el.workersUsageRefresh) {
    el.workersUsageRefresh.addEventListener('click', loadWorkersUsage);
  }

  loadSession();
})();
