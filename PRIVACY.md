# Privacy Policy — Converse

**Last updated:** June 10, 2026

## What Converse does

Converse is a Firefox extension that indexes your Claude conversation history locally in your
browser so you can search across the full text of every message — not just titles.

## Data collection

**Converse collects no data.** Specifically:

- No data is sent to any external server
- No analytics or telemetry of any kind
- No personal information is stored outside your own browser
- No account or registration is required

## Local storage only

All conversation data is stored exclusively in your browser's IndexedDB database on your own
device. This data never leaves your browser. It is never transmitted to the extension author,
any third party, or any server.

You can delete all stored data at any time using the **Clear all data** option inside the
extension drawer.

## How the extension works

When you open the search drawer, Converse calls the same `claude.ai` API endpoints your
browser already uses to display your conversation list and message content. It uses your
existing browser session — no separate login, no OAuth token, no API key. The data it
fetches is written to local IndexedDB and never transmitted anywhere else.

## Permissions

| Permission | Why it is needed |
|---|---|
| `tabs` | Required to send the toggle message from the toolbar icon to the active tab |
| `activeTab` | Required to inject the search drawer into claude.ai |
| `storage` | Used to persist lightweight metadata (last sync time) in browser storage |
| `https://claude.ai/*` | Required to read your conversations from the claude.ai API using your session |

## Contact

Questions or concerns: open an issue on the project's GitHub repository.
