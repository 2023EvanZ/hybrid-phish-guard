// Model eval: scores the real classifiers (Gemini Nano on-device, Gemini in the cloud)
// and the full hybrid pipeline on the labeled cases. Pure apart from the classifiers it
// is given, so it runs under node:test with fakes and inside the extension with the real
// models (eval page, src/modeleval.ts).
//
// Each checked case costs at most one on-device call and one cloud call. The hybrid
// verdict is then computed by replaying those two results through the real triage
// pipeline, so it reflects exactly what the extension would have decided, without
// paying for a third call.

import { DEFAULT_LOCAL_TIMEOUT_MS, triage } from "../src/triage/pipeline.ts";
import type { TriageReport } from "../src/triage/pipeline.ts";
import { redactFeatures } from "../src/triage/redact.ts";
import { rulesVerdict } from "../src/triage/rules.ts";
import type { Classifier, TriageResult } from "../src/triage/types.ts";
import { caseFeatures } from "./case.ts";
import type { EvalCase, Label } from "./case.ts";
import { lenient, summarize } from "./metrics.ts";
import type { EvalSummary, Outcome, Prediction } from "./metrics.ts";

export type Attempt = { ok: true; result: TriageResult } | { ok: false; error: string };

export interface CaseRun {
  id: string;
  category: string;
  label: Label;
  score: number;
  /** false = the prefilter gate skipped the page; no classifier ran. */
  checked: boolean;
  rules: TriageResult | null;
  local: Attempt | null;
  /** Cloud model on the redacted page, run on every checked case for comparison. */
  cloud: Attempt | null;
  /** What the extension would have shown, replayed from `local` and `cloud`. */
  hybrid: TriageReport | null;
}

export type SystemName = "rules" | "on-device" | "cloud" | "hybrid";
export const SYSTEMS: SystemName[] = ["rules", "on-device", "cloud", "hybrid"];

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function attempt(p: () => Promise<TriageResult>): Promise<Attempt> {
  try {
    return { ok: true, result: await p() };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/** A classifier that replays a recorded attempt instead of calling a model. */
function replay(source: "on-device" | "cloud", a: Attempt | null, timeoutMs?: number): Classifier | undefined {
  if (!a) return undefined;
  return {
    source,
    async classify() {
      if (!a.ok) throw new Error(a.error);
      // The extension stops waiting for the local model after the timeout; a slower
      // recorded answer would never have been used.
      if (timeoutMs !== undefined && a.result.latencyMs > timeoutMs) {
        throw new Error(`on-device model timed out after ${timeoutMs} ms`);
      }
      return a.result;
    },
  };
}

export interface RunOptions {
  local?: Classifier;
  cloud?: Classifier;
  localTimeoutMs?: number;
}

export async function runCase(c: EvalCase, opts: RunOptions): Promise<CaseRun> {
  const features = caseFeatures(c);
  const base = { id: c.id, category: c.category, label: c.label, score: features.prefilter.score };
  if (!features.prefilter.shouldCheck) {
    return { ...base, checked: false, rules: null, local: null, cloud: null, hybrid: null };
  }
  const local = opts.local ? await attempt(() => opts.local!.classify(features)) : null;
  // Same privacy boundary as production: the cloud only ever sees redacted features.
  const cloud = opts.cloud ? await attempt(() => opts.cloud!.classify(redactFeatures(features))) : null;
  const hybrid = await triage(features, {
    local: replay("on-device", local, opts.localTimeoutMs ?? DEFAULT_LOCAL_TIMEOUT_MS),
    cloud: replay("cloud", cloud),
  });
  return { ...base, checked: true, rules: rulesVerdict(features), local, cloud, hybrid };
}

/**
 * One system's prediction for a run. A failed model call counts as no warning ("safe"):
 * that's what the user would get from that model alone. Returns null when the system
 * wasn't run at all, so it's left out instead of scored as all-safe.
 */
export function predictionFor(run: CaseRun, system: SystemName): Prediction | null {
  if (!run.checked) return "unchecked";
  switch (system) {
    case "rules":
      return run.rules!.verdict;
    case "on-device":
    case "cloud": {
      const a = system === "on-device" ? run.local : run.cloud;
      if (!a) return null;
      return a.ok ? a.result.verdict : "safe";
    }
    case "hybrid":
      return run.hybrid!.final.verdict;
  }
}

export function outcomesFor(runs: CaseRun[], system: SystemName): Outcome[] | null {
  const outcomes: Outcome[] = [];
  for (const r of runs) {
    const prediction = predictionFor(r, system);
    if (prediction === null) return null;
    outcomes.push({ id: r.id, category: r.category, label: r.label, prediction, score: r.score });
  }
  return outcomes;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export interface ModelStats {
  calls: number;
  failures: number;
  /** Distinct error messages with counts, most common first. */
  errors: Array<{ error: string; count: number }>;
  meanLatencyMs: number | null;
  maxLatencyMs: number | null;
  /** Mean stated confidence when the verdict was right / wrong (lenient). A model whose
   *  confidence doesn't drop when it's wrong can't be trusted to decide escalation. */
  meanConfidenceRight: number | null;
  meanConfidenceWrong: number | null;
}

export function modelStats(runs: CaseRun[], which: "local" | "cloud"): ModelStats | null {
  const attempts = runs.flatMap((r) => (r[which] ? [{ a: r[which]!, label: r.label }] : []));
  if (!attempts.length) return null;
  const oks = attempts.flatMap(({ a, label }) => (a.ok ? [{ res: a.result, label }] : []));
  const counts = new Map<string, number>();
  for (const { a } of attempts) if (!a.ok) counts.set(a.error, (counts.get(a.error) ?? 0) + 1);
  const right = oks.filter(({ res, label }) => lenient(res.verdict) === (label === "phishing"));
  const wrong = oks.filter(({ res, label }) => lenient(res.verdict) !== (label === "phishing"));
  const lat = oks.map(({ res }) => res.latencyMs);
  return {
    calls: attempts.length,
    failures: attempts.length - oks.length,
    errors: [...counts].map(([error, count]) => ({ error, count })).sort((a, b) => b.count - a.count),
    meanLatencyMs: mean(lat),
    maxLatencyMs: lat.length ? Math.max(...lat) : null,
    meanConfidenceRight: mean(right.map(({ res }) => res.confidence)),
    meanConfidenceWrong: mean(wrong.map(({ res }) => res.confidence)),
  };
}

export interface HybridStats {
  checked: number;
  /** Share of checked pages the hybrid pipeline sent to the cloud. */
  escalationRate: number | null;
  /** Escalation reasons with counts. */
  reasons: Record<string, number>;
  /** Where the final verdicts came from. */
  finalSource: Record<string, number>;
  /**
   * Model time until the final verdict, per checked page: the on-device call, plus the
   * cloud call when the page escalated. Excludes page load and messaging. Pages whose
   * timed calls all failed are left out.
   */
  verdictMs: { median: number | null; p90: number | null; max: number | null };
  /** Pages the rules alone rate "phishing": the extension warns on these at once,
   *  before any model answers. */
  instantWarnings: number;
}

/** Model time spent before the hybrid verdict was final (see HybridStats.verdictMs). */
export function verdictMs(h: TriageReport): number | null {
  const local = h.local?.latencyMs ?? null;
  if (!h.escalation.escalate) return local;
  const cloud = h.cloud?.latencyMs ?? null;
  if (local === null && cloud === null) return null;
  return (local ?? 0) + (cloud ?? 0);
}

const quantile = (xs: number[], q: number) => (xs.length ? xs[Math.min(xs.length - 1, Math.floor(q * xs.length))] : null);

export function hybridStats(runs: CaseRun[]): HybridStats {
  const checked = runs.filter((r) => r.hybrid);
  const reasons: Record<string, number> = {};
  const finalSource: Record<string, number> = {};
  let escalated = 0;
  for (const r of checked) {
    const h = r.hybrid!;
    if (h.escalation.escalate) escalated++;
    reasons[h.escalation.reason] = (reasons[h.escalation.reason] ?? 0) + 1;
    finalSource[h.final.source] = (finalSource[h.final.source] ?? 0) + 1;
  }
  const times = checked.map((r) => verdictMs(r.hybrid!)).filter((t): t is number => t !== null).sort((a, b) => a - b);
  return {
    checked: checked.length,
    escalationRate: checked.length ? escalated / checked.length : null,
    reasons,
    finalSource,
    verdictMs: { median: quantile(times, 0.5), p90: quantile(times, 0.9), max: times.at(-1) ?? null },
    instantWarnings: checked.filter((r) => r.rules?.verdict === "phishing").length,
  };
}

export interface ModelEvalReport {
  systems: Partial<Record<SystemName, EvalSummary>>;
  local: ModelStats | null;
  cloud: ModelStats | null;
  hybrid: HybridStats;
}

export function report(runs: CaseRun[]): ModelEvalReport {
  const systems: Partial<Record<SystemName, EvalSummary>> = {};
  for (const s of SYSTEMS) {
    const o = outcomesFor(runs, s);
    if (o) systems[s] = summarize(o);
  }
  return { systems, local: modelStats(runs, "local"), cloud: modelStats(runs, "cloud"), hybrid: hybridStats(runs) };
}

/** Retries transient failures (rate limits) with a fixed delay. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries: number; delayMs: number; isRetryable(e: unknown): boolean; sleep?(ms: number): Promise<void>; onRetry?(e: unknown, n: number): void },
): Promise<T> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let n = 0; ; n++) {
    try {
      return await fn();
    } catch (e) {
      if (n >= opts.retries || !opts.isRetryable(e)) throw e;
      opts.onRetry?.(e, n + 1);
      await sleep(opts.delayMs);
    }
  }
}

/** Free-tier Gemini rate limits surface as 429 / RESOURCE_EXHAUSTED / quota errors. */
export const isRateLimit = (e: unknown) => /\b429\b|RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(message(e));
