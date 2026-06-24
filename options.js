"use strict";

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULTS = {
  pasteToFileEnabled: false,
  pasteThresholdChars: 500,
};

// ── Elements ──────────────────────────────────────────────────────────────────

const enabledToggle   = document.getElementById("ptf-enabled");
const thresholdInput  = document.getElementById("ptf-threshold");
const thresholdRow    = document.getElementById("ptf-threshold-row");
const savedBadge      = document.getElementById("cv-saved-badge");

// ── Init ──────────────────────────────────────────────────────────────────────

browser.storage.sync.get(DEFAULTS).then((config) => {
  enabledToggle.checked  = config.pasteToFileEnabled;
  thresholdInput.value   = config.pasteThresholdChars;
  syncThresholdRowState(config.pasteToFileEnabled);
});

// ── Listeners ─────────────────────────────────────────────────────────────────

enabledToggle.addEventListener("change", () => {
  syncThresholdRowState(enabledToggle.checked);
  scheduleSave();
});

thresholdInput.addEventListener("input", scheduleSave);

thresholdInput.addEventListener("blur", () => {
  // Clamp and re-display the sanitised value so the user sees what was saved.
  thresholdInput.value = clampThreshold(thresholdInput.value);
  scheduleSave();
});

// ── Save ──────────────────────────────────────────────────────────────────────

let saveTimer = null;

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 400);
}

function save() {
  const config = {
    pasteToFileEnabled:  enabledToggle.checked,
    pasteThresholdChars: clampThreshold(thresholdInput.value),
  };

  browser.storage.sync.set(config).then(showSaved);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Clamps the raw threshold string to the valid [100, 100000] range.
 *
 * @param {string} raw
 * @returns {number}
 */
function clampThreshold(raw) {
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed) || parsed < 100)    return 100;
  if (parsed > 100_000)                 return 100_000;
  return parsed;
}

/**
 * Dims the threshold row while the feature is disabled so users understand
 * the input has no effect until the toggle is on.
 *
 * @param {boolean} enabled
 */
function syncThresholdRowState(enabled) {
  thresholdRow.classList.toggle("cv-opts-row--disabled", !enabled);
  thresholdInput.disabled = !enabled;
}

let savedTimer = null;

function showSaved() {
  savedBadge.textContent = "Saved";
  savedBadge.classList.add("cv-opts-saved--visible");
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => {
    savedBadge.classList.remove("cv-opts-saved--visible");
  }, 1500);
}
