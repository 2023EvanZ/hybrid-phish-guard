// Scoring for the evaluation set. Pure functions over (label, prediction) pairs.
//
// A page the prefilter gate skips never reaches a classifier, so in production it gets
// no warning. The eval mirrors that: an unchecked page counts as a "safe" prediction,
// and gate recall is reported separately because a gate miss can't be fixed by a better
// model.

import type { Verdict } from "../src/triage/types.ts";
import type { Label } from "./case.ts";

export type Prediction = Verdict | "unchecked";

export interface Outcome {
  id: string;
  category: string;
  label: Label;
  prediction: Prediction;
  score: number;
}

export interface Confusion {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  /** null when undefined (no positive predictions / no positive labels). */
  precision: number | null;
  recall: number | null;
  f1: number | null;
  falsePositiveRate: number | null;
}

const ratio = (a: number, b: number) => (b === 0 ? null : a / b);

export function confusion(outcomes: Outcome[], flagged: (p: Prediction) => boolean): Confusion {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const o of outcomes) {
    const pos = flagged(o.prediction);
    if (o.label === "phishing") pos ? tp++ : fn++;
    else pos ? fp++ : tn++;
  }
  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  const f1 = precision === null || recall === null || precision + recall === 0
    ? null
    : (2 * precision * recall) / (precision + recall);
  return { tp, fp, fn, tn, precision, recall, f1, falsePositiveRate: ratio(fp, fp + tn) };
}

/** Strict: only a "phishing" verdict counts as a warning. */
export const strict = (p: Prediction) => p === "phishing";
/** Lenient: "suspicious" also counts, since the UI shows it as a warning too. */
export const lenient = (p: Prediction) => p === "phishing" || p === "suspicious";

export interface CategoryRow {
  category: string;
  label: Label;
  n: number;
  /** Cases flagged under the lenient rule. */
  flagged: number;
  checked: number;
}

export interface EvalSummary {
  n: { phishing: number; benign: number };
  gate: {
    /** Share of phishing pages the gate lets through to a classifier. */
    phishingChecked: number | null;
    /** Share of benign pages that cost a classifier call. */
    benignChecked: number | null;
  };
  strict: Confusion;
  lenient: Confusion;
  byCategory: CategoryRow[];
  /** Wrong under the lenient rule: missed phishing and flagged benign pages. */
  errors: Outcome[];
}

export function summarize(outcomes: Outcome[]): EvalSummary {
  const phish = outcomes.filter((o) => o.label === "phishing");
  const benign = outcomes.filter((o) => o.label === "benign");
  const checked = (os: Outcome[]) => os.filter((o) => o.prediction !== "unchecked").length;

  const rows = new Map<string, CategoryRow>();
  for (const o of outcomes) {
    const key = `${o.label}/${o.category}`;
    const row = rows.get(key) ?? { category: o.category, label: o.label, n: 0, flagged: 0, checked: 0 };
    row.n++;
    if (lenient(o.prediction)) row.flagged++;
    if (o.prediction !== "unchecked") row.checked++;
    rows.set(key, row);
  }

  return {
    n: { phishing: phish.length, benign: benign.length },
    gate: { phishingChecked: ratio(checked(phish), phish.length), benignChecked: ratio(checked(benign), benign.length) },
    strict: confusion(outcomes, strict),
    lenient: confusion(outcomes, lenient),
    byCategory: [...rows.values()].sort((a, b) => a.label.localeCompare(b.label) || a.category.localeCompare(b.category)),
    errors: outcomes.filter((o) => lenient(o.prediction) !== (o.label === "phishing")),
  };
}
