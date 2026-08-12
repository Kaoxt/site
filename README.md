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
