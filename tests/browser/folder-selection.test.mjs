// Run: npm install --no-save --package-lock=false playwright@1.56.1
//      npx playwright install chromium firefox webkit
//      node --test tests/browser/folder-selection.test.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium, firefox, webkit } from 'playwright';

const root = new URL('../../', import.meta.url);
const origin = 'https://kollection.test';
const sessionKey = 'kollection-setup-wizard:v1';
const fixture = {
  collectionPack: [
    { id: 'movies', title: 'Movies', folders: [
      { id: 'action', title: 'Action', tileShape: 'LANDSCAPE', hideTitle: true, sources: [{ addonId: 'aio-metadata', catalogId: 'mdblist.123', type: 'movie' }] },
      { id: 'comedy', title: 'Comedy', tileShape: 'POSTER', sources: [] },
      { id: 'for-you', title: 'For You', sources: [] },
    ] },
    { id: 'series', title: 'Series', folders: [{ id: 'drama', title: 'Drama', sources: [] }] },
    { id: 'empty', title: 'Empty', folders: [] },
  ],
  selectedCollectionGroupIds: ['movies', 'series', 'empty'],
  selectedCollectionFolderIds: { movies: ['action'], series: ['drama'], empty: [] },
  collectionSelectionInitialized: true,
  bingecatSkipped: true,
  collectionCategoryOrder: ['movies', 'series', 'empty'],
  collectionFolderSortModes: { movies: 'custom' },
  collectionFolderOrders: { movies: ['comedy', 'action', 'for-you'] },
  collectionFolderSourceOverrides: {
    'movies::action': { artwork: { coverImageUrl: 'https://images.test/custom.webp', titleLogoUrl: 'https://images.test/logo.webp', heroBackdropUrl: 'https://images.test/backdrop.webp', coverEmoji: '' } },
  },
  existingCollections: [{ id: 'personal', title: 'Personal collection', folders: [{ id: 'keep', title: 'Keep me', customSetting: true }] }],
  betterPostersEnabled: false,
  betterPostersSettings: { rating: true, language: 'en' },
};

for (const [name, engine, mobile] of [
  ['Chromium desktop', chromium, false],
  ['Chromium mobile touch', chromium, true],
  ['Firefox desktop', firefox, false],
  ['Firefox narrow touch', firefox, true],
  ['WebKit mobile touch', webkit, true],
]) {
  test(`${name}: poster selection, bulk actions, rerenders, and saved settings`, { timeout: 60000 }, async () => {
    const browser = await engine.launch();
    try {
      const context = await browser.newContext({
        viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
        hasTouch: mobile,
        ...(engine !== firefox ? { isMobile: mobile } : {}),
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      // All requests stay in this fixture: no real accounts or collections are written.
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (route.request().resourceType() === 'image') {
          return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#333"/></svg>' });
        }
        if (url.origin !== origin || url.pathname.startsWith('/api/')) {
          return route.fulfill({ contentType: 'application/json', body: '{}' });
        }
        let path = url.pathname.slice(1);
        if (/^set-up-collection(?:\/(?:overview|nuvio|aiometadata|bingecat|customize|review|install|complete))?$/.test(path)) path = 'set-up-collection.html';
        try {
          const body = await readFile(new URL(path, root));
          const contentType = path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html';
          return route.fulfill({ contentType, body });
        } catch { return route.fulfill({ status: 404, body: '' }); }
      });
      await page.addInitScript(({ fixture, sessionKey }) => {
        if (!sessionStorage.getItem(sessionKey)) sessionStorage.setItem(sessionKey, JSON.stringify({ ...fixture, savedAt: Date.now() }));
        window.selectionEvents = [];
        window.addEventListener('kollection:collection-selection-changed', event => window.selectionEvents.push(event.detail));
      }, { fixture, sessionKey });
      await page.goto(`${origin}/set-up-collection?step=customize`);
      const activate = async selector => {
        if (process.env.EDITOR_TEST_DEBUG) console.log(`${name}: ${selector}`);
        const locator = page.locator(selector);
        if (mobile) await locator.tap(); else await locator.click();
      };
      const count = async text => assert.equal(await page.locator('#folderEditCount').textContent(), text);
      const pressed = async (id, on) => assert.equal(await page.locator(`[data-folder-key="${id}"]`).getAttribute('aria-pressed'), String(on));

      await activate('[data-edit-group="movies"]');
      assert.deepEqual(errors, [], 'opening the editor must bind every control without throwing');
      await count('1 of 3 folders selected');
      await pressed('action', true);
      await pressed('comedy', false);
      assert.equal(await page.locator('[data-folder-key="for-you"]').isDisabled(), true);
      // Click/tap descendants, as a user would on the artwork and status badge.
      await activate('[data-folder-key="comedy"] .folder-edit-art');
      await count('2 of 3 folders selected');
      await pressed('comedy', true);
      await activate('[data-folder-key="action"] .folder-edit-state');
      await count('1 of 3 folders selected');
      await pressed('action', false);
      await activate('#clearFolders');
      await count('0 of 3 folders selected');
      await pressed('comedy', false);
      await activate('[data-folder-key="action"] .folder-edit-meta');
      await count('1 of 3 folders selected');
      await activate('#selectAllFolders');
      await count('2 of 3 folders selected');
      await pressed('action', true);
      await pressed('comedy', true);
      await pressed('for-you', false);
      // Verify native keyboard activation in desktop browsers too.
      if (!mobile) {
        await page.locator('[data-folder-key="action"]').focus();
        await page.keyboard.press('Space');
        await pressed('action', false);
        await page.keyboard.press('Enter');
        await pressed('action', true);
      }
      await page.locator('#folderSortMode').selectOption('alphabetical');
      await activate('#clearFolders');
      await count('0 of 3 folders selected');
      await page.locator('#folderSortMode').selectOption('custom');
      await count('0 of 3 folders selected');
      await activate('#selectAllFolders');
      await activate('[data-folder-key="comedy"]');
      await activate('#doneEditingBtn');
      await activate('[data-edit-group="movies"]');
      await count('1 of 3 folders selected');
      await pressed('action', true);
      await pressed('comedy', false);
      assert.equal(await page.locator('#folderSortMode').inputValue(), 'custom');
      assert.deepEqual(await page.locator('.folder-edit-card').evaluateAll(cards => cards.map(card => card.dataset.folderKey)), ['comedy', 'action', 'for-you']);
      await activate('#doneEditingBottomBtn');
      await activate('[data-edit-group="empty"]');
      await activate('#selectAllFolders');
      await activate('#clearFolders');
      await count('0 of 0 folders selected');
      await activate('#doneEditingBtn');

      // Clicks must be saved before unload; Firefox reload can discard unload-only writes.
      assert.deepEqual(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)).selectedCollectionGroupIds.slice().sort(), sessionKey), ['movies', 'series']);
      await page.reload();
      assert.deepEqual(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)).selectedCollectionGroupIds.slice().sort(), sessionKey), ['movies', 'series']);
      assert.equal(await page.locator('[data-edit-group="movies"]').isEnabled(), true, 'a selected section must remain editable after reload');
      await activate('[data-edit-group="movies"]');
      await count('1 of 3 folders selected');
      const saved = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), sessionKey);
      assert.deepEqual(saved.existingCollections, fixture.existingCollections);
      assert.deepEqual(saved.selectedCollectionFolderIds.series, ['drama']);
      assert.deepEqual(saved.collectionFolderSourceOverrides, fixture.collectionFolderSourceOverrides);
      assert.deepEqual(saved.collectionFolderSortModes, fixture.collectionFolderSortModes);
      assert.deepEqual(saved.collectionFolderOrders, fixture.collectionFolderOrders);
      assert.deepEqual(saved.collectionCategoryOrder, fixture.collectionCategoryOrder);
      const action = saved.collectionPack.find(group => group.id === 'movies').folders.find(folder => folder.id === 'action');
      assert.equal(action.tileShape, 'LANDSCAPE');
      assert.equal(action.hideTitle, true);
      assert.deepEqual(action.sources, fixture.collectionPack[0].folders[0].sources);
      assert.equal(action.coverImageUrl, fixture.collectionFolderSourceOverrides['movies::action'].artwork.coverImageUrl);
      assert.deepEqual(errors, [], 'selection, sorting, and navigation must not throw');
    } finally { await browser.close(); }
  });
}
