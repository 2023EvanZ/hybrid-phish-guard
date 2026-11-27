import { test } from "node:test";
import assert from "node:assert/strict";
import { caseFeatures } from "../eval/case.ts";
import { HELDOUT_CASES } from "../eval/cases/heldout.ts";
import { ALL_CASES } from "../eval/cases/index.ts";

test("eval cases have unique ids, notes, and build into features", () => {
  const ids = new Set<string>();
  for (const c of ALL_CASES) {
    assert.ok(!ids.has(c.id), `duplicate id ${c.id}`);
    ids.add(c.id);
    assert.ok(c.note.length > 0, `${c.id} needs a note`);
    // Retired held-out cases keep their h- prefix (h-p-, h-b-).
    assert.equal(/^(h-)?p-/.test(c.id), c.label === "phishing", `${c.id}: prefix must match label`);
    assert.doesNotThrow(() => caseFeatures(c), c.id);
  }
});

// Shape checks only. No score floor on purpose: a floor would turn the held-out cases
// into something to tune against.
test("held-out cases are separate from the dev set and build into features", () => {
  const dev = new Set(ALL_CASES.map((c) => c.id));
  const ids = new Set<string>();
  for (const c of HELDOUT_CASES) {
    assert.ok(!dev.has(c.id) && !ids.has(c.id), `duplicate id ${c.id}`);
    ids.add(c.id);
    assert.ok(c.note.length > 0, `${c.id} needs a note`);
    assert.equal(c.id.startsWith("h-p-"), c.label === "phishing", `${c.id}: prefix must match label`);
    assert.ok(c.id.startsWith("h-p-") || c.id.startsWith("h-b-"), `${c.id}: held-out ids start with h-`);
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
// Re-baselined on 2026-11-26, when retired held-out set 1 joined the dev set (+1 false
// alarm, h-b-city-utility-paymentus) and the callback-scam signal caught h-p-coinbase-callback.
// Re-baselined on 2026-11-27, when retired held-out set 2 joined the dev set (+4 caught by
// the branded callback signal) and the no-brand callback rule caught h-p-card-fraud-dept.
test("rules fallback does not regress below the recorded baseline", async () => {
  const { evaluateCases } = await import("../eval/evaluate.ts");
  const { summarize } = await import("../eval/metrics.ts");
  const { rulesClassifier } = await import("../src/triage/rules.ts");
  const s = summarize(await evaluateCases(ALL_CASES, rulesClassifier));
  assert.equal(s.gate.phishingChecked, 1, "every phishing case must reach a classifier");
  assert.ok(s.lenient.tp >= 40, `lenient TP ${s.lenient.tp} < 40`);
  assert.ok(s.lenient.fp <= 12, `lenient FP ${s.lenient.fp} > 12`);
  assert.ok(s.strict.fp <= 0, `strict FP ${s.strict.fp} > 0`);
});
