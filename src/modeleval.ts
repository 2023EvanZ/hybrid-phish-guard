// Model eval page (opened from the side panel diagnostics). Drives eval/models.ts with the
// real models, reached through the background, which owns the offscreen document.
import { caseFeatures } from "../eval/case.ts";
import { HELDOUT_CASES } from "../eval/cases/heldout.ts";
import { ALL_CASES } from "../eval/cases/index.ts";
import { lenient } from "../eval/metrics.ts";
import type { Confusion } from "../eval/metrics.ts";
import { isRateLimit, report, runCase, SYSTEMS, withRetry } from "../eval/models.ts";
import type { Attempt, CaseRun, ModelStats } from "../eval/models.ts";
import type { HpgMessage, ModelMode, OffscreenRequest } from "./shared/messages.ts";
import { modelClassifier } from "./triage/model.ts";
import type { Classifier } from "./triage/types.ts";
import { offscreenTextModel } from "./triage/remote.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const useLocal = $<HTMLInputElement>("use-local");
const useCloud = $<HTMLInputElement>("use-cloud");
const runBtn = $<HTMLButtonElement>("run");
const stopBtn = $<HTMLButtonElement>("stop");
const downloadBtn = $<HTMLButtonElement>("download");
const progressEl = $<HTMLSpanElement>("progress");
const logEl = $<HTMLPreElement>("log");

const log = (msg: string) => {
  logEl.textContent += `${new Date().toLocaleTimeString()}  ${msg}\n`;
  logEl.scrollTop = logEl.scrollHeight;
};

const send = (req: OffscreenRequest) => chrome.runtime.sendMessage({ type: "hpg/model", req } satisfies HpgMessage);
// Same prompts as production: Nano answers without reasons (see triage/prompt.ts).
const classifier = (mode: ModelMode) =>
  modelClassifier(offscreenTextModel(mode, send), mode, undefined, mode === "on-device" ? { reasons: false } : {});

// Dev cases first, then the held-out cases, which are scored separately: the dev set
// has been tuned against, the held-out set hasn't (see eval/cases/heldout.ts).
const CASES = [...ALL_CASES, ...HELDOUT_CASES];
const HELDOUT_IDS = new Set(HELDOUT_CASES.map((c) => c.id));
const isHeldout = (r: CaseRun) => HELDOUT_IDS.has(r.id);

const checkedCount = CASES.filter((c) => caseFeatures(c).prefilter.shouldCheck).length;
$("plan").textContent =
  `${ALL_CASES.length} dev cases + ${HELDOUT_CASES.length} held-out cases; ${checkedCount} pass the prefilter gate, so up to ${checkedCount} calls per model. ` +
  "Cases run one at a time; cloud rate limits are retried after 30 s.";

// ---------- rendering ----------

const pct = (x: number | null | undefined) => (x === null || x === undefined ? "n/a" : `${(x * 100).toFixed(1)}%`);
const ms = (x: number | null) => (x === null ? "n/a" : `${Math.round(x)} ms`);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text; // textContent only: cells can hold model output
  if (cls) e.className = cls;
  return e;
}

function table(target: HTMLTableElement, head: string[], rows: Array<Array<string | { text: string; cls: string }>>, numeric = new Set<number>()) {
  const thead = el("thead");
  const hr = el("tr");
  head.forEach((h, i) => hr.append(el("th", h, numeric.has(i) ? "num" : undefined)));
  thead.append(hr);
  const tbody = el("tbody");
  for (const row of rows) {
    const tr = el("tr");
    row.forEach((cell, i) => {
      const { text, cls } = typeof cell === "string" ? { text: cell, cls: "" } : cell;
      tr.append(el("td", text, [numeric.has(i) ? "num" : "", cls].filter(Boolean).join(" ") || undefined));
    });
    tbody.append(tr);
  }
  target.replaceChildren(thead, tbody);
}

const SYSTEM_LABEL = { rules: "Rules only", "on-device": "Gemini Nano (on-device)", cloud: "Gemini (cloud, redacted)", hybrid: "Hybrid (what users see)" };

function cellFor(a: Attempt | null, label: CaseRun["label"]) {
  if (!a) return "—";
  if (!a.ok) return { text: `error: ${a.error.slice(0, 60)}`, cls: label === "phishing" ? "bad" : "" };
  const r = a.result;
  const wrong = lenient(r.verdict) !== (label === "phishing");
  return { text: `${r.verdict} ${Math.round(r.confidence * 100)}% · ${r.latencyMs} ms`, cls: wrong ? "bad" : "" };
}

const conf = (c: Confusion) => [pct(c.precision), pct(c.recall), pct(c.f1), pct(c.falsePositiveRate)];

function scoresTable(target: HTMLTableElement, rep: ReturnType<typeof report>) {
  table(
    target,
    ["System", "Precision", "Recall", "F1", "False alarms", "Strict precision", "Strict recall", "TP / FP / FN / TN (lenient)"],
    SYSTEMS.flatMap((s) => {
      const sum = rep.systems[s];
      if (!sum) return [];
      const l = sum.lenient;
      return [[SYSTEM_LABEL[s], ...conf(l), pct(sum.strict.precision), pct(sum.strict.recall), `${l.tp} / ${l.fp} / ${l.fn} / ${l.tn}`]];
    }),
    new Set([1, 2, 3, 4, 5, 6]),
  );
}

const fmt = (o: Record<string, number>) => Object.entries(o).map(([k, v]) => `${k} ${v}`).join(", ") || "none";
const hybridLines = (name: string, h: ReturnType<typeof report>["hybrid"]) => [
  el("p", `${name}: sent to the cloud ${pct(h.escalationRate)} of ${h.checked} checked pages. Escalation decisions: ${fmt(h.reasons)}. Final verdict came from: ${fmt(h.finalSource)}.`),
  el(
    "p",
    `${name}: model time to the final verdict: median ${ms(h.verdictMs.median)}, p90 ${ms(h.verdictMs.p90)}, max ${ms(h.verdictMs.max)}. ` +
      `${h.instantWarnings} of ${h.checked} pages get an instant warning from the rules before any model answers.`,
  ),
];

function render(runs: CaseRun[]) {
  $("results").hidden = runs.length === 0;
  const dev = runs.filter((r) => !isHeldout(r));
  const held = runs.filter(isHeldout);
  const rep = report(runs); // model stats (latency, failures) over every call
  const devRep = report(dev);
  const heldRep = report(held);

  scoresTable($("scores"), devRep);
  $("heldout-section").hidden = held.length === 0;
  if (held.length) scoresTable($("heldout-scores"), heldRep);

  $("hybrid").replaceChildren(...hybridLines("Dev cases", devRep.hybrid), ...(held.length ? hybridLines("Held-out cases", heldRep.hybrid) : []));

  const row = (name: string, s: ModelStats | null) =>
    s ? [name, String(s.calls), String(s.failures), ms(s.meanLatencyMs), ms(s.maxLatencyMs), pct(s.meanConfidenceRight), pct(s.meanConfidenceWrong)] : [];
  table(
    $("models"),
    ["Model", "Calls", "Failed", "Mean latency", "Max latency", "Mean confidence when right", "when wrong"],
    [row("On-device", rep.local), row("Cloud", rep.cloud)].filter((r) => r.length),
    new Set([1, 2, 3, 4, 5, 6]),
  );

  const errs = [...(rep.local?.errors.map((e) => ({ ...e, m: "on-device" })) ?? []), ...(rep.cloud?.errors.map((e) => ({ ...e, m: "cloud" })) ?? [])];
  $("errors").replaceChildren(...(errs.length ? [el("pre", errs.map((e) => `${e.m} ×${e.count}: ${e.error}`).join("\n"))] : []));

  table(
    $("cases"),
    ["Case", "Set", "Label", "Gate score", "Rules", "On-device", "Cloud", "Hybrid"],
    runs.map((r) => {
      const set = isHeldout(r) ? "held-out" : "dev";
      if (!r.checked) return [r.id, set, r.label, String(r.score), "skipped", "—", "—", { text: "not checked", cls: r.label === "phishing" ? "bad" : "" }];
      const rules = r.rules!;
      const hyb = r.hybrid!.final;
      return [
        r.id,
        set,
        r.label,
        String(r.score),
        { text: `${rules.verdict}`, cls: lenient(rules.verdict) !== (r.label === "phishing") ? "bad" : "" },
        cellFor(r.local, r.label),
        cellFor(r.cloud, r.label),
        { text: `${hyb.verdict} (${hyb.source})`, cls: lenient(hyb.verdict) !== (r.label === "phishing") ? "bad" : "" },
      ];
    }),
    new Set([3]),
  );
}

// ---------- running ----------

let runs: CaseRun[] = [];
let stopRequested = false;
let startedAt = "";

function withRateLimitRetry(c: Classifier): Classifier {
  return {
    source: c.source,
    classify: (f) =>
      withRetry(() => c.classify(f), {
        retries: 3,
        delayMs: 30_000,
        isRetryable: isRateLimit,
        onRetry: (e, n) => log(`${c.source}: rate limited, retry ${n}/3 in 30 s (${String(e).slice(0, 120)})`),
      }),
  };
}

runBtn.onclick = async () => {
  const local = useLocal.checked ? classifier("on-device") : undefined;
  const cloud = useCloud.checked ? withRateLimitRetry(classifier("cloud")) : undefined;
  if (!local && !cloud) return log("Pick at least one model.");

  runs = [];
  stopRequested = false;
  startedAt = new Date().toISOString();
  logEl.textContent = "";
  runBtn.disabled = useLocal.disabled = useCloud.disabled = true;
  stopBtn.disabled = false;
  downloadBtn.disabled = true;
  render(runs);

  try {
    if (local) {
      // Nano's first call after Chrome loads it takes 8-16 s. Pay that before timing
      // anything, or the first case would look like a timeout.
      progressEl.textContent = "Warming up Gemini Nano...";
      const t0 = performance.now();
      try {
        await send({ target: "offscreen", type: "generate", mode: "on-device", prompt: "Reply with the single word OK." });
        log(`warm-up: ${Math.round(performance.now() - t0)} ms`);
      } catch (e) {
        log(`warm-up failed: ${String(e)}`);
      }
    }
    for (const [i, c] of CASES.entries()) {
      if (stopRequested) {
        log(`Stopped after ${runs.length} of ${CASES.length} cases; scores cover those only.`);
        break;
      }
      progressEl.textContent = `${i + 1} / ${CASES.length}  ${c.id}`;
      runs.push(await runCase(c, { local, cloud }));
      render(runs);
    }
    if (!stopRequested) progressEl.textContent = `Done: ${runs.length} cases.`;
  } catch (e) {
    log(`Run failed: ${String(e)}`);
  } finally {
    runBtn.disabled = useLocal.disabled = useCloud.disabled = false;
    stopBtn.disabled = true;
    downloadBtn.disabled = runs.length === 0;
  }
};

stopBtn.onclick = () => {
  stopRequested = true;
  stopBtn.disabled = true;
  progressEl.textContent += "  (stopping after this case)";
};

downloadBtn.onclick = () => {
  const data = {
    startedAt,
    models: { onDevice: useLocal.checked, cloud: useCloud.checked },
    userAgent: navigator.userAgent,
    // report: dev cases only, comparable with earlier runs. heldoutReport: held-out cases.
    report: report(runs.filter((r) => !isHeldout(r))),
    heldoutReport: report(runs.filter(isHeldout)),
    heldoutIds: [...HELDOUT_IDS],
    runs,
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = el("a");
  a.href = url;
  a.download = `model-eval-${startedAt.replace(/[:.]/g, "-")}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};
