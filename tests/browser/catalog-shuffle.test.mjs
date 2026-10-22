import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium, firefox, webkit } from 'playwright';

const root = new URL('../../', import.meta.url);
const origin = 'https://kollection.test';
const sessionKey = 'kollection-setup-wizard:v1';
const refs = [
  { addonId: 'aio-metadata', catalogId: 'streaming.genre_movie', type: 'movie' },
  { addonId: 'aio-metadata', catalogId: 'streaming.genre_series', type: 'series' },
];
const fixture = {
  collectionPack: [{ id: 'genres', title: 'Genres', folders: [
    { id: 'action', title: 'Action', sources: refs, catalogSources: refs },
    { id: 'shared', title: 'Shared movies', sources: [refs[0]] },
    { id: 'for-you', title: 'For You', sources: [{ addonId: 'com.aicat.user', catalogId: 'for-you', type: 'movie' }] },
  ] }],
  aiBaseConfig: {},
  aiCatalogLibrary: [
    { id: 'streaming.genre', type: 'movie', name: 'Action movies', randomizePerPage: true },
    { id: 'streaming.genre', type: 'series', name: 'Action series', randomizePerPage: false },
  ],
  selectedCollectionGroupIds: ['genres'], selectedCollectionFolderIds: { genres: ['action', 'shared'] },
  collectionSelectionInitialized: true, bingecatSkipped: true,
};

for (const [name, engine, width] of [
  ['Chromium desktop', chromium, 1440], ['Chromium mobile', chromium, 390],
  ['Firefox desktop', firefox, 1440], ['WebKit mobile', webkit, 390],
].filter(([, engine]) => !process.env.SHUFFLE_CHROMIUM_ONLY || engine === chromium)) {
  test(`${name}: defaults, shared catalogs, per-source edits, reload, and source replacement`, { timeout: 60000 }, async () => {
    const browser = await engine.launch(process.env.SHUFFLE_CHROMIUM_PATH && engine === chromium
      ? { executablePath: process.env.SHUFFLE_CHROMIUM_PATH } : {});
    try {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 600 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin || url.pathname.startsWith('/api/')) return route.fulfill({ contentType: 'application/json', body: '{}' });
        let path = url.pathname.slice(1);
        if (/^set-up-collection(?:\/customize)?$/.test(path)) path = 'set-up-collection.html';
        try {
          const body = await readFile(new URL(path, root));
          return route.fulfill({ body, contentType: path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html' });
        } catch { return route.fulfill({ status: 404, body: '' }); }
      });
      await page.addInitScript(({ fixture, sessionKey }) => {
        if (!sessionStorage.getItem(sessionKey)) sessionStorage.setItem(sessionKey, JSON.stringify({ ...fixture, savedAt: Date.now() }));
      }, { fixture, sessionKey });
      await page.goto(`${origin}/set-up-collection?step=customize`);
      const activate = async selector => width < 600 ? page.locator(selector).tap() : page.locator(selector).click();
      await activate('[data-edit-group="genres"]');
      const tile = id => `[data-order-key="${id}"]`;
      const shuffle = id => `${tile(id)} .folder-shuffle-toggle`;
      const pressed = async (id, expected) => assert.equal(await page.locator(shuffle(id)).getAttribute('aria-pressed'), expected);
      await pressed('action', 'mixed');
      await pressed('shared', 'true');
      assert.equal(await page.locator(shuffle('for-you')).count(), 0);
      const selectionBefore = await page.locator('#folderEditCount').textContent();
      await activate(shuffle('action'));
      await pressed('action', 'true');
      await activate(shuffle('action'));
      await pressed('action', 'false');
      await pressed('shared', 'false');
      assert.equal(await page.locator('#folderEditCount').textContent(), selectionBefore);
      await activate(`${tile('action')} .folder-source-edit:not(.folder-shuffle-toggle)`);
      const movie = '[data-shuffle-key="streaming.genre|movie"]';
      const series = '[data-shuffle-key="streaming.genre|series"]';
      assert.equal(await page.locator(movie).isChecked(), false);
      assert.equal(await page.locator(series).isChecked(), false);
      await activate(series);
      await activate('#folderSourceSave');
      await pressed('action', 'mixed');
      await pressed('shared', 'false');
      await page.reload();
      await activate('[data-edit-group="genres"]');
      await pressed('action', 'mixed');
      await pressed('shared', 'false');
      await activate(`${tile('action')} .folder-source-edit:not(.folder-shuffle-toggle)`);
      assert.equal(await page.locator(series).isChecked(), true);
      await activate('#folderSourceReset');
      await pressed('action', 'mixed');
      await pressed('shared', 'true');
      await activate(`${tile('action')} .folder-source-edit:not(.folder-shuffle-toggle)`);
      assert.equal(await page.locator(movie).isChecked(), true);
      assert.equal(await page.locator(series).isChecked(), false);
      if (process.env.SHUFFLE_SCREENSHOTS) await page.screenshot({ path: `${process.env.SHUFFLE_SCREENSHOTS}/shuffle-modal-${width}.png`, fullPage: true });
      await page.locator('#folderSourceProvider').selectOption('mdblist');
      await page.locator('#folderSourceValue').fill('999');
      const custom = '[data-shuffle-key="mdblist.999|all"]';
      assert.equal(await page.locator(custom).isChecked(), false);
      await activate(custom);
      await activate('#folderSourceSave');
      await pressed('action', 'true');
      await page.reload();
      await activate('[data-edit-group="genres"]');
      await pressed('action', 'true');
      if (process.env.SHUFFLE_SCREENSHOTS) await page.screenshot({ path: `${process.env.SHUFFLE_SCREENSHOTS}/shuffle-grid-${width}.png`, fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
}
