// Content script (top frame only). Runs the prefilter when the page settles, keeps
// watching for late-rendered login forms for a short window, and answers on-demand
// "inspect this page" requests from the side panel.
//
// Built separately as a classic IIFE script (vite.content.config.ts): content scripts
// cannot be ES modules.

import { buildFeatures, quickDecision } from "./content/extract.ts";
import type { HpgMessage, PrefilterReport } from "./shared/messages.ts";

const WATCH_MS = 15_000;
const DEBOUNCE_MS = 750;

let flagged = false;
let observer: MutationObserver | undefined;
let debounce: ReturnType<typeof setTimeout> | undefined;

function send(report: PrefilterReport) {
  const msg: HpgMessage = { type: "hpg/report", report };
  // Rejects when the extension was reloaded and this script is orphaned; nothing to do.
  chrome.runtime.sendMessage(msg).catch(() => {});
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
    send({ url: location.href, prefilter: features.prefilter, features });
  } else if (initial) {
    // Report the skip once so the side panel can say why the page wasn't checked.
    send({ url: location.href, prefilter: quick });
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
  sendResponse({ url: location.href, prefilter: features.prefilter, features } satisfies PrefilterReport);
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
