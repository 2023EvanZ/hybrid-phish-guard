// Content script (top frame only). Runs the prefilter when the page settles, keeps
// watching for late-rendered login forms for a short window, answers on-demand
// "inspect this page" requests from the side panel, and shows the corner notice when the
// background's verdict calls for it.
//
// Built separately as a classic IIFE script (vite.content.config.ts): content scripts
// cannot be ES modules.

import { showNotice } from "./content/notice.ts";
import type { NoticeActions, NoticeContent, NoticeHandle } from "./content/notice.ts";
import { buildFeatures, quickDecision } from "./content/extract.ts";
import type { ExplainReply, HpgMessage, PrefilterReport, ReportReply, TrustReply } from "./shared/messages.ts";
import { NOTHING_SENT, adviceFor, pendingView, provenanceNote, showsNotice, verdictView, whereView } from "./triage/present.ts";
import { rulesVerdict } from "./triage/rules.ts";

const WATCH_MS = 15_000;
const DEBOUNCE_MS = 750;

let flagged = false;
let observer: MutationObserver | undefined;
let debounce: ReturnType<typeof setTimeout> | undefined;

let notice: NoticeHandle | undefined;

const actions: NoticeActions = {
  onLeave: () => void chrome.runtime.sendMessage({ type: "hpg/leave" } satisfies HpgMessage).catch(() => {}),
  onFullReport: () =>
    chrome.runtime
      .sendMessage({ type: "hpg/open-panel" } satisfies HpgMessage)
      .then((r: { opened?: boolean } | undefined) => Boolean(r?.opened), () => false),
  onExplain: () =>
    chrome.runtime
      .sendMessage({ type: "hpg/explain" } satisfies HpgMessage)
      .then((r: ExplainReply | undefined) => r?.reasons ?? null, () => null),
  onTrust: () =>
    chrome.runtime
      .sendMessage({ type: "hpg/trust" } satisfies HpgMessage)
      .then((r: TrustReply | undefined) => r?.host ?? null, () => null),
};

function present(content: NoticeContent) {
  // Once the user closes it, it stays closed for this page. If the page removed it, it
  // comes back.
  if (notice?.closedByUser) return;
  if (notice?.connected) notice.update(content);
  else notice = showNotice(document, content, actions);
}

async function send(report: PrefilterReport, manual = false): Promise<void> {
  if (manual && notice?.closedByUser) notice = undefined; // an explicit re-check may show it again
  // Instant warning: when the rules alone rate the page phishing (no false alarms on the
  // eval sets), show it now instead of after the ~3 s model check, then let the model's
  // verdict update or withdraw it.
  const rules = report.features ? rulesVerdict(report.features) : null;
  const instant = rules?.verdict === "phishing";
  if (instant) present({ view: pendingView(rules), advice: adviceFor(rules.verdict), note: null, pending: true });

  const msg: HpgMessage = { type: "hpg/report", report, manual };
  let reply: ReportReply | undefined;
  try {
    reply = await chrome.runtime.sendMessage(msg);
  } catch {
    return; // the extension was reloaded and this script is orphaned
  }
  const verdict = reply?.verdict;
  if (verdict && showsNotice(verdict)) {
    present({
      view: verdictView(verdict),
      advice: adviceFor(verdict.final.verdict),
      note: provenanceNote(verdict),
      explainable: verdict.final.source === "on-device",
      trustable: verdict.final.verdict === "suspicious",
      where: whereView(verdict),
    });
  } else if (verdict) {
    notice?.remove(); // the models found it safe: withdraw the instant warning
    notice = undefined;
  } else if (instant && reply?.trusted) {
    // Trust is only ever given to a "suspicious" site; a rules "phishing" there now means
    // the page changed (e.g. the site was hacked), so the warning stays.
    present({ view: pendingView(rules), advice: adviceFor(rules.verdict), note: "You trust this site, so the AI check was skipped, but the rule-based check rates it phishing.", where: NOTHING_SENT });
  } else if (instant) {
    // Triage failed outright: keep the rules verdict, but stop saying it's being checked.
    present({ view: pendingView(rules), advice: adviceFor(rules.verdict), note: "The AI check didn't finish, so this is the rule-based verdict." });
  }
}

function evaluate(initial: boolean) {
  if (flagged) return;
  const quick = quickDecision(document, location.href);
  if (quick.shouldCheck) {
    flagged = true;
    stopWatching();
    // Forced: the gate already passed. The full read uses innerText, which drops hidden
    // text the quick gate may have matched, and must not undo that decision.
    const features = buildFeatures(document, location.href, { force: true });
    void send({ url: location.href, prefilter: features.prefilter, features });
  } else if (initial) {
    // Report the skip once so the side panel can say why the page wasn't checked.
    void send({ url: location.href, prefilter: quick });
  }
}

function stopWatching() {
  observer?.disconnect();
  observer = undefined;
  clearTimeout(debounce);
}

function start() {
  evaluate(true);
  if (flagged || !document.body) return;
  observer = new MutationObserver(() => {
    clearTimeout(debounce);
    debounce = setTimeout(() => evaluate(false), DEBOUNCE_MS);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(stopWatching, WATCH_MS);
}

chrome.runtime.onMessage.addListener((msg: HpgMessage, _sender, sendResponse) => {
  if (msg.type !== "hpg/inspect") return;
  const features = buildFeatures(document, location.href, { force: true });
  const report: PrefilterReport = { url: location.href, prefilter: features.prefilter, features };
  // Through the background like any other report, so the verdict is stored for the
  // panel and the notice appears if there's something to show.
  void send(report, true).finally(() => sendResponse(report));
  return true; // async reply
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
