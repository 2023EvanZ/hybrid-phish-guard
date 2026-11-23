// Runs a classifier over eval cases the way the extension would: the prefilter gate
// first (unforced), then the classifier only for pages that pass.

import type { Classifier } from "../src/triage/types.ts";
import { caseFeatures } from "./case.ts";
import type { EvalCase } from "./case.ts";
import type { Outcome } from "./metrics.ts";

export async function evaluateCases(cases: EvalCase[], classifier: Classifier): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  for (const c of cases) {
    const features = caseFeatures(c);
    const prediction = features.prefilter.shouldCheck ? (await classifier.classify(features)).verdict : "unchecked";
    outcomes.push({ id: c.id, category: c.category, label: c.label, prediction, score: features.prefilter.score });
  }
  return outcomes;
}
