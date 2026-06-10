# Converse — Full-Text Search for Claude (Firefox)

Search across the complete content of all your Claude conversations — not just titles.

---

## What it does

Claude's built-in search only matches conversation titles. Converse indexes every message
and lets you find anything you actually said or Claude actually replied, with highlighted
snippets and direct navigation.

- **Full-text search** — searches message bodies, not just titles
- **Incremental sync** — only fetches conversations that have changed
- **Local-only** — all data lives in IndexedDB in your browser; nothing leaves your device
- **Claude-native UI** — the drawer matches Claude's own design language
- **Keyboard-first** — `Ctrl`+`Shift`+`F` to open, `Escape` to close

---

## Install (temporary, for development)

1. Open Firefox and navigate to `about:debugging`
2. Click **This Firefox** in the left sidebar
3. Click **Load Temporary Add-on…**
4. Select the `manifest.json` file from this directory

The extension loads until Firefox is restarted.

---

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl`+`Shift`+`F` | Open / close search drawer |
| `Escape` | Close drawer |
| `Enter` on a result | Navigate to conversation |

---

## Privacy

All conversation data is stored locally in your browser's IndexedDB. No data is sent to any
external server. The extension only makes requests to `claude.ai` using your existing
browser session.

> **Note:** Firefox blocks IndexedDB in Private Browsing windows. The extension will show
> an error in that context and will not function.

---

## Project structure

```
converse-firefox/
├── manifest.json        Firefox MV2 manifest
├── browser-polyfill.js  Mozilla webextension-polyfill (v0.12.0)
├── background.js        Toolbar icon click handler
├── storage.js           IndexedDB layer (ConversationStorage class)
├── content.js           UI injection and search logic
├── styles.css           Injected styles (scoped under #converse-root)
└── icons/               Extension icons (16px, 48px, 128px)
```

---

## Development

Reload the extension after any file change via the `about:debugging` **Reload** button.

To lint the extension:

```bash
npx web-ext lint
```

To build a distributable `.zip`:

```bash
npx web-ext build
```
