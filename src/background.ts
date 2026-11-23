// Service worker: opens the side panel, triages each checked page, and keeps every tab's
// latest prefilter report and verdict in session storage (cleared when the browser
// closes). The content script gets the verdict back as the reply to its report, so a
// verdict can only ever reach the document that asked for it.
//
// Models: Chrome's Prompt API is unavailable in workers, so the on-device classifier
// can't run here. Until the Firebase spike settles where it lives (side panel or an
// offscreen document), triage runs with no classifiers and returns the rules verdict.
import { verdictKey, tabKey } from "./shared/messages.ts";
import type { HpgMessage, PrefilterReport, ReportReply, StoredVerdict } from "./shared/messages.ts";
import { triage } from "./triage/pipeline.ts";
import type { TriageDeps } from "./triage/pipeline.ts";
import { badgeFor } from "./triage/present.ts";

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error("sidePanel.setPanelBehavior failed", err));

async function classifiers(): Promise<TriageDeps> {
  return {};
}

// Bumped on every navigation, so a slow verdict for the previous document isn't stored
// against the new one. Lost if the worker restarts mid-triage; the window is tiny for
// the rules, and gets revisited once model calls (seconds) land.
const generation = new Map<number, number>();

async function handleReport(tabId: number, report: PrefilterReport, manual: boolean): Promise<ReportReply> {
  const gen = generation.get(tabId) ?? 0;
  await chrome.storage.session.set({ [tabKey(tabId)]: report });
  if (!report.features) {
    await chrome.storage.session.remove(verdictKey(tabId));
    await chrome.action.setBadgeText({ tabId, text: "" });
    return { verdict: null };
  }
  const result = await triage(report.features, await classifiers());
  if ((generation.get(tabId) ?? 0) === gen) {
    const stored: StoredVerdict = { url: report.url, manual, triage: result };
    await chrome.storage.session.set({ [verdictKey(tabId)]: stored });
    const badge = badgeFor(result);
    // Tab-specific badge state resets on navigation, so no explicit clearing is needed.
    await chrome.action.setBadgeText({ tabId, text: badge.text });
    if (badge.text) await chrome.action.setBadgeBackgroundColor({ tabId, color: badge.color });
  }
  return { verdict: result };
}

async function leave(tabId: number) {
  try {
    await chrome.tabs.goBack(tabId);
  } catch {
    // Nothing to go back to (the phishing link opened in a new tab): close it.
    await chrome.tabs.remove(tabId);
  }
}

chrome.runtime.onMessage.addListener((msg: HpgMessage, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (tabId === undefined || sender.frameId !== 0) return;
  if (msg.type === "hpg/report") {
    handleReport(tabId, msg.report, Boolean(msg.manual))
      .then(sendResponse)
      .catch((err) => {
        console.error("triage failed", err);
        sendResponse({ verdict: null } satisfies ReportReply);
      });
    return true; // async reply
  }
  if (msg.type === "hpg/leave") void leave(tabId);
});

// A new document gets a fresh report from its content script; drop the old one so pages
// with no content script (chrome://, the Web Store) don't show a stale report.
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status !== "loading") return;
  generation.set(tabId, (generation.get(tabId) ?? 0) + 1);
  void chrome.storage.session.remove([tabKey(tabId), verdictKey(tabId)]);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  generation.delete(tabId);
  void chrome.storage.session.remove([tabKey(tabId), verdictKey(tabId)]);
});
