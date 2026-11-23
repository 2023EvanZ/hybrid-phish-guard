// "This page" section of the side panel: shows the active tab's verdict (computed and
// stored by the background) and lets the user force a full inspection.
import { tabKey, verdictKey } from "./shared/messages.ts";
import type { HpgMessage, PrefilterReport, StoredVerdict } from "./shared/messages.ts";
import { provenanceNote, verdictView } from "./triage/present.ts";
import type { Tone } from "./triage/present.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const card = $<HTMLElement>("verdict");
const headlineEl = $<HTMLHeadingElement>("v-headline");
const detailEl = $<HTMLParagraphElement>("v-detail");
const reasonsEl = $<HTMLUListElement>("v-reasons");
const noteEl = $<HTMLParagraphElement>("v-note");
const statusEl = $<HTMLParagraphElement>("page-status");
const featuresEl = $<HTMLPreElement>("page-features");
const inspectBtn = $<HTMLButtonElement>("inspect");

function paint(tone: Tone, headline: string, detail: string, reasons: string[] = [], note: string | null = null) {
  card.dataset.tone = tone;
  headlineEl.textContent = headline;
  detailEl.textContent = detail;
  reasonsEl.replaceChildren(
    ...reasons.map((r) => {
      const li = document.createElement("li");
      li.textContent = r;
      return li;
    }),
  );
  noteEl.textContent = note ?? "";
}

function skipText(report: PrefilterReport): string {
  if (report.prefilter.reasons.includes("allowlisted")) return "A well-known site, so it isn't checked automatically.";
  return "No login or payment form, and nothing unusual in the address or text.";
}

function show(report: PrefilterReport | undefined, verdict: StoredVerdict | undefined) {
  featuresEl.textContent = report?.features ? JSON.stringify(report.features, null, 2) : "";
  if (!report) {
    paint("neutral", "No report for this tab", "It may not be a web page, or it was open before the extension loaded. Reload it to check.");
    statusEl.textContent = "";
    return;
  }
  const { score, reasons } = report.prefilter;
  statusEl.textContent = `Heuristic score ${score}${reasons.length ? `: ${reasons.join(", ")}` : ""}`;
  if (verdict) {
    const v = verdictView(verdict.triage);
    paint(v.tone, v.headline, v.detail + (verdict.manual ? " (checked on request)" : ""), v.reasons, provenanceNote(verdict.triage));
  } else if (report.features) {
    paint("neutral", "Checking…", "");
  } else {
    paint("neutral", "Not checked", skipText(report));
  }
}

async function activeTabId(): Promise<number | undefined> {
  // Needs no "tabs" permission: we only use the id, never the URL.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  const id = await activeTabId();
  if (id === undefined) return show(undefined, undefined);
  const stored = await chrome.storage.session.get([tabKey(id), verdictKey(id)]);
  if (seq !== renderSeq) return; // a newer render started meanwhile
  show(stored[tabKey(id)] as PrefilterReport | undefined, stored[verdictKey(id)] as StoredVerdict | undefined);
}

inspectBtn.onclick = async () => {
  const id = await activeTabId();
  if (id === undefined) return;
  inspectBtn.disabled = true;
  paint("neutral", "Checking…", "");
  try {
    // The content script routes the report through the background, which stores the
    // verdict; the storage listener below repaints.
    await chrome.tabs.sendMessage(id, { type: "hpg/inspect" } satisfies HpgMessage);
    await render();
  } catch {
    paint(
      "neutral",
      "Can't check this tab",
      "Chrome blocks extensions on chrome:// pages and the Web Store. For other pages opened before the extension loaded, reload the page.",
    );
  } finally {
    inspectBtn.disabled = false;
  }
};

chrome.tabs.onActivated.addListener(() => void render());
chrome.tabs.onUpdated.addListener((_id, info) => {
  if (info.status === "complete") void render();
});
chrome.storage.session.onChanged.addListener(() => void render());
void render();
