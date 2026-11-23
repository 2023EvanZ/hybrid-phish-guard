import { test } from "node:test";
import assert from "node:assert/strict";
import { caseFeatures, expandField } from "../eval/case.ts";
import { evaluateCases } from "../eval/evaluate.ts";
import { confusion, lenient, strict, summarize } from "../eval/metrics.ts";
import type { Outcome, Prediction } from "../eval/metrics.ts";
import type { Classifier } from "../src/triage/types.ts";

const o = (id: string, label: "phishing" | "benign", prediction: Prediction, category = "c"): Outcome =>
  ({ id, category, label, prediction, score: 0 });

test("confusion counts and ratios under strict and lenient rules", () => {
  const outcomes = [
    o("a", "phishing", "phishing"),
    o("b", "phishing", "suspicious"),
    o("c", "phishing", "unchecked"),
    o("d", "benign", "suspicious"),
    o("e", "benign", "safe"),
    o("f", "benign", "unchecked"),
  ];
  const s = confusion(outcomes, strict);
  assert.deepEqual([s.tp, s.fp, s.fn, s.tn], [1, 0, 2, 3]);
  assert.equal(s.precision, 1);
  assert.equal(s.recall, 1 / 3);

  const l = confusion(outcomes, lenient);
  assert.deepEqual([l.tp, l.fp, l.fn, l.tn], [2, 1, 1, 2]);
  assert.equal(l.precision, 2 / 3);
  assert.equal(l.falsePositiveRate, 1 / 3);
  assert.ok(Math.abs(l.f1! - 2 / 3) < 1e-12);
});

test("undefined ratios are null, not NaN", () => {
  const c = confusion([o("a", "benign", "safe")], strict);
  assert.equal(c.precision, null);
  assert.equal(c.recall, null);
  assert.equal(c.f1, null);
  assert.equal(c.falsePositiveRate, 0);
});

test("summary reports gate coverage, per-category rows and errors", () => {
  const s = summarize([
    o("a", "phishing", "phishing", "lookalike"),
    o("b", "phishing", "unchecked", "tech-support"),
    o("c", "benign", "suspicious", "router"),
    o("d", "benign", "unchecked", "news"),
  ]);
  assert.deepEqual(s.n, { phishing: 2, benign: 2 });
  assert.deepEqual(s.gate, { phishingChecked: 0.5, benignChecked: 0.5 });
  assert.deepEqual(s.errors.map((e) => e.id), ["b", "c"]);
  assert.deepEqual(
    s.byCategory.map((r) => `${r.label}/${r.category}:${r.flagged}/${r.n}`),
    ["benign/news:0/1", "benign/router:1/1", "phishing/lookalike:1/1", "phishing/tech-support:0/1"],
  );
});

test("field shorthand expands to descriptors the prefilter classifies as intended", () => {
  const f = caseFeatures({
    id: "x", label: "phishing", category: "c", note: "",
    url: "https://example.org/",
    forms: [{ fields: ["email", "password", "card", "cvv", "ssn", "routing", "otp", "text:nickname"] }],
  });
  assert.deepEqual(f.forms[0].fieldKinds, ["identity", "password", "card", "card", "ssn", "bank", "otp", "other"]);
  assert.throws(() => expandField("pasword"), /unknown field shorthand/);
});

test("evaluateCases skips the classifier for pages the gate doesn't check", async () => {
  let calls = 0;
  const classifier: Classifier = {
    source: "rules",
    classify: async () => (calls++, { verdict: "phishing", confidence: 1, reasons: [], source: "rules", latencyMs: 0 }),
  };
  const out = await evaluateCases(
    [
      { id: "skip", label: "benign", category: "c", note: "", url: "https://blog.example.org/post" },
      { id: "check", label: "phishing", category: "c", note: "", url: "https://example.org/", forms: [{ fields: ["password"] }] },
    ],
    classifier,
  );
  assert.deepEqual(out.map((x) => x.prediction), ["unchecked", "phishing"]);
  assert.equal(calls, 1);
});
