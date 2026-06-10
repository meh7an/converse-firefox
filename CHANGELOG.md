# Changelog

## v1.0.1 — 2026-06-11

Minor visual fixes.

- Fixed transparent drawer on Claude Design (claude.ai/design) — detects missing chat tokens and applies a hardcoded fallback palette matched to that page
- Feature tiles on empty state redesigned to match showcase: vertically centered, correct spacing, stroke-width 1.8, max-width 300px
- Empty state tagline shortened to "Search across all your conversations."
- Results container made flex column so empty state fills and centers correctly

---

## v1.0.0 — 2026-06-10

Initial release.

### Features
- Full-text search across all Claude conversations — searches message bodies, not just titles
- Incremental sync — only fetches conversations that changed since last sync, skips unchanged ones
- Sort results by relevance, date modified (newest/oldest), or date created (newest/oldest)
- Highlighted snippets — shows the matching passage with search terms marked in context
- Click any result to navigate directly to that conversation
- Middle-click opens conversation in a new tab
- Right-click shows browser context menu (Open in New Tab, Copy Link, etc.)
- Keyboard shortcut: Ctrl+Shift+F to open/close, Escape to close
- Sync starts automatically in the background as soon as the page loads
- Pulsing dot on the collapsed tab indicates sync in progress
- Private Browsing guard — shows a clear error instead of silently failing

### Design
- Drawer UI matches claude.ai's own design language — same typography, spacing, and color tokens
- Automatically follows claude.ai's light and dark mode with zero lag (reads CSS custom properties live)
- Toolbar icon ships in light and dark variants; Firefox picks the correct one based on browser theme
- Result cards use native <a> elements for correct browser behaviour (middle-click, context menu, drag-safe)

### Performance
- Footer stats (count, last sync, storage size) are cached in memory — no IndexedDB reads on repeat opens
- Storage size calculated via navigator.storage.estimate() — no data loading, instant
- All three footer values fetched in parallel with Promise.all
- Sync deferred past the drawer open animation so open/close is always instant CSS-only

### Privacy
- All data stored locally in browser IndexedDB — nothing ever leaves the device
- No analytics, no telemetry, no external servers
- data_collection_permissions declared in manifest per Mozilla policy (November 2025)
