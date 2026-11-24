// Service worker: opens the side panel, triages each checked page, and keeps every tab's
// latest prefilter report and verdict in session storage (cleared when the browser
// closes). The content script gets the verdict back as the reply to its report, so a
// verdict can only ever reach the document that asked for it.
//
// Models: Chrome's Prompt API is unavailable in workers, so both Firebase models live in
// an offscreen document (src/offscreen.ts). The pipeline here still owns prompt building,
// redaction and parsing; the offscreen document only turns prompts into text.
import { verdictKey, tabKey } from "./shared/messages.ts";
import type { HpgMessage, OffscreenRequest, PrefilterReport, ReportReply, StoredVerdict } from "./shared/messages.ts";
import { modelClassifier } from "./triage/model.ts";
import { triage } from "./triage/pipeline.ts";
import type { TriageDeps } from "./triage/pipeline.ts";
import { badgeFor } from "./triage/present.ts";
import { offscreenTextModel } from "./triage/remote.ts";

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error("sidePanel.setPanelBehavior failed", err));

const OFFSCREEN_URL = "offscreen.html";
let creating: Promise<void> | null = null;

async function ensureOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return;
  // Single-flight: concurrent reports must not race to create two documents (Chrome
  // allows one per extension and throws on the second).
  creating ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_URL,
      // There is no Prompt-API reason. DOM_PARSER is the closest fit; the justification
      // says what it's really for. Fine unpacked; a Web Store review could object.
      reasons: ["DOM_PARSER"],
      justification: "Runs Gemini Nano (Chrome Prompt API), which is unavailable in service workers, to classify pages on-device.",
    })
    .finally(() => {
      creating = null;
    });
  await creating;
}

async function sendOffscreen(req: OffscreenRequest): Promise<unknown> {
  await ensureOffscreen();
  try {
    return await chrome.runtime.sendMessage(req);
  } catch (e) {
    // A just-created document may not have registered its listener yet.
    if (!String(e).includes("Receiving end does not exist")) throw e;
    await new Promise((r) => setTimeout(r, 300));
    return chrome.runtime.sendMessage(req);
  }
}

const deps: TriageDeps = {
  local: modelClassifier(offscreenTextModel("on-device", sendOffscreen), "on-device"),
  cloud: modelClassifier(offscreenTextModel("cloud", sendOffscreen), "cloud"),
};

async function classifiers(): Promise<TriageDeps> {
  return deps;
}

// Create the document (and so start the Nano warm-up) as soon as the browser or the
// extension starts, not on the first checked page.
const warm = () => void ensureOffscreen().catch((err) => console.error("offscreen document failed", err));
chrome.runtime.onStartup.addListener(warm);
chrome.runtime.onInstalled.addListener(warm);

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
  if (msg?.type === "hpg/probe-offscreen" && sender.id === chrome.runtime.id && !sender.tab) {
    sendOffscreen({ target: "offscreen", type: "probe" })
      .then(sendResponse)
      .catch((err) => sendResponse({ error: String(err) }));
    return true;
  }
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
