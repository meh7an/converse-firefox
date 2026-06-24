# Converse — Full-Text Search for Claude (Firefox)

Search across the complete content of all your Claude conversations — not just titles.
Includes a Paste to File feature that uploads large pastes as `.txt` attachments so Claude
can read them directly without regenerating content.

---

## What it does

Claude's built-in search only matches conversation titles. Converse indexes every message
and lets you find anything you actually said or Claude actually replied, with highlighted
snippets and direct navigation.

- **Full-text search** — searches message bodies, not just titles
- **Sort by relevance or recency** — toggle between best-match and most-recently-edited
- **Incremental sync** — only fetches conversations that have changed
- **Local-only** — all data lives in IndexedDB in your browser; nothing leaves your device
- **Claude-native UI** — the drawer matches Claude's own design language
- **Keyboard-first** — `Ctrl`+`Shift`+`F` to open, `Escape` to close
- **Paste to File** — converts large pastes into file attachments automatically

---

## Paste to File

When enabled, any paste above a configurable character threshold is automatically uploaded
as a `.txt` file attachment instead of being pasted as raw text. Claude reads the file
directly — no need to re-paste or ask it to regenerate content.

- Enable and configure the threshold via the **⚙** button in the drawer footer
- Default threshold: 500 characters
- **`Ctrl`+`Shift`+`V`** — paste normally at any time, bypassing the conversion

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
| `Ctrl`+`Shift`+`V` | Paste as plain text (bypasses Paste to File) |

---

## Privacy

All conversation data is stored locally in your browser's IndexedDB. Paste to File
preferences are stored in `browser.storage.sync`. No data is sent to any external server.
The extension only makes requests to `claude.ai` using your existing browser session.

See [PRIVACY.md](PRIVACY.md) for full details.

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
├── content.js           UI injection, search logic, and Paste to File
├── styles.css           Injected styles (scoped under #converse-root)
├── options.html         Settings page (Paste to File configuration)
├── options.css          Settings page styles
├── options.js           Settings page logic
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
