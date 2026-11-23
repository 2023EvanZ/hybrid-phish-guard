import { test } from "node:test";
import assert from "node:assert/strict";
import { caseFeatures } from "../eval/case.ts";
import { ALL_CASES } from "../eval/cases/index.ts";

test("eval cases have unique ids, notes, and build into features", () => {
  const ids = new Set<string>();
  for (const c of ALL_CASES) {
    assert.ok(!ids.has(c.id), `duplicate id ${c.id}`);
    ids.add(c.id);
    assert.ok(c.note.length > 0, `${c.id} needs a note`);
    assert.equal(c.id.startsWith("p-"), c.label === "phishing", `${c.id}: prefix must match label`);
    assert.doesNotThrow(() => caseFeatures(c), c.id);
  }
});

test("the eval set is roughly balanced", () => {
  const phishing = ALL_CASES.filter((c) => c.label === "phishing").length;
  const benign = ALL_CASES.length - phishing;
  assert.ok(Math.min(phishing, benign) / Math.max(phishing, benign) > 0.8, `${phishing} phishing vs ${benign} benign`);
});

// Regression floor for the rules fallback, set at the baseline recorded in eval/README.md.
// If a heuristics change lowers these, the test fails; if it raises them, raise the floor.
test("rules fallback does not regress below the recorded baseline", async () => {
  const { evaluateCases } = await import("../eval/evaluate.ts");
  const { summarize } = await import("../eval/metrics.ts");
  const { rulesClassifier } = await import("../src/triage/rules.ts");
  const s = summarize(await evaluateCases(ALL_CASES, rulesClassifier));
  assert.ok(s.lenient.tp >= 24, `lenient TP ${s.lenient.tp} < 24`);
  assert.ok(s.lenient.fp <= 12, `lenient FP ${s.lenient.fp} > 12`);
  assert.ok(s.strict.fp <= 0, `strict FP ${s.strict.fp} > 0`);
});
