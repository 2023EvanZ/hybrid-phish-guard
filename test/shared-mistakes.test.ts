import { test } from "node:test";
import assert from "node:assert/strict";
import { caseFeatures, expandField } from "../eval/case.ts";
import { classifyField } from "../src/prefilter/signals.ts";
import type { FieldKind } from "../src/prefilter/signals.ts";
import { MAX_MISTAKES, exportMistakes, makeMistake, mistakeKind, parseMistakes, toEvalCase, withMistake, withoutMistake } from "../src/shared/mistakes.ts";
import type { TriageReport } from "../src/triage/pipeline.ts";
import { benignFeatures, phishFeatures } from "./helpers.ts";

const NOW = new Date("2026-11-26T12:00:00Z");
const triageOf = (verdict: "phishing" | "suspicious" | "safe", source: "on-device" | "cloud" | "rules" = "on-device"): TriageReport => ({
  final: { verdict, confidence: 0.9, reasons: [], source, latencyMs: 1 },
  local: null,
  cloud: null,
  escalation: { escalate: false, reason: "confident" },
  errors: [],
  sentToCloud: null,
});

test("a warning reported as wrong is a false alarm; anything else is a missed scam", () => {
  assert.equal(mistakeKind("phishing"), "false-alarm");
  assert.equal(mistakeKind("suspicious"), "false-alarm");
  assert.equal(mistakeKind("safe"), "missed");
  assert.equal(mistakeKind(null), "missed");
});

test("makeMistake stores the redacted page, never the raw one", () => {
  const r = makeMistake(phishFeatures(), triageOf("phishing", "cloud"), NOW, "id1");
  assert.equal(r.kind, "false-alarm");
  assert.equal(r.verdict, "phishing");
  assert.equal(r.source, "cloud");
  assert.equal(r.at, NOW.toISOString());
  // phishFeatures' URL carries an email in the query and a token in the fragment.
  assert.doesNotMatch(r.features.url, /jane|gmail|c2Vzc2lvbg/);
  assert.match(r.features.url, /\?\[redacted\]#\[redacted\]$/);
  assert.doesNotMatch(JSON.stringify(r), /jane\.doe@gmail\.com/);
  assert.equal(makeMistake(benignFeatures(), null, NOW, "id2").verdict, null);
});

test("the list keeps one report per address, newest first, capped", () => {
  const a = makeMistake(phishFeatures(), triageOf("phishing"), NOW, "a");
  const b = makeMistake(benignFeatures(), null, NOW, "b");
  let list = withMistake(withMistake([], a), b);
  assert.deepEqual(list.map((r) => r.id), ["b", "a"]);
  // Reporting the same page again replaces the earlier report.
  list = withMistake(list, { ...a, id: "a2" });
  assert.deepEqual(list.map((r) => r.id), ["a2", "b"]);
  assert.deepEqual(withoutMistake(list, "b").map((r) => r.id), ["a2"]);
  let big: typeof list = [];
  for (let i = 0; i < MAX_MISTAKES + 5; i++) big = withMistake(big, { ...b, id: `x${i}`, features: { ...b.features, url: `https://e${i}.example/` } });
  assert.equal(big.length, MAX_MISTAKES);
  assert.equal(big[0].id, `x${MAX_MISTAKES + 4}`);
});

test("parseMistakes drops malformed entries", () => {
  const ok = makeMistake(benignFeatures(), null, NOW, "ok");
  assert.deepEqual(parseMistakes(undefined), []);
  assert.deepEqual(parseMistakes({}), []);
  assert.deepEqual(parseMistakes([ok, null, { id: "x" }, { ...ok, kind: "other" }]), [ok]);
});

test("every field kind exports as shorthand that classifies back to the same kind", () => {
  const kinds: FieldKind[] = ["password", "card", "bank", "ssn", "otp", "identity", "other"];
  const r = makeMistake(phishFeatures(), null, NOW, "f");
  r.features.forms = [{ action: null, method: "post", crossOrigin: false, insecure: false, synthetic: false, fieldKinds: kinds }];
  const spec = toEvalCase(r, 0).forms![0];
  assert.deepEqual(spec.fields.map((f) => classifyField(expandField(f))), kinds);
});

test("an exported case rebuilds the same page signals", () => {
  const r = makeMistake(phishFeatures(), triageOf("safe"), NOW, "m");
  const c = toEvalCase(r, 2);
  assert.equal(c.label, "phishing");
  assert.equal(c.category, "user-report");
  assert.match(c.id, /^p-user-wellsfarg0-secure-login-example-ru-3$/);
  assert.match(c.note, /missed scam: the extension said safe \(Gemini Nano\)/);
  const rebuilt = caseFeatures(c);
  // Same evidence as the redacted page the report holds.
  assert.deepEqual(rebuilt.forms.map((f) => f.fieldKinds), r.features.forms.map((f) => f.fieldKinds));
  assert.deepEqual(rebuilt.forms.map((f) => f.crossOrigin), r.features.forms.map((f) => f.crossOrigin));
  assert.equal(rebuilt.urlSignals.hostname, r.features.urlSignals.hostname);
  // Including callback-scam: the page's phone number was redacted, and a fictional one is
  // put back so the rebuilt case still trips it.
  assert.ok(r.features.prefilter.reasons.includes("callback-scam"));
  assert.doesNotMatch(r.features.textSnippet, /\d{3}-\d{4}/); // no phone number survived redaction
  assert.match(c.text!, /1-800-555-0100/);
  assert.match(c.note, /replaced with 1-800-555-0100/);
  assert.deepEqual(rebuilt.prefilter.reasons, r.features.prefilter.reasons);

  const fa = toEvalCase(makeMistake(benignFeatures(), triageOf("suspicious", "rules"), NOW, "n"), 0);
  assert.equal(fa.label, "benign");
  assert.match(fa.id, /^b-user-/);
  assert.match(fa.note, /false alarm: the extension said suspicious \(the rules\)/);
});

test("the export file carries the draft cases and a review warning", () => {
  const list = [makeMistake(phishFeatures(), null, NOW, "e")];
  const out = JSON.parse(exportMistakes(list, NOW));
  assert.equal(out.format, "hybrid-phish-guard/mistakes@1");
  assert.equal(out.cases.length, 1);
  assert.equal(out.reports.length, 1);
  assert.match(out.note, /review each/);
  assert.match(out.cases[0].note, /didn't check it/);
});
