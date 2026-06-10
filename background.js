// Converse — Background Script
// Handles toolbar icon clicks and relays toggle commands to the content script.

browser.browserAction.onClicked.addListener(async (tab) => {
  if (!tab.url || !tab.url.startsWith("https://claude.ai")) {
    return;
  }

  try {
    await browser.tabs.sendMessage(tab.id, { action: "toggleDrawer" });
  } catch {
    // Content script not yet injected — user will need to reload the tab.
    console.warn("[Converse] Content script not ready on this tab.");
  }
});

browser.runtime.onMessage.addListener((message, sender) => {
  if (message.action === "getTabId") {
    return Promise.resolve({ tabId: sender.tab?.id });
  }
});
