# Privacy Policy — Converse

**Last updated:** June 24, 2026

## What Converse does

Converse is a Firefox extension that indexes your Claude conversation history locally in your
browser so you can search across the full text of every message — not just titles. It also
includes an optional Paste to File feature that converts large text pastes into file
attachments directly within the Claude input.

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

Your Paste to File preferences (enabled/disabled, character threshold) are stored in
`browser.storage.sync`. This is local browser storage — no data is sent anywhere.

You can delete all stored conversation data at any time using the **Clear all data** option
inside the extension drawer.

## How the extension works

When you open the search drawer, Converse calls the same `claude.ai` API endpoints your
browser already uses to display your conversation list and message content. It uses your
existing browser session — no separate login, no OAuth token, no API key. The data it
fetches is written to local IndexedDB and never transmitted anywhere else.

The Paste to File feature intercepts paste events on `claude.ai` when the pasted text
exceeds your configured threshold, and uploads the text as a `.txt` file attachment using
the existing Claude upload mechanism. Clipboard content is read locally and never leaves
your browser. Press `Ctrl+Shift+V` at any time to paste normally without triggering the
conversion.

## Permissions

| Permission | Why it is needed |
|---|---|
| `tabs` | Required to send the toggle message from the toolbar icon to the active tab |
| `activeTab` | Required to inject the search drawer into claude.ai |
| `storage` | Used to persist settings (Paste to File preferences, last sync time) in browser storage |
| `clipboardRead` | Required to read pasted text for the optional Paste to File feature |
| `https://claude.ai/*` | Required to read your conversations from the claude.ai API using your session |

## Contact

Questions or concerns: open an issue on the project's GitHub repository.
