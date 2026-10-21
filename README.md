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
