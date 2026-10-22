# Nuvio Collection Studio

A dependency-free, GitHub Pages-ready starter site for managing a custom Nuvio collection.

## Included

- Dark Nuvio-inspired responsive interface
- Search and category filters
- Per-folder selection
- Select-all and Quick Build flows
- Drag-to-reorder selected categories
- Autosave with `localStorage`
- Import existing JSON
- Export selected setup as JSON
- Mobile responsive layout
- Direct-push integration placeholder

## Customize your collection

Edit `collection-data.js`.

Each collection supports:

```js
{
  id: 'anime',
  title: 'Anime',
  description: '...',
  icon: '◉',
  accent: 'magenta',
  tags: ['featured', 'tv', 'anime'],
  folders: [
    {
      id: 'anime-trending',
      title: 'Anime Trending',
      type: 'series',
      sourceCount: 2,
      enabled: true,
      sources: [],
      tileShape: 'LANDSCAPE',
      hideTitle: false,
      nuvio: {}
    }
  ]
}
```

Put any Nuvio-specific folder fields inside `nuvio`; they are merged into the exported folder object.

## Run locally

You can double-click `index.html`, or serve the folder with a small local server:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.

## Deploy to GitHub Pages

1. Create a new GitHub repository.
2. Upload all files in this folder to the repository root.
3. Open **Settings → Pages**.
4. Choose **Deploy from a branch**.
5. Choose `main` and `/ (root)`.

## Direct Nuvio push

The UI includes a **Send to Nuvio** entry point, but the starter intentionally does not collect credentials or call an undocumented endpoint. Once you have your current exported Nuvio JSON/schema and preferred authentication flow, the adapter can be added without changing the rest of the UI.

## Runtime source of truth

`runtime/database.kaoxt.js` is owned by **The Kollection** and is the authoritative production database used by kollection.tv for collection groups, folders, artwork URLs, and Nuvio setup generation.

It must **not** be automatically replaced by `ImKaptain/Kaptain-Collection`.

The runtime sync workflow may still refresh these AIOMetadata helper assets from upstream:

- `runtime/kaoxt-aio-catalogs.json`
- `runtime/kaoxt-aio-base-config.json`

Changes to the collection database itself should be made in this repository so Kollection-specific fixes cannot be reverted by an upstream sync.


## Bingecat account connection

Step 4 supports the registered Bingecat public OAuth client using authorization code + PKCE. The builder stays open during popup sign-in, with a full-page redirect fallback for blocked popups and account creation. The root `bingecat-callback.html` must remain deployed; both the popup and setup callback URLs must be registered with Bingecat for the site origin.

The connection reads profiles, catalog IDs, and recommendation status. OAuth tokens stay in browser storage and are excluded from saved setups; saved setups retain the selected manifest and catalog kind metadata. Step 4 also offers per-kind movie/series switches and Select All/Clear All for the For You collection. Choices are scoped to the personal manifest and saved with the setup; they never change BingeCat account settings. Unavailable recommendations cannot be selected. Clearing every choice removes BingeCat collection sources and skips installing its add-on. Older setups retain their existing default recommendations until edited. Manual manifest entry and skipping Bingecat remain available. Disconnect revokes the Bingecat app grant (across devices).

Run the focused connection and setup checks with:

```bash
node --test tests/bingecat*.test.mjs tests/saved-setup-capture.test.mjs tests/saved-setup-reuse.test.mjs tests/setup-*.test.mjs
```

An actual Bingecat login/consent still requires a user account on a registered origin.

## Editing installed AIOMetadata configurations

Step 3 requires a separate AIOMetadata password and confirmation (at least six characters). The same chosen password is sent to each configuration created for that setup. It stays in memory only: Kollection does not put it in browser storage, saved account data, or exports. After a reload, unfinished installations ask for the password again before provisioning.

The completion screen, downloaded setup record, and Account → Your setups retain each installed configuration’s UUID, host, and direct configure link. Account controls are read-only until the user opens AIOMetadata and signs in there. Older installations without retained credentials display a replacement notice; they are never silently reset. Update Existing still creates a replacement configuration, so users who edit settings directly in AIOMetadata should export that configuration and use **Use my JSON file** before updating through Kollection.

## Initial setup after clearing an outside collection

Clearing a collection keeps its installed add-ons. Fresh setups now check enabled AIOMetadata manifests in Review before creating new configurations. If catalogs overlap, Review lists the original installation and requires an explicit replacement choice. Its install link is retained in **Download backup**. The replacement uses Step 3 settings; existing search preferences can be carried over with **Use my JSON file**, while poster settings should be reviewed separately.

Only approved installation URLs are removed, after Nuvio confirms the new collection. The original hosted AIOMetadata configuration is not deleted. Unrelated add-ons are preserved. Replacement is blocked when another profile shares the add-on list, when unrelated collection groups still use it, or when Catalogs only would remove the only verified metadata provider. Users can also disable overlapping catalogs in their original AIOMetadata and use **Recheck existing add-ons**. Consent is checked again before provisioning and is not retained across page reloads, accounts, or profiles.

Run migration coverage with `node --test tests/setup-aio-migration.test.mjs`.
