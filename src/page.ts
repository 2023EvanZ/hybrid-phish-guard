// "This page" section of the side panel: shows the active tab's verdict (computed and
// stored by the background) and lets the user force a full inspection.
import { tabKey, verdictKey } from "./shared/messages.ts";
import type { HpgMessage, PrefilterReport, StoredVerdict, TrustReply } from "./shared/messages.ts";
import { MISTAKES_KEY, exportMistakes, localDate, makeMistake, mistakeHost, mistakeKind, parseMistakes, withMistake, withoutMistake } from "./shared/mistakes.ts";
import type { MistakeReport } from "./shared/mistakes.ts";
import { STATS_KEY, parseStats, statsView } from "./shared/stats.ts";
import { TRUSTED_KEY, mayTrust, parseTrusted, trustHost, withoutHost } from "./shared/trust.ts";
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
const trustBtn = $<HTMLButtonElement>("trust");
const untrustBtn = $<HTMLButtonElement>("untrust");
const trustedList = $<HTMLUListElement>("trusted-list");

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

/** Removes a trusted site. If it's the page open now, checks it, since its last check
 *  was skipped. */
async function removeTrusted(host: string, current: string | null) {
  const list = parseTrusted((await chrome.storage.local.get(TRUSTED_KEY))[TRUSTED_KEY]);
  await chrome.storage.local.set({ [TRUSTED_KEY]: withoutHost(list, host) });
  if (host === current) inspectBtn.click();
}

function showTrustedList(trusted: string[], current: string | null) {
  $("trusted-count").textContent = String(trusted.length);
  trustedList.replaceChildren(
    ...trusted.map((host) => {
      const li = el("li");
      const remove = el("button", "Remove");
      remove.setAttribute("aria-label", `Stop trusting ${host}`);
      remove.onclick = () => void removeTrusted(host, current);
      li.append(el("span", host), remove);
      return li;
    }),
  );
}

function showStats(value: unknown) {
  const stats = parseStats(value, new Date());
  const view = statsView(stats);
  $("s-headline").textContent = view.headline;
  $("s-detail").textContent = view.detail;
  resetBtn.hidden = stats.pages === 0;
}

// Two clicks instead of confirm() for anything that deletes: a native dialog from a side
// panel isn't something to rely on, and an inline second step is easier to see anyway.
function twoClick(btn: HTMLButtonElement, armedText: string, action: () => Promise<unknown>) {
  const label = btn.textContent ?? "";
  let armed: ReturnType<typeof setTimeout> | undefined;
  const disarm = () => {
    clearTimeout(armed);
    armed = undefined;
    btn.textContent = label;
  };
  btn.onclick = async () => {
    if (armed === undefined) {
      btn.textContent = armedText;
      armed = setTimeout(disarm, 4000);
      return;
    }
    disarm();
    await action();
  };
}

const resetBtn = $<HTMLButtonElement>("s-reset");
twoClick(resetBtn, "Click again to reset to zero", () => chrome.runtime.sendMessage({ type: "hpg/reset-stats" } satisfies HpgMessage));

const reportBtn = $<HTMLButtonElement>("report");
const reportStatus = $<HTMLParagraphElement>("report-status");
const mistakesList = $<HTMLUListElement>("mistakes-list");
const exportBtn = $<HTMLButtonElement>("mistakes-export");
const clearBtn = $<HTMLButtonElement>("mistakes-clear");

const KIND_TEXT = { "false-alarm": "False alarm", missed: "Missed scam" } as const;

async function readMistakes(): Promise<MistakeReport[]> {
  return parseMistakes((await chrome.storage.local.get(MISTAKES_KEY))[MISTAKES_KEY]);
}

function showMistakes(list: MistakeReport[]) {
  $("mistakes-count").textContent = String(list.length);
  mistakesList.replaceChildren(
    ...list.map((r) => {
      const li = el("li");
      const text = el("span", mistakeHost(r));
      text.append(el("span", `${KIND_TEXT[r.kind]} · ${new Date(r.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`, "m-kind"));
      const remove = el("button", "Remove");
      remove.setAttribute("aria-label", `Delete the report for ${mistakeHost(r)}`);
      remove.onclick = async () => void chrome.storage.local.set({ [MISTAKES_KEY]: withoutMistake(await readMistakes(), r.id) });
      li.append(text, remove);
      return li;
    }),
  );
  exportBtn.hidden = clearBtn.hidden = list.length === 0;
}

exportBtn.onclick = async () => {
  const now = new Date();
  const blob = new Blob([exportMistakes(await readMistakes(), now)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = el("a");
  a.href = url;
  a.download = `hpg-mistakes-${localDate(now)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
twoClick(clearBtn, "Click again to delete all", () => chrome.storage.local.set({ [MISTAKES_KEY]: [] }));

/** The verdict shown when the report button was drawn, so the report records what the
 *  user saw, even if the page is re-checked meanwhile. */
let shownVerdict: StoredVerdict | undefined;
/** The page the status line is about; it's cleared when the panel shows another page. */
let statusUrl: string | undefined;

reportBtn.onclick = async () => {
  const id = await activeTabId();
  if (id === undefined) return;
  const seen = shownVerdict;
  reportBtn.disabled = true;
  try {
    // Asks the page for its features without checking it, so reporting never sends
    // anything to the cloud.
    const features = (await chrome.tabs.sendMessage(id, { type: "hpg/features" } satisfies HpgMessage)) as PageFeatures | undefined;
    if (!features) throw new Error("no features");
    const report = makeMistake(features, seen?.triage ?? null, new Date(), crypto.randomUUID());
    await chrome.storage.local.set({ [MISTAKES_KEY]: withMistake(await readMistakes(), report) });
    statusUrl = features.url;
    reportStatus.textContent = `Saved as a ${report.kind === "missed" ? "missed scam" : "false alarm"}, on this device only. Nothing was sent.`;
  } catch {
    reportStatus.textContent = "Couldn't read this page. Reload it and try again.";
  } finally {
    reportBtn.disabled = false;
  }
};

function showReportButton(report: PrefilterReport | undefined, verdict: StoredVerdict | undefined, mistakes: MistakeReport[]) {
  shownVerdict = verdict;
  if (report?.url !== statusUrl) {
    reportStatus.textContent = "";
    statusUrl = report?.url;
  }
  if (!report) {
    reportBtn.hidden = true;
    reportStatus.textContent = "";
    return;
  }
  reportBtn.hidden = false;
  const kind = mistakeKind(verdict?.triage.final.verdict ?? null);
  reportBtn.textContent = kind === "false-alarm" ? "Report a mistake: this warning is wrong" : "Report a mistake: this page is a scam";
  const host = trustHost(report.url);
  const already = mistakes.some((m) => mistakeHost(m) === host && m.kind === kind);
  if (already && !reportStatus.textContent) reportStatus.textContent = `You've reported this site as a ${kind === "missed" ? "missed scam" : "false alarm"}.`;
}

function show(report: PrefilterReport | undefined, verdict: StoredVerdict | undefined, trusted: string[] = [], mistakes: MistakeReport[] = []) {
  showMistakes(mistakes);
  showReportButton(report, verdict, mistakes);
  featuresEl.textContent = report?.features ? JSON.stringify(report.features, null, 2) : "";
  showPrivacy(report?.features, verdict?.triage);
  const host = report ? trustHost(report.url) : null;
  showTrustedList(trusted, host);
  const isTrusted = host !== null && trusted.includes(host);
  trustBtn.hidden = !verdict || isTrusted || !mayTrust(verdict.triage);
  untrustBtn.hidden = !isTrusted;
  untrustBtn.onclick = host ? () => void removeTrusted(host, host) : null;
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
  } else if (isTrusted) {
    paint("neutral", "You trust this site", "It isn't checked automatically. Use \"Check this page now\" to check it anyway.");
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
  const keys = [TRUSTED_KEY, STATS_KEY, MISTAKES_KEY];
  if (id === undefined) {
    const local = await chrome.storage.local.get(keys);
    showStats(local[STATS_KEY]);
    return show(undefined, undefined, parseTrusted(local[TRUSTED_KEY]), parseMistakes(local[MISTAKES_KEY]));
  }
  const [stored, local] = await Promise.all([chrome.storage.session.get([tabKey(id), verdictKey(id)]), chrome.storage.local.get(keys)]);
  if (seq !== renderSeq) return; // a newer render started meanwhile
  showStats(local[STATS_KEY]);
  show(stored[tabKey(id)] as PrefilterReport | undefined, stored[verdictKey(id)] as StoredVerdict | undefined, parseTrusted(local[TRUSTED_KEY]), parseMistakes(local[MISTAKES_KEY]));
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

trustBtn.onclick = async () => {
  const id = await activeTabId();
  if (id === undefined) return;
  trustBtn.disabled = true;
  try {
    // The background checks the verdict is "suspicious" and the site matches before saving.
    const reply = (await chrome.runtime.sendMessage({ type: "hpg/trust-tab", tabId: id } satisfies HpgMessage)) as TrustReply | undefined;
    if (!reply?.host) statusEl.textContent = "Couldn't trust this site.";
  } finally {
    trustBtn.disabled = false;
    await render();
  }
};

chrome.storage.local.onChanged.addListener(() => void render());
chrome.tabs.onActivated.addListener(() => void render());
chrome.tabs.onUpdated.addListener((_id, info) => {
  if (info.status === "complete") void render();
});
chrome.storage.session.onChanged.addListener(() => void render());
void render();
