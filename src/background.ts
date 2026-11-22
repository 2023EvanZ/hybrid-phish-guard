// Service worker: opens the side panel and stores each tab's latest prefilter report in
// session storage (cleared when the browser closes). The model call must NOT live here:
// Chrome's Prompt API is unavailable in workers.
import { tabKey } from "./shared/messages.ts";
import type { HpgMessage } from "./shared/messages.ts";

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error("sidePanel.setPanelBehavior failed", err));

chrome.runtime.onMessage.addListener((msg: HpgMessage, sender) => {
  if (msg.type !== "hpg/report" || sender.tab?.id === undefined || sender.frameId !== 0) return;
  const tabId = sender.tab.id;
  const flagged = Boolean(msg.report.features);
  void chrome.storage.session.set({ [tabKey(tabId)]: msg.report });
  // Tab-specific badge state resets on navigation, so no explicit clearing is needed.
  void chrome.action.setBadgeText({ tabId, text: flagged ? "!" : "" });
  if (flagged) void chrome.action.setBadgeBackgroundColor({ tabId, color: "#d97706" });
});

// A new document gets a fresh report from its content script; drop the old one so pages
// with no content script (chrome://, the Web Store) don't show a stale report.
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === "loading") void chrome.storage.session.remove(tabKey(tabId));
});
chrome.tabs.onRemoved.addListener((tabId) => void chrome.storage.session.remove(tabKey(tabId)));
