import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium, webkit } from 'playwright';

const root = new URL('../../', import.meta.url);
const origin = 'https://kollection.test';
const host = 'https://aiometadatafortheweebs.midnightignite.me/';
const database = await readFile(new URL('runtime/database.kaoxt.js', root), 'utf8');
const group = JSON.parse(database.split('window.NUVIO_DATABASE =')[1].trim().replace(/;\s*$/, ''))[0];
const saved = { id: 'saved-fixture', name: 'Saved fixture', draftStep: 7, nuvioProfileId: 1,
  config: { aiSetupMode: 'built-in', aiHostPreference: host, selectedCollectionGroupIds: [group.id],
    selectedCollectionFolderIds: { [group.id]: [group.folders[0].id] }, bingecatSkipped: true, aiCatalogModeOnly: false },
  secrets: { mdblistKey: 'fixture-mdblist-key' } };

for (const [name, engine, width] of [['Chromium desktop', chromium, 1440], ['Chromium mobile', chromium, 390], ['WebKit mobile', webkit, 390]]) {
  test(`${name}: saved edit waits for manual Continue without flashing or stealing focus`, { timeout: 60000 }, async () => {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 600 });
      const errors = [];
      const writes = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        const json = body => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
        if (/sync_push_|\/api\/aiometadata\/|\/api\/configure/.test(url.pathname)) writes.push(url.pathname);
        if (url.pathname === '/nuvio-auth/nuvio-auth.js') return route.fulfill({ contentType: 'text/javascript', body: `window.KollectionNuvioAuth = {
          getAccessToken: async () => ({authenticated:true,accessToken:'fixture-token',user:{id:'fixture-user'}}),
          getSession: async () => ({authenticated:true,user:{id:'fixture-user'}})
        };` });
        if (url.pathname.startsWith('/api/account/collections/')) return json({ collection: saved });
        if (url.pathname === '/api/account/collections') return json({ collections: [saved] });
        if (url.pathname.endsWith('/rpc/sync_pull_profiles')) return json([{ profile_index: 1, name: 'Test profile' }]);
        if (url.pathname.endsWith('/rpc/sync_pull_collections')) return json([{ collections_json: [{ id: group.id, folders: [] }] }]);
        if (url.origin !== origin || url.pathname.startsWith('/api/')) return json({});
        if (route.request().resourceType() === 'image') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
        let path = url.pathname.slice(1);
        if (/^set-up-collection(?:\/[^/]+)?$/.test(path) && !path.includes('.')) path = 'set-up-collection.html';
        try {
          const body = await readFile(new URL(path, root));
          return route.fulfill({ body, contentType: path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html' });
        } catch { return route.fulfill({ status: 404, body: '' }); }
      });
      await page.addInitScript(() => {
        window.continueClicks = 0;
        document.addEventListener('click', e => { if (e.target.id === 'nextBtn' && document.querySelector('#aiConfigPassword')) window.continueClicks++; }, true);
      });
      await page.goto(`${origin}/set-up-collection?saved=saved-fixture&edit=1`);
      await page.waitForFunction(() => document.querySelector('#mdblist')?.value === 'fixture-mdblist-key');
      // Span multiple restore polling ticks: no automatic submissions or warnings.
      await page.waitForTimeout(1000);
      assert.equal(await page.evaluate(() => window.continueClicks), 0);
      assert.equal((await page.locator('#alertHost').textContent()).trim(), '');
      await page.locator('#aiConfigPassword').fill('abcdef');
      await page.locator('#aiConfigPasswordConfirm').fill('different');
      await page.locator('#nextBtn').click();
      assert.match(await page.locator('#alertHost').textContent(), /passwords do not match/i);
      await page.locator('#tmdb').focus();
      await page.waitForTimeout(800);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'tmdb');
      assert.equal(await page.evaluate(() => window.continueClicks), 1, 'validation must not trigger retries');
      await page.locator('#aiConfigPasswordConfirm').fill('abcdef');
      await page.locator('#aiCatalogModeOnly').check();
      await page.waitForTimeout(500);
      assert.equal(await page.locator('#aiCatalogModeOnly').isChecked(), true);
      assert.equal(await page.locator('#aiConfigPasswordConfirm').inputValue(), 'abcdef');
      assert.match(await page.locator('#mobileStepText').textContent(), /Step 3 of/);
      await page.locator('#nextBtn').click();
      await page.waitForFunction(() => /Step 5 of/.test(document.querySelector('#mobileStepText')?.textContent || ''));
      await page.waitForTimeout(1000);
      assert.match(await page.locator('#mobileStepText').textContent(), /Step 5 of/, 'Edit must stop on Customize');
      assert.doesNotMatch(await page.evaluate(() => sessionStorage.getItem('kollection-setup-wizard:v1') || ''), /abcdef|aiConfigPassword/);
      assert.deepEqual(writes, []);
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
}
