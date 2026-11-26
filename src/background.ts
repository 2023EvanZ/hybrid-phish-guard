// Service worker: opens the side panel, triages each checked page, and keeps every tab's
// latest prefilter report and verdict in session storage (cleared when the browser
// closes). The content script gets the verdict back as the reply to its report, so a
// verdict can only ever reach the document that asked for it.
//
// Models: Chrome's Prompt API is unavailable in workers, so both Firebase models live in
// an offscreen document (src/offscreen.ts). The pipeline here still owns prompt building,
// redaction and parsing; the offscreen document only turns prompts into text.
import { verdictKey, tabKey } from "./shared/messages.ts";
import type { ExplainReply, GenerateReply, HpgMessage, OffscreenRequest, PrefilterReport, ReportReply, StoredVerdict } from "./shared/messages.ts";
import { modelClassifier } from "./triage/model.ts";
import { parseReasons } from "./triage/parse.ts";
import { triage } from "./triage/pipeline.ts";
import type { TriageDeps } from "./triage/pipeline.ts";
import { badgeFor } from "./triage/present.ts";
import { buildExplainPrompt } from "./triage/prompt.ts";
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

// Nano answers without reasons, so it finishes sooner (see triage/prompt.ts).
const NANO_PROMPT = { reasons: false };

const deps: TriageDeps = {
  local: modelClassifier(offscreenTextModel("on-device", sendOffscreen), "on-device", undefined, NANO_PROMPT),
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

/** Gemini Nano's reasons for the on-device verdict stored for this tab. On-device only:
 *  the prompt carries the unredacted page. */
async function explain(tabId: number): Promise<ExplainReply> {
  const stored = await chrome.storage.session.get([tabKey(tabId), verdictKey(tabId)]);
  const report = stored[tabKey(tabId)] as PrefilterReport | undefined;
  const verdict = stored[verdictKey(tabId)] as StoredVerdict | undefined;
  if (!report?.features || verdict?.triage.final.source !== "on-device") return { reasons: null };
  const reply = await sendOffscreen({ target: "offscreen", type: "explain", prompt: buildExplainPrompt(report.features, verdict.triage.final.verdict) });
  const r = reply as GenerateReply | undefined;
  if (!r?.ok) return { reasons: null };
  const reasons = parseReasons(r.text);
  return { reasons: reasons.length ? reasons : null };
}

/** Our own extension pages (side panel, eval page), as opposed to content scripts,
 *  which share our extension id but report the web page's URL. */
const isExtensionPage = (sender: chrome.runtime.MessageSender) =>
  sender.id === chrome.runtime.id && Boolean(sender.url?.startsWith(chrome.runtime.getURL("")));

chrome.runtime.onMessage.addListener((msg: HpgMessage, sender, sendResponse) => {
  if ((msg?.type === "hpg/probe-offscreen" || msg?.type === "hpg/model") && isExtensionPage(sender)) {
    const req: OffscreenRequest = msg.type === "hpg/model" ? msg.req : { target: "offscreen", type: "probe" };
    sendOffscreen(req)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
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
  if (msg.type === "hpg/explain") {
    explain(tabId).then(sendResponse, (err) => {
      console.warn("explanation failed", err);
      sendResponse({ reasons: null } satisfies ExplainReply);
    });
    return true;
  }
  if (msg.type === "hpg/open-panel") {
    // sidePanel.open() only works during a user gesture. Called synchronously here, in
    // the handler for a click in the page, before any await. If Chrome doesn't count
    // that as a gesture, the notice tells the user to use the toolbar icon instead.
    chrome.sidePanel.open({ tabId }).then(
      () => sendResponse({ opened: true }),
      (err) => {
        console.warn("couldn't open the side panel from the page", err);
        sendResponse({ opened: false });
      },
    );
    return true;
  }
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
