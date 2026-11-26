// "This page" section of the side panel: shows the active tab's verdict (computed and
// stored by the background) and lets the user force a full inspection.
import { tabKey, verdictKey } from "./shared/messages.ts";
import type { HpgMessage, PrefilterReport, StoredVerdict } from "./shared/messages.ts";
import { provenanceNote, verdictView } from "./triage/present.ts";
import { NEVER_SENT, REDACTION_GAPS, SENT_SUMMARY, privacyView } from "./triage/privacy.ts";
import type { TriageReport } from "./triage/pipeline.ts";
import type { PageFeatures } from "./shared/messages.ts";
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
const privacyEl = $<HTMLElement>("privacy");

/** Builds an element with text content only: page-derived strings never go through innerHTML. */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = "", className = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

$<HTMLUListElement>("p-never").replaceChildren(...NEVER_SENT.map((line) => el("li", line)));
$<HTMLParagraphElement>("p-sent-summary").textContent = SENT_SUMMARY;
$<HTMLParagraphElement>("p-gaps").textContent = REDACTION_GAPS;

function showPrivacy(features: PageFeatures | undefined, report: TriageReport | undefined) {
  if (!features || !report) {
    privacyEl.hidden = true;
    return;
  }
  const view = privacyView(features, report);
  privacyEl.hidden = false;
  privacyEl.dataset.left = String(view.leftDevice);
  $("p-headline").textContent = view.headline;
  $("p-why").textContent = view.why;
  $("p-steps").replaceChildren(
    ...view.steps.map((step) => {
      const li = el("li");
      li.dataset.ran = String(step.ran);
      const chip = el("span", step.where === "device" ? "This device" : "Cloud", "chip");
      chip.dataset.where = step.where;
      li.append(el("span", step.name, "s-name"), chip, el("span", step.result, "s-result"));
      return li;
    }),
  );
  const sentEl = $<HTMLDetailsElement>("p-sent");
  sentEl.hidden = !view.sent;
  if (!view.sent) return;
  $("p-redactions").replaceChildren(
    ...view.sent.redactions.flatMap((r) => {
      const onPage = el("dd");
      onPage.append(el("span", "On the page: "), r.onPage);
      const sent = el("dd");
      sent.append(el("span", "Sent: "), r.sent);
      return [el("dt", r.field), onPage, sent];
    }),
  );
  $("p-removed").textContent = view.sent.removedFromText
    ? `Replaced in the page text: ${view.sent.removedFromText}.`
    : "No email addresses, long numbers or greeting names were found in the page text.";
  $("p-prompt").textContent = view.sent.prompt;
}

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
  showPrivacy(report?.features, verdict?.triage);
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
