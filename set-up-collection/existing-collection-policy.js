(() => {
  'use strict';

  async function publish(profileId, force = true) {
    const id = Number(profileId);
    if (!Number.isFinite(id) || id < 1 || !window.KollectionCollectionEligibility) return;
    try {
      const eligibility = await window.KollectionCollectionEligibility.check(id, { force });
      window.dispatchEvent(new CustomEvent('kollection:existing-collection-policy', {
        detail: {
          profileId: id,
          existingCount: eligibility.existingCount || 0,
          hasKollection: Boolean(eligibility.hasKollection),
          externalCount: eligibility.externalCount || 0,
          eligible: Boolean(eligibility.eligible),
          blocked: !eligibility.eligible,
          needsChoice: false,
          state: eligibility.state,
        },
      }));
    } catch (error) {
      window.dispatchEvent(new CustomEvent('kollection:existing-collection-policy', {
        detail: {
          profileId: id,
          eligible: false,
          blocked: true,
          needsChoice: false,
          state: 'unknown',
          message: error?.message || 'Could not verify this Nuvio profile.',
        },
      }));
    }
  }

  window.addEventListener('kollection:nuvio-profile-changed', (event) => {
    publish(event?.detail?.profileId, true);
  });

  window.addEventListener('kollection:profile-collection-cleared', (event) => {
    publish(event?.detail?.profileId, true);
  });
})();
