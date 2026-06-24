// Converse — Content Script
// Injects the search drawer into claude.ai and manages all UI interactions.

(function () {
  "use strict";

  // Guard against double-injection on SPA navigations.
  if (document.getElementById("converse-root")) return;

  // ---------------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------------

  const CONFIG = {
    batchSize: 30,
    batchDelayMs: 100,
    searchDebounceMs: 280,
  };

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let isOpen = false;
  let isSyncing = false;
  let hasSyncedThisSession = false;
  let footerCache = null;
  let searchTimer = null;
  let currentQuery = "";
  let currentSort = "relevance";

  // ---------------------------------------------------------------------------
  // Paste-to-File — constants
  // ---------------------------------------------------------------------------

  const PTF_TOAST_ID = "converse-ptf-toast";

  const PTF_DEFAULTS = {
    pasteToFileEnabled: false,
    pasteThresholdChars: 500,
  };

  // ---------------------------------------------------------------------------
  // IndexedDB availability check (Firefox blocks it in Private Browsing)
  // ---------------------------------------------------------------------------

  async function isStorageAvailable() {
    try {
      await window.converseStorage.getConversationCount();
      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Claude API helpers
  // ---------------------------------------------------------------------------

  function getOrgId() {
    for (const cookie of document.cookie.split(";")) {
      const [name, value] = cookie.trim().split("=");
      if (name === "lastActiveOrg") return decodeURIComponent(value);
    }
    return null;
  }

  async function fetchWithRetry(url, maxAttempts = 3, delayMs = 1000) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await fetch(url);
        if (!res.ok) {
          const { status } = res;
          if ((status >= 500 || status === 429) && attempt < maxAttempts) {
            await sleep(delayMs);
            delayMs *= 2;
            continue;
          }
          throw new Error(`HTTP ${status}`);
        }
        return res.json();
      } catch (err) {
        if (attempt === maxAttempts) throw err;
        await sleep(delayMs);
        delayMs *= 1.5;
      }
    }
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // ---------------------------------------------------------------------------
  // DOM — build the drawer
  // ---------------------------------------------------------------------------

  function buildDrawer() {
    const root = document.createElement("div");
    root.id = "converse-root";
    root.innerHTML = `
      <button id="converse-toggle" aria-label="Open Converse search">
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24"
             fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="8"/>
          <path d="m21 21-4.3-4.3"/>
        </svg>
        <span>Search</span>
      </button>

      <div id="converse-drawer" role="dialog" aria-label="Conversation search" aria-modal="true">

        <div class="cv-header">
          <div class="cv-header-top">
            <span class="cv-wordmark">Converse</span>
            <button class="cv-close-btn" id="converse-close" aria-label="Close search">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                   fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
              </svg>
            </button>
          </div>
          <div class="cv-search-wrap">
            <svg class="cv-search-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
                 fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8"/>
              <path d="m21 21-4.3-4.3"/>
            </svg>
            <input
              id="converse-input"
              type="search"
              placeholder="Search conversations…"
              autocomplete="off"
              spellcheck="false"
            />
          </div>
          <div class="cv-hint">
            <span class="cv-hint-keys"><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>F</kbd> to toggle</span>
            <button class="cv-sort-toggle" id="converse-sort-toggle" aria-label="Sort by relevance" data-sort="relevance"></button>
          </div>
        </div>

        <div class="cv-panels">
          <div class="cv-results" id="converse-results" role="list">
          <div class="cv-empty" id="converse-empty-initial">
            <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24"
                 fill="none" stroke="currentColor" stroke-width="1.5"
                 stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"/>
              <path d="m21 21-4.3-4.3"/>
            </svg>
            <p>Search across all your conversations.</p>
            <div class="cv-feature-tiles">
              <div class="cv-feature-tile">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
                     fill="none" stroke="currentColor" stroke-width="1.8"
                     stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                </svg>
                <span>Message body search</span>
              </div>
              <div class="cv-feature-tile">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
                     fill="none" stroke="currentColor" stroke-width="1.8"
                     stroke-linecap="round" stroke-linejoin="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                </svg>
                <span>Relevance-ranked results</span>
              </div>
              <div class="cv-feature-tile">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
                     fill="none" stroke="currentColor" stroke-width="1.8"
                     stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
                <span>100% local, fully private</span>
              </div>
            </div>
          </div>
        </div>

          <div class="cv-settings-panel" id="converse-settings-panel" hidden>
            <div class="cv-settings-inner">
              <p class="cv-settings-title">Paste to File</p>
              <p class="cv-settings-desc">Pastes longer than the threshold are uploaded as a <code>.txt</code> attachment instead of raw text.</p>
              <div class="cv-settings-row">
                <span class="cv-settings-label">Enable</span>
                <label class="cv-tog" aria-label="Enable paste to file"><input type="checkbox" id="ptf-enabled" /><span class="cv-tog-track"><span class="cv-tog-thumb"></span></span></label>
              </div>
              <div class="cv-settings-row" id="ptf-threshold-row">
                <label class="cv-settings-label" for="ptf-threshold">Threshold</label>
                <div class="cv-settings-field"><input type="number" id="ptf-threshold" class="cv-settings-input" min="100" max="100000" step="100" placeholder="500" /><span class="cv-settings-unit">chars</span></div>
              </div>
              <p class="cv-settings-saved" id="cv-settings-saved"></p>
            </div>
          </div>
        </div>

        <div class="cv-progress" id="converse-progress" hidden>
          <div class="cv-progress-track">
            <div class="cv-progress-fill" id="converse-progress-fill" style="width:0%"></div>
          </div>
          <span class="cv-progress-label" id="converse-progress-label">Syncing…</span>
        </div>

        <div class="cv-footer">
          <div class="cv-footer-left">
            <span id="converse-count">—</span>
            <span class="cv-sep">·</span>
            <span id="converse-last-sync"></span>
          </div>
          <div class="cv-footer-right">
            <button class="cv-icon-btn" id="converse-sync-btn" title="Sync conversations">
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
                   fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                <path d="M3 3v5h5"/>
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/>
                <path d="M16 21h5v-5"/>
              </svg>
              Sync
            </button>
            <button class="cv-icon-btn cv-icon-btn--icon-only" id="converse-settings-btn" title="Settings" aria-pressed="false"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l-.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button>
            <div class="cv-storage-wrap" id="converse-storage-wrap">
              <button class="cv-storage-btn" id="converse-storage-btn" title="Storage options">
                <span id="converse-storage-size">—</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24"
                     fill="none" stroke="currentColor" stroke-width="2.5"
                     stroke-linecap="round" stroke-linejoin="round">
                  <path d="m6 9 6 6 6-6"/>
                </svg>
              </button>
              <div class="cv-storage-menu" id="converse-storage-menu" hidden>
                <button id="converse-clear-btn" class="cv-menu-item cv-menu-item--danger">
                  Clear all data
                </button>
              </div>
            </div>
          </div>
        </div>

      </div>
    `;
    document.body.appendChild(root);
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  async function init() {
    buildDrawer();
    bindEvents();
    initPasteToFile();

    // Claude Design (claude.ai/design/*) uses a different CSS token system.
    // When --bg-000 is absent, activate the fallback token block.
    const hasChatTokens =
      getComputedStyle(document.documentElement)
        .getPropertyValue("--bg-000")
        .trim().length > 0;
    if (!hasChatTokens) {
      document
        .getElementById("converse-root")
        .setAttribute("data-cv-fallback", "");
    }

    refreshFooter();

    const storageOk = await isStorageAvailable();
    if (!storageOk) {
      showState("error", {
        title: "Unavailable in Private Browsing",
        body: "Firefox blocks local storage in private windows. Open a regular window to use Converse.",
      });
      return;
    }

    // Start syncing immediately in the background — tab shows a loading indicator.
    syncConversations();
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  const SVG_NS = "http://www.w3.org/2000/svg";

  function makeSortSvg(isRelevance) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("width", "11");
    svg.setAttribute("height", "11");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2.2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");

    if (isRelevance) {
      [
        ["8", "6", "21", "6"],
        ["8", "12", "21", "12"],
        ["8", "18", "21", "18"],
        ["3", "6", "3.01", "6"],
        ["3", "12", "3.01", "12"],
        ["3", "18", "3.01", "18"],
      ].forEach(([x1, y1, x2, y2]) => {
        const l = document.createElementNS(SVG_NS, "line");
        l.setAttribute("x1", x1);
        l.setAttribute("y1", y1);
        l.setAttribute("x2", x2);
        l.setAttribute("y2", y2);
        svg.appendChild(l);
      });
    } else {
      const c = document.createElementNS(SVG_NS, "circle");
      c.setAttribute("cx", "12");
      c.setAttribute("cy", "12");
      c.setAttribute("r", "10");
      svg.appendChild(c);
      const p = document.createElementNS(SVG_NS, "polyline");
      p.setAttribute("points", "12 6 12 12 16 14");
      svg.appendChild(p);
    }
    return svg;
  }

  function setSortToggleContent(btn, sort) {
    const isRelevance = sort === "relevance";
    btn.replaceChildren(
      makeSortSvg(isRelevance),
      document.createTextNode(isRelevance ? " Relevance" : " Recent"),
    );
  }

  function bindEvents() {
    const toggle = document.getElementById("converse-toggle");
    const closeBtn = document.getElementById("converse-close");
    const input = document.getElementById("converse-input");
    const sortToggleBtn = document.getElementById("converse-sort-toggle");
    setSortToggleContent(sortToggleBtn, currentSort);
    const syncBtn = document.getElementById("converse-sync-btn");
    const storageBtn = document.getElementById("converse-storage-btn");
    const storageMenu = document.getElementById("converse-storage-menu");
    const clearBtn = document.getElementById("converse-clear-btn");

    toggle.addEventListener("click", toggleDrawer);
    closeBtn.addEventListener("click", closeDrawer);

    input.addEventListener("input", (e) => onSearchInput(e.target.value));

    sortToggleBtn.addEventListener("click", () => {
      // Cycle: relevance → modified-desc → relevance
      const next = currentSort === "relevance" ? "modified-desc" : "relevance";
      currentSort = next;
      sortToggleBtn.dataset.sort = next;
      sortToggleBtn.setAttribute(
        "aria-label",
        next === "relevance" ? "Sort by relevance" : "Sort by recent",
      );
      setSortToggleContent(sortToggleBtn, next);
      if (currentQuery.trim()) runSearch(currentQuery);
    });

    syncBtn.addEventListener("click", () => {
      if (!isSyncing) syncConversations();
    });

    document
      .getElementById("converse-settings-btn")
      .addEventListener("click", () => {
        toggleSettingsPanel();
      });

    storageBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      storageMenu.hidden = !storageMenu.hidden;
    });

    document.addEventListener("click", () => {
      storageMenu.hidden = true;
    });

    clearBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (
        !confirm(
          "Clear all indexed conversations? You will need to sync again.",
        )
      )
        return;
      await window.converseStorage.clearAll();
      footerCache = null;
      storageMenu.hidden = true;
      refreshFooter(true);
      showState("initial");
    });

    document.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === "F") {
        e.preventDefault();
        toggleDrawer();
      }
      if (e.key === "Escape" && isOpen) {
        closeDrawer();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Drawer open / close
  // ---------------------------------------------------------------------------

  function toggleDrawer() {
    isOpen ? closeDrawer() : openDrawer();
  }

  function openDrawer() {
    const drawer = document.getElementById("converse-drawer");
    const toggle = document.getElementById("converse-toggle");
    const input = document.getElementById("converse-input");

    isOpen = true;
    drawer.classList.add("cv-open");
    toggle.classList.add("cv-toggle--open");
    setTimeout(() => input.focus(), 260);
  }

  function closeDrawer() {
    const drawer = document.getElementById("converse-drawer");
    const toggle = document.getElementById("converse-toggle");

    isOpen = false;
    drawer.classList.remove("cv-open");
    toggle.classList.remove("cv-toggle--open");
  }

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------

  function onSearchInput(query) {
    currentQuery = query;
    clearTimeout(searchTimer);

    if (!query.trim()) {
      showState("initial");
      return;
    }

    showState("loading");

    searchTimer = setTimeout(() => runSearch(query), CONFIG.searchDebounceMs);
  }

  async function runSearch(query) {
    if (query !== currentQuery) return;

    try {
      const results = await window.converseStorage.search(query, {
        sortBy: currentSort,
      });
      if (query !== currentQuery) return;

      if (results.length === 0) {
        showState("no-results", { query });
      } else {
        renderResults(results, query);
      }
    } catch (err) {
      console.error("[Converse] Search error:", err);
      showState("error", { title: "Search failed", body: "Please try again." });
    }
  }

  // ---------------------------------------------------------------------------
  // Render results
  // ---------------------------------------------------------------------------

  function renderResults(results, query) {
    const container = document.getElementById("converse-results");
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 0);

    // Using <a> instead of <div> gives us middle-click, right-click context menu,
    // and drag-safe behaviour for free — the browser won't fire click after a drag
    // on a real anchor element.
    // DOMParser used instead of innerHTML to satisfy web-ext lint; all user-facing
    // strings are passed through escapeHtml() before interpolation.
    const html = results
      .map((r) => {
        const date = new Date(r.updated_at).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
        const match = r.matchingMessages[0];
        let snippet = "";

        if (match) {
          let raw = escapeHtml(match.snippet);
          for (const term of terms) {
            const re = new RegExp(`(${escapeRegExp(term)})`, "gi");
            raw = raw.replace(re, "<mark>$1</mark>");
          }
          // sender is null for synthetic title-match entries — skip the label.
          const senderLabel = match.sender
            ? `<p class="cv-result-sender cv-result-sender--${match.sender === "human" ? "human" : "assistant"}">${match.sender === "human" ? "You" : "Claude"}</p>`
            : "";
          snippet = `${senderLabel}<p class="cv-result-snippet">${raw}</p>`;
        }

        // Only show the match badge when there is a real count to show.
        const badge =
          r.matchCount > 0
            ? `<span class="cv-result-badge">${r.matchCount} match${r.matchCount !== 1 ? "es" : ""}</span>`
            : "";

        return `
          <a class="cv-result"
             role="listitem"
             href="https://claude.ai/chat/${r.uuid}"
             title="${escapeHtml(r.name)}">
            <div class="cv-result-meta">
              <span class="cv-result-title">${escapeHtml(r.name)}</span>
              <span class="cv-result-date">${date}</span>
            </div>
            ${badge}
            ${snippet}
          </a>
        `;
      })
      .join("");

    const doc = new DOMParser().parseFromString(
      `<div>${html}</div>`,
      "text/html",
    );
    container.replaceChildren(...doc.body.firstChild.childNodes);
  }

  // ---------------------------------------------------------------------------
  // State screens
  // ---------------------------------------------------------------------------

  function showState(state, data = {}) {
    const container = document.getElementById("converse-results");

    const templates = {
      initial: `
        <div class="cv-empty">
          <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" stroke-width="1.5"
               stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
          </svg>
          <p>Search across all your conversations.</p>
          <div class="cv-feature-tiles">
            <div class="cv-feature-tile">
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24"
                   fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
              <span>Message body search</span>
            </div>
            <div class="cv-feature-tile">
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24"
                   fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
              </svg>
              <span>Relevance-ranked results</span>
            </div>
            <div class="cv-feature-tile">
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24"
                   fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              <span>100% local, fully private</span>
            </div>
          </div>
        </div>`,

      loading: `<div class="cv-spinner" role="status" aria-label="Searching"></div>`,

      "no-results": `
        <div class="cv-empty">
          <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" stroke-width="1.5"
               stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
          </svg>
          <p>No results for <strong>${escapeHtml(data.query ?? "")}</strong>.<br>Try different keywords or sync your conversations.</p>
        </div>`,

      error: `
        <div class="cv-empty cv-empty--error">
          <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" stroke-width="1.5"
               stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <p><strong>${escapeHtml(data.title ?? "Error")}</strong><br>${escapeHtml(data.body ?? "")}</p>
        </div>`,
    };

    const parsed = new DOMParser().parseFromString(
      `<div>${templates[state] ?? templates.initial}</div>`,
      "text/html",
    );
    container.replaceChildren(...parsed.body.firstChild.childNodes);
  }

  // ---------------------------------------------------------------------------
  // Sync
  // ---------------------------------------------------------------------------

  async function syncConversations() {
    if (isSyncing) return;

    const orgId = getOrgId();
    if (!orgId) {
      showState("error", {
        title: "Not signed in",
        body: "Sign in to Claude, then try again.",
      });
      return;
    }

    isSyncing = true;
    hasSyncedThisSession = true;
    const toggle = document.getElementById("converse-toggle");
    const syncBtn = document.getElementById("converse-sync-btn");
    const progress = document.getElementById("converse-progress");
    const fill = document.getElementById("converse-progress-fill");
    const label = document.getElementById("converse-progress-label");

    toggle.classList.add("cv-toggle--syncing");
    syncBtn.classList.add("cv-icon-btn--spinning");
    syncBtn.disabled = true;
    progress.hidden = false;

    try {
      label.textContent = "Fetching conversation list…";
      fill.style.width = "5%";

      const list = await fetchWithRetry(
        `https://claude.ai/api/organizations/${orgId}/chat_conversations`,
      );

      const existing = await window.converseStorage.getTimestamps();
      const toFetch = list.filter(
        (c) => !existing[c.uuid] || existing[c.uuid] !== c.updated_at,
      );

      if (toFetch.length === 0) {
        label.textContent = "Everything is up to date.";
        fill.style.width = "100%";
        await sleep(1200);
      } else {
        let done = 0;

        for (let i = 0; i < toFetch.length; i += CONFIG.batchSize) {
          const batch = toFetch.slice(i, i + CONFIG.batchSize);

          const fetched = (
            await Promise.all(
              batch.map(async (conv) => {
                try {
                  return await fetchWithRetry(
                    `https://claude.ai/api/organizations/${orgId}/chat_conversations/${conv.uuid}?tree=True&rendering_mode=messages&render_all_tools=true`,
                  );
                } catch {
                  return null;
                }
              }),
            )
          ).filter(Boolean);

          await window.converseStorage.saveConversations(fetched);

          done += batch.length;
          const pct = Math.round((done / toFetch.length) * 100);
          fill.style.width = `${pct}%`;
          label.textContent = `Syncing ${done} of ${toFetch.length}…`;

          if (i + CONFIG.batchSize < toFetch.length)
            await sleep(CONFIG.batchDelayMs);
        }
      }

      await window.converseStorage.setMetadata(
        "lastSyncTime",
        new Date().toISOString(),
      );
      label.textContent = "Sync complete.";
      fill.style.width = "100%";
      await sleep(1400);
    } catch (err) {
      console.error("[Converse] Sync error:", err);
      label.textContent = `Sync failed: ${err.message}`;
      await sleep(2200);
    } finally {
      isSyncing = false;
      toggle.classList.remove("cv-toggle--syncing");
      syncBtn.classList.remove("cv-icon-btn--spinning");
      syncBtn.disabled = false;
      progress.hidden = true;
      fill.style.width = "0%";
      refreshFooter(true);
    }
  }

  // ---------------------------------------------------------------------------
  // Footer
  // ---------------------------------------------------------------------------

  async function refreshFooter(bustCache = false) {
    const countEl = document.getElementById("converse-count");
    const lastSyncEl = document.getElementById("converse-last-sync");
    const sizeEl = document.getElementById("converse-storage-size");

    // Serve from cache on every open — only re-read after a sync or clear.
    if (footerCache && !bustCache) {
      countEl.textContent = footerCache.count;
      lastSyncEl.textContent = footerCache.lastSync;
      sizeEl.textContent = footerCache.size;
      return;
    }

    try {
      const [count, lastSync, bytes] = await Promise.all([
        window.converseStorage.getConversationCount(),
        window.converseStorage.getMetadata("lastSyncTime"),
        window.converseStorage.getStorageSize(),
      ]);

      const countText = `${count} indexed`;
      const lastSyncText = lastSync
        ? `synced ${new Date(lastSync).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
        : "never synced";
      const sizeText = formatBytes(bytes);

      footerCache = {
        count: countText,
        lastSync: lastSyncText,
        size: sizeText,
      };

      countEl.textContent = countText;
      lastSyncEl.textContent = lastSyncText;
      sizeEl.textContent = sizeText;
    } catch {
      countEl.textContent = "—";
    }
  }

  function formatBytes(n) {
    if (n === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(n) / Math.log(1024));
    return `${(n / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  }

  // ---------------------------------------------------------------------------
  // Paste-to-File
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Settings panel (inline, inside the drawer)
  // ---------------------------------------------------------------------------

  let isSettingsOpen = false;

  function toggleSettingsPanel() {
    isSettingsOpen ? closeSettingsPanel() : openSettingsPanel();
  }

  function openSettingsPanel() {
    isSettingsOpen = true;
    document.getElementById("converse-settings-panel").hidden = false;
    document.getElementById("converse-results").hidden = true;
    document
      .getElementById("converse-settings-btn")
      .setAttribute("aria-pressed", "true");
    initSettingsPanel();
  }

  function closeSettingsPanel() {
    isSettingsOpen = false;
    document.getElementById("converse-settings-panel").hidden = true;
    document.getElementById("converse-results").hidden = false;
    document
      .getElementById("converse-settings-btn")
      .setAttribute("aria-pressed", "false");
  }

  function initSettingsPanel() {
    const enabledEl = document.getElementById("ptf-enabled");
    const thresholdEl = document.getElementById("ptf-threshold");
    const thresholdRow = document.getElementById("ptf-threshold-row");
    const savedEl = document.getElementById("cv-settings-saved");

    // Load current values from storage.
    browser.storage.sync
      .get(PTF_DEFAULTS)
      .then((config) => {
        enabledEl.checked = config.pasteToFileEnabled;
        thresholdEl.value = config.pasteThresholdChars;
        syncThresholdRow(config.pasteToFileEnabled);
      })
      .catch(() => {
        enabledEl.checked = PTF_DEFAULTS.pasteToFileEnabled;
        thresholdEl.value = PTF_DEFAULTS.pasteThresholdChars;
      });

    // Avoid stacking listeners on repeated opens.
    if (enabledEl.dataset.bound) return;
    enabledEl.dataset.bound = "1";

    let saveTimer = null;

    const scheduleSave = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveSettings, 400);
    };

    const saveSettings = () => {
      const threshold = Math.min(
        100000,
        Math.max(100, parseInt(thresholdEl.value, 10) || 500),
      );
      thresholdEl.value = threshold;
      const config = {
        pasteToFileEnabled: enabledEl.checked,
        pasteThresholdChars: threshold,
      };
      browser.storage.sync
        .set(config)
        .then(() => {
          savedEl.textContent = "Saved";
          clearTimeout(saveSettings._t);
          saveSettings._t = setTimeout(() => {
            savedEl.textContent = "";
          }, 1500);
          // Re-arm the paste listener with updated config.
          initPasteToFile();
        })
        .catch(() => {});
    };

    enabledEl.addEventListener("change", () => {
      syncThresholdRow(enabledEl.checked);
      scheduleSave();
    });
    thresholdEl.addEventListener("input", scheduleSave);
    thresholdEl.addEventListener("blur", saveSettings);

    function syncThresholdRow(enabled) {
      thresholdRow.classList.toggle("cv-settings-row--disabled", !enabled);
      thresholdEl.disabled = !enabled;
    }
  }

  // Tracks the active paste-to-file config so the single shared listener
  // always uses current settings without re-registering on every save.
  let ptfConfig = null;
  let ptfListenerActive = false;

  // Set by the Ctrl+Shift+V keydown handler — consumed on the next paste event.
  let ptfBypassNext = false;

  async function initPasteToFile() {
    let config;
    try {
      config = await browser.storage.sync.get(PTF_DEFAULTS);
    } catch {
      // storage.sync unavailable (Private Browsing) — leave feature off.
      ptfConfig = null;
      return;
    }

    // Always update the live config so the shared listener picks up new values.
    ptfConfig = config.pasteToFileEnabled ? config : null;

    // Register the listeners exactly once for the lifetime of the content script.
    if (ptfListenerActive) return;
    ptfListenerActive = true;

    document.addEventListener("paste", onPaste, true);

    // Ctrl+Shift+V — set bypass flag so the next paste event is let through.
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.ctrlKey && e.shiftKey && e.key === "V") {
          ptfBypassNext = true;
        }
      },
      true,
    );
  }

  function onPaste(event) {
    // Feature disabled or bypass hotkey was pressed — let paste through normally.
    if (!ptfConfig || ptfBypassNext) {
      ptfBypassNext = false;
      return;
    }

    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (text.length < ptfConfig.pasteThresholdChars) return;

    event.preventDefault();
    event.stopPropagation();

    const file = buildPasteFile(text);

    tryInjectFile(file).then((injected) => {
      if (!injected) {
        showPtfToast({
          label: text.length.toLocaleString() + " chars — upload as file?",
          onConfirm: () => tryInjectFile(file),
        });
      }
    });
  }

  function buildPasteFile(text) {
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);
    return new File([text], "paste-" + timestamp + ".txt", {
      type: "text/plain",
    });
  }

  /**
   * Injects a File into Claude's hidden file input via the native
   * HTMLInputElement files setter, bypassing React's synthetic event lock.
   * Fires a bubbling change event so React's delegated listener picks up
   * the new FileList.
   *
   * @param {File} file
   * @returns {Promise<boolean>}
   */
  async function tryInjectFile(file) {
    const input = document.querySelector('input[type="file"]');
    if (!input) return false;

    const nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "files",
    )?.set;

    if (!nativeSetter) return false;

    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      nativeSetter.call(input, dt.files);
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Paste-to-File — toast (Shadow DOM, isolated from claude.ai + Converse styles)
  // ---------------------------------------------------------------------------

  function showPtfToast({ label, onConfirm, autoDismissMs = 7000 }) {
    removePtfToast();

    const host = document.createElement("div");
    host.id = PTF_TOAST_ID;

    const shadow = host.attachShadow({ mode: "closed" });
    const parsed = new DOMParser().parseFromString(
      ptfToastTemplate(label),
      "text/html",
    );
    shadow.append(
      ...Array.from(parsed.head.childNodes),
      ...Array.from(parsed.body.childNodes),
    );
    document.body.appendChild(host);

    const toast = shadow.querySelector(".ptf-toast");

    // Defer so the CSS transition fires on the freshly painted node.
    requestAnimationFrame(() => toast.classList.add("ptf-toast--visible"));

    let timer = null;

    const dismiss = () => {
      if (!host.isConnected) return;
      toast.classList.remove("ptf-toast--visible");
      toast.addEventListener("transitionend", () => host.remove(), {
        once: true,
      });
      clearTimeout(timer);
    };

    shadow.querySelector(".ptf-action").addEventListener("click", () => {
      dismiss();
      requestAnimationFrame(onConfirm);
    });

    shadow.querySelector(".ptf-close").addEventListener("click", dismiss);

    const arm = () => {
      timer = setTimeout(dismiss, autoDismissMs);
    };
    toast.addEventListener("mouseenter", () => clearTimeout(timer));
    toast.addEventListener("mouseleave", arm);
    arm();
  }

  function removePtfToast() {
    document.getElementById(PTF_TOAST_ID)?.remove();
  }

  function ptfToastTemplate(label) {
    const safeLabel = label
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
    return `
      <style>
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :host {
          all: initial;
          position: fixed;
          inset-block-end: 24px;
          inset-inline-end: 24px;
          z-index: 2147483647;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        .ptf-toast {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 11px 14px;
          border-radius: 10px;
          background: #1e1d1b;
          border: 1px solid rgba(255,255,255,.08);
          max-width: 360px;
          min-width: 240px;
          opacity: 0;
          transform: translateY(8px);
          transition: opacity 180ms ease, transform 180ms ease;
          box-shadow: 0 4px 16px rgba(0,0,0,.4), 0 1px 4px rgba(0,0,0,.2);
        }
        .ptf-toast--visible { opacity: 1; transform: translateY(0); }
        .ptf-icon { font-size: 16px; flex-shrink: 0; line-height: 1; }
        .ptf-label { flex: 1; font-size: 12.5px; color: #b5b3ae; line-height: 1.45; }
        .ptf-action {
          flex-shrink: 0;
          padding: 5px 11px;
          border: none;
          border-radius: 6px;
          background: #d97757;
          color: #fff;
          font-size: 12.5px;
          font-weight: 500;
          cursor: pointer;
          white-space: nowrap;
          transition: background 120ms ease;
        }
        .ptf-action:hover { background: #c6613f; }
        .ptf-action:active { background: #b5563a; }
        .ptf-close {
          flex-shrink: 0;
          width: 22px;
          height: 22px;
          border: none;
          border-radius: 4px;
          background: transparent;
          color: #6b6a67;
          font-size: 15px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 120ms ease, color 120ms ease;
        }
        .ptf-close:hover { background: rgba(255,255,255,.08); color: #b5b3ae; }
      </style>
      <div class="ptf-toast" role="status" aria-live="polite" aria-atomic="true">
        <span class="ptf-icon" aria-hidden="true">\U0001F4C4</span>
        <span class="ptf-label">${safeLabel}</span>
        <button class="ptf-action" type="button">Upload as file</button>
        <button class="ptf-close" type="button" aria-label="Dismiss">&#x2715;</button>
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  function escapeHtml(str) {
    const el = document.createElement("span");
    el.textContent = str;
    return el.innerHTML;
  }

  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // ---------------------------------------------------------------------------
  // Message listener (toolbar icon → background → here)
  // ---------------------------------------------------------------------------

  browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === "toggleDrawer") {
      toggleDrawer();
      sendResponse({ ok: true });
    }
    return true;
  });

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
