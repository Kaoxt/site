(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const state = {
    session: null,
    file: null,
    originalUrl: '',
    resultBlob: null,
    resultUrl: '',
    width: 0,
    height: 0,
    quality: 86,
  };

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

    converterShell: $('converterShell'),
    howSection: $('howSection'),
    converterMessage: $('converterMessage'),

    bannerChooseButton: $('bannerChooseButton'),
    chooseButton: $('chooseButton'),
    resetButton: $('resetButton'),
    pngInput: $('pngInput'),
    dropZone: $('dropZone'),
    dropPrompt: $('dropPrompt'),
    originalPreview: $('originalPreview'),
    originalImage: $('originalImage'),
    originalName: $('originalName'),
    originalDimensions: $('originalDimensions'),
    originalSize: $('originalSize'),

    conversionControls: $('conversionControls'),
    qualitySlider: $('qualitySlider'),
    qualityValue: $('qualityValue'),
    convertButton: $('convertButton'),

    resultSection: $('resultSection'),
    resultImage: $('resultImage'),
    resultName: $('resultName'),
    resultDimensions: $('resultDimensions'),
    resultOriginalSize: $('resultOriginalSize'),
    resultSize: $('resultSize'),
    resultSavings: $('resultSavings'),
    downloadButton: $('downloadButton'),
  };

  function setMessage(text, kind = 'error') {
    el.converterMessage.hidden = false;
    el.converterMessage.className = `admin-message ${kind}`;
    el.converterMessage.textContent = text;
  }

  function clearMessage() {
    el.converterMessage.hidden = true;
    el.converterMessage.textContent = '';
  }

  function setAuthMessage(text) {
    el.authMessage.hidden = false;
    el.authMessage.className = 'admin-message error';
    el.authMessage.textContent = text;
  }

  function clearAuthMessage() {
    el.authMessage.hidden = true;
    el.authMessage.textContent = '';
  }

  function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB'];
    const order = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    const amount = value / (1024 ** order);
    const digits = order === 0 ? 0 : amount >= 100 ? 0 : amount >= 10 ? 1 : 2;

    return `${amount.toFixed(digits)} ${units[order]}`;
  }

  function outputName(name) {
    return String(name || 'converted.png').replace(/\.png$/i, '') + '.webp';
  }

  function revokeUrl(name) {
    if (state[name]) {
      URL.revokeObjectURL(state[name]);
      state[name] = '';
    }
  }

  function resetResult() {
    revokeUrl('resultUrl');
    state.resultBlob = null;
    el.resultImage.removeAttribute('src');
    el.resultSection.hidden = true;
  }

  function resetAll() {
    revokeUrl('originalUrl');
    resetResult();

    state.file = null;
    state.width = 0;
    state.height = 0;

    el.pngInput.value = '';
    el.originalImage.removeAttribute('src');
    el.originalName.textContent = '';
    el.originalDimensions.textContent = '';
    el.originalSize.textContent = '';

    el.dropPrompt.hidden = false;
    el.originalPreview.hidden = true;
    el.conversionControls.hidden = true;
    el.resetButton.hidden = true;
    clearMessage();
  }

  function renderSession() {
    const authenticated = Boolean(state.session?.authenticated);

    el.authLoading.hidden = true;
    el.loginPanel.hidden = authenticated;
    el.signedInCard.hidden = !authenticated;
    el.converterShell.hidden = true;
    el.howSection.hidden = true;

    if (!authenticated) {
      el.authState.textContent = 'Signed out';
      el.authState.className = 'auth-state';
      return;
    }

    const email = state.session.user?.email || 'Nuvio account';
    el.signedInEmail.textContent = email;
    el.signedInAvatar.textContent = email.charAt(0).toUpperCase() || 'N';

    if (state.session.isAdmin) {
      el.authState.textContent = 'Administrator';
      el.authState.className = 'auth-state good';
      el.signedInRole.textContent = 'Authorized administrator';
      el.converterShell.hidden = false;
      el.howSection.hidden = false;
      clearAuthMessage();
    } else {
      el.authState.textContent = 'Not authorized';
      el.authState.className = 'auth-state bad';
      el.signedInRole.textContent = 'Valid Nuvio account · not an administrator';
      setAuthMessage('This Nuvio account is not authorized to use the private image converter.');
    }
  }

  async function loadSession() {
    try {
      state.session = await window.KollectionNuvioAuth.getSession();
    } catch (error) {
      state.session = { authenticated: false, isAdmin: false };
      setAuthMessage(error.message || 'Could not check your Kollection session.');
    }

    renderSession();
  }

  async function decodeDimensions(file) {
    if ('createImageBitmap' in window) {
      const bitmap = await createImageBitmap(file);
      const dimensions = { width: bitmap.width, height: bitmap.height };
      bitmap.close?.();
      return dimensions;
    }

    const src = URL.createObjectURL(file);

    try {
      const image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('The PNG could not be decoded.'));
        img.src = src;
      });

      return {
        width: image.naturalWidth,
        height: image.naturalHeight,
      };
    } finally {
      URL.revokeObjectURL(src);
    }
  }

  async function useFile(file) {
    clearMessage();
    resetResult();

    if (!file) return;

    const isPng =
      String(file.type || '').toLowerCase() === 'image/png' ||
      /\.png$/i.test(String(file.name || ''));

    if (!isPng) {
      setMessage('Choose a PNG image. Other file types are intentionally disabled on this converter.');
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      setMessage('That PNG is larger than the 50 MB converter limit.');
      return;
    }

    try {
      const dimensions = await decodeDimensions(file);

      revokeUrl('originalUrl');
      state.originalUrl = URL.createObjectURL(file);
      state.file = file;
      state.width = dimensions.width;
      state.height = dimensions.height;

      el.originalImage.src = state.originalUrl;
      el.originalName.textContent = file.name;
      el.originalDimensions.textContent = `${dimensions.width} × ${dimensions.height}`;
      el.originalSize.textContent = formatBytes(file.size);

      el.dropPrompt.hidden = true;
      el.originalPreview.hidden = false;
      el.conversionControls.hidden = false;
      el.resetButton.hidden = false;
    } catch (error) {
      setMessage(error.message || 'The PNG could not be opened.');
    }
  }

  async function convertToWebP() {
    if (!state.file) {
      setMessage('Choose a PNG before converting.');
      return;
    }

    clearMessage();
    resetResult();

    const oldText = el.convertButton.textContent;
    el.convertButton.disabled = true;
    el.convertButton.textContent = 'Converting…';

    try {
      const bitmap = 'createImageBitmap' in window
        ? await createImageBitmap(state.file)
        : null;

      const canvas = document.createElement('canvas');
      canvas.width = state.width;
      canvas.height = state.height;

      const context = canvas.getContext('2d', {
        alpha: true,
        desynchronized: true,
      });

      if (!context) throw new Error('Your browser could not create the image canvas.');

      context.clearRect(0, 0, canvas.width, canvas.height);

      if (bitmap) {
        context.drawImage(bitmap, 0, 0);
        bitmap.close?.();
      } else {
        const image = await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error('The PNG could not be decoded.'));
          img.src = state.originalUrl;
        });

        context.drawImage(image, 0, 0);
      }

      const blob = await new Promise((resolve) => {
        canvas.toBlob(resolve, 'image/webp', Math.min(1, Math.max(0.01, state.quality / 100)));
      });

      if (!blob || blob.type !== 'image/webp') {
        throw new Error('This browser could not create a WebP file.');
      }

      state.resultBlob = blob;
      state.resultUrl = URL.createObjectURL(blob);

      el.resultImage.src = state.resultUrl;
      el.resultName.textContent = outputName(state.file.name);
      el.resultDimensions.textContent = `${state.width} × ${state.height}`;
      el.resultOriginalSize.textContent = formatBytes(state.file.size);
      el.resultSize.textContent = formatBytes(blob.size);

      const difference = state.file.size > 0
        ? ((state.file.size - blob.size) / state.file.size) * 100
        : 0;

      if (difference > 0.05) {
        el.resultSavings.textContent = `${difference.toFixed(difference >= 10 ? 0 : 1)}% Smaller`;
      } else if (difference < -0.05) {
        el.resultSavings.textContent = `${Math.abs(difference).toFixed(Math.abs(difference) >= 10 ? 0 : 1)}% Larger`;
      } else {
        el.resultSavings.textContent = 'About the Same';
      }

      el.resultSection.hidden = false;
      el.resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      setMessage(error.message || 'The WebP conversion failed.');
    } finally {
      el.convertButton.disabled = false;
      el.convertButton.textContent = oldText;
    }
  }

  function openPicker() {
    el.pngInput.click();
  }

  el.continueNuvioButton.addEventListener('click', async () => {
    clearAuthMessage();

    const oldText = el.continueNuvioButton.textContent;
    el.continueNuvioButton.disabled = true;
    el.continueNuvioButton.textContent = 'Opening Nuvio…';

    try {
      await window.KollectionNuvioAuth.continueWithNuvio({
        deviceName: 'The Kollection PNG to WebP Converter',
        onStatus(message) {
          el.nuvioAdminStatus.textContent = message;
        },
      });

      state.session = await window.KollectionNuvioAuth.getSession();
      renderSession();
    } catch (error) {
      setAuthMessage(error.message || 'Could not sign in with Nuvio.');
    } finally {
      el.continueNuvioButton.disabled = false;
      el.continueNuvioButton.textContent = oldText;
    }
  });

  el.signOutButton.addEventListener('click', async () => {
    try {
      await window.KollectionNuvioAuth.signOut();
    } finally {
      resetAll();
      state.session = { authenticated: false, isAdmin: false };
      el.nuvioAdminStatus.textContent = '';
      renderSession();
    }
  });

  el.bannerChooseButton.addEventListener('click', openPicker);
  el.chooseButton.addEventListener('click', (event) => {
    event.stopPropagation();
    openPicker();
  });

  el.dropZone.addEventListener('click', (event) => {
    if (!event.target.closest('button')) openPicker();
  });

  el.dropZone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openPicker();
    }
  });

  ['dragenter', 'dragover'].forEach((eventName) => {
    el.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
      el.dropZone.classList.add('dragging');
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    el.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
      el.dropZone.classList.remove('dragging');
    });
  });

  el.dropZone.addEventListener('drop', (event) => {
    const file = event.dataTransfer?.files?.[0];
    useFile(file);
  });

  el.pngInput.addEventListener('change', () => {
    useFile(el.pngInput.files?.[0]);
  });


  if (el.qualitySlider) {
    const updateQuality = () => {
      state.quality = Number(el.qualitySlider.value) || 86;
      if (el.qualityValue) el.qualityValue.textContent = `${state.quality}%`;
    };
    el.qualitySlider.addEventListener('input', updateQuality);
    updateQuality();
  }

  el.convertButton.addEventListener('click', convertToWebP);

  el.downloadButton.addEventListener('click', () => {
    if (!state.resultBlob || !state.resultUrl || !state.file) return;

    const link = document.createElement('a');
    link.href = state.resultUrl;
    link.download = outputName(state.file.name);
    document.body.appendChild(link);
    link.click();
    link.remove();
  });

  el.resetButton.addEventListener('click', resetAll);

  window.addEventListener('beforeunload', () => {
    revokeUrl('originalUrl');
    revokeUrl('resultUrl');
  });

  loadSession();
})();
