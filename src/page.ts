// "This page" section of the side panel: shows the prefilter report for the active tab
// and lets the user force a full inspection.
import { tabKey } from "./shared/messages.ts";
import type { HpgMessage, PrefilterReport } from "./shared/messages.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const statusEl = $<HTMLParagraphElement>("page-status");
const featuresEl = $<HTMLPreElement>("page-features");

async function activeTabId(): Promise<number | undefined> {
  // Needs no "tabs" permission: we only use the id, never the URL.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

function show(report: PrefilterReport | undefined, source: "auto" | "manual") {
  if (!report) {
    statusEl.textContent =
      "No report for this tab yet. It may not be a web page, or it was open before the extension loaded (reload it).";
    featuresEl.textContent = "";
    return;
  }
  const { shouldCheck, score, reasons } = report.prefilter;
  const why = reasons.length ? reasons.join(", ") : "no sensitive form or risky URL";
  statusEl.textContent =
    source === "manual"
      ? `Manual inspection (score ${score}): ${why}`
      : shouldCheck
        ? `Flagged for checking (score ${score}): ${why}`
        : `Skipped: ${why}`;
  featuresEl.textContent = report.features ? JSON.stringify(report.features, null, 2) : "";
}

async function render() {
  const id = await activeTabId();
  if (id === undefined) return show(undefined, "auto");
  const key = tabKey(id);
  const stored = await chrome.storage.session.get(key);
  show(stored[key] as PrefilterReport | undefined, "auto");
}

$("inspect").onclick = async () => {
  const id = await activeTabId();
  if (id === undefined) return;
  try {
    const msg: HpgMessage = { type: "hpg/inspect" };
    show((await chrome.tabs.sendMessage(id, msg)) as PrefilterReport, "manual");
  } catch {
    statusEl.textContent =
      "Can't inspect this tab. Chrome blocks extensions on chrome:// pages and the Web Store; for other pages opened before the extension loaded, reload the page.";
    featuresEl.textContent = "";
  }
};

chrome.tabs.onActivated.addListener(() => void render());
chrome.tabs.onUpdated.addListener((_id, info) => {
  if (info.status === "complete") void render();
});
chrome.storage.session.onChanged.addListener(() => void render());
void render();
