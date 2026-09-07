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

  function render() {
    const authenticated = Boolean(session?.authenticated);

    el.authLoading.hidden = true;
    el.loginPanel.hidden = authenticated;
    el.signedInCard.hidden = !authenticated;
    el.adminTools.hidden = true;

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
      clearMessage();
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

  loadSession();
})();
