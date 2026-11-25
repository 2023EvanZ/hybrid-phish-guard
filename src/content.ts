// Content script (top frame only). Runs the prefilter when the page settles, keeps
// watching for late-rendered login forms for a short window, answers on-demand
// "inspect this page" requests from the side panel, and shows the corner notice when the
// background's verdict calls for it.
//
// Built separately as a classic IIFE script (vite.content.config.ts): content scripts
// cannot be ES modules.

import { showNotice } from "./content/notice.ts";
import { buildFeatures, quickDecision } from "./content/extract.ts";
import type { HpgMessage, PrefilterReport, ReportReply } from "./shared/messages.ts";
import { adviceFor, provenanceNote, showsNotice, verdictView } from "./triage/present.ts";

const WATCH_MS = 15_000;
const DEBOUNCE_MS = 750;

let flagged = false;
let observer: MutationObserver | undefined;
let debounce: ReturnType<typeof setTimeout> | undefined;

async function send(report: PrefilterReport, manual = false): Promise<void> {
  const msg: HpgMessage = { type: "hpg/report", report, manual };
  let reply: ReportReply | undefined;
  try {
    reply = await chrome.runtime.sendMessage(msg);
  } catch {
    return; // the extension was reloaded and this script is orphaned
  }
  const verdict = reply?.verdict;
  if (verdict && showsNotice(verdict)) {
    const content = { view: verdictView(verdict), advice: adviceFor(verdict), note: provenanceNote(verdict) };
    showNotice(document, content, {
      onLeave: () => void chrome.runtime.sendMessage({ type: "hpg/leave" } satisfies HpgMessage).catch(() => {}),
      onFullReport: () =>
        chrome.runtime
          .sendMessage({ type: "hpg/open-panel" } satisfies HpgMessage)
          .then((r: { opened?: boolean } | undefined) => Boolean(r?.opened), () => false),
    });
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
