import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldEscalate } from "../src/triage/policy.ts";
import type { TriageResult, Verdict } from "../src/triage/types.ts";
import { benignFeatures, field, makeFeatures, phishFeatures } from "./helpers.ts";

const local = (verdict: Verdict, confidence: number): TriageResult => ({
  verdict, confidence, reasons: [], source: "on-device", latencyMs: 10,
});

test("escalates when there is no usable local result", () => {
  assert.deepEqual(shouldEscalate(null, benignFeatures()), { escalate: true, reason: "no-local-result" });
});

test("confident local verdicts stay on-device", () => {
  assert.equal(shouldEscalate(local("phishing", 0.9), phishFeatures()).escalate, false);
  assert.equal(shouldEscalate(local("safe", 0.9), benignFeatures()).escalate, false);
});

test("low confidence and 'suspicious' escalate", () => {
  assert.equal(shouldEscalate(local("phishing", 0.6), phishFeatures()).reason, "low-confidence");
  assert.equal(shouldEscalate(local("suspicious", 0.9), benignFeatures()).reason, "suspicious");
});

test("a confident 'safe' on a high-risk page escalates (prompt-injection guard)", () => {
  assert.ok(phishFeatures().prefilter.score >= 8);
  assert.deepEqual(shouldEscalate(local("safe", 0.99), phishFeatures()), { escalate: true, reason: "contradicts-heuristics" });
});

test("thresholds are configurable", () => {
  const strict = { minConfidence: 0.95, highRiskScore: 100, lowRiskScore: 0, brandCheck: false };
  assert.equal(shouldEscalate(local("phishing", 0.9), phishFeatures(), strict).reason, "low-confidence");
  assert.equal(shouldEscalate(local("safe", 0.99), phishFeatures(), strict).escalate, false);
});

test("a 'phishing' on a low-risk page escalates (no banner on a hunch alone)", () => {
  assert.ok(benignFeatures().prefilter.score < 4);
  assert.deepEqual(shouldEscalate(local("phishing", 0.95), benignFeatures()), { escalate: true, reason: "unsupported-phishing" });
  assert.equal(shouldEscalate(local("phishing", 0.95), phishFeatures()).escalate, false);
});

test("a 'phishing' at score 4 still escalates; at 5 it stands", () => {
  const at = (score: number) => {
    const f = benignFeatures();
    return { ...f, prefilter: { ...f.prefilter, score } };
  };
  assert.equal(shouldEscalate(local("phishing", 0.95), at(4)).reason, "unsupported-phishing");
  assert.equal(shouldEscalate(local("phishing", 0.95), at(5)).escalate, false);
});

test("a 'safe' on a page asking for secrets under a brand it isn't hosted by escalates", () => {
  // Brand only in the page text, on a domain the brand list doesn't know (like paypai.com).
  const lookalike = makeFeatures({
    url: "https://www.paypai.com/login",
    title: "PayPal: Log in",
    text: "Log in to your PayPal account.",
    forms: [{ action: null, method: "post", synthetic: false, fields: [field({ type: "email" }), field({ type: "password" })] }],
  });
  assert.ok(lookalike.prefilter.reasons.includes("brand-text-mismatch"));
  assert.deepEqual(shouldEscalate(local("safe", 0.95), lookalike), { escalate: true, reason: "unverified-brand" });
  // Only "safe" is second-guessed by this check. (A "phishing" here still escalates, but
  // for the low score: paypai.com scores 4.)
  assert.equal(shouldEscalate(local("phishing", 0.95), lookalike).reason, "unsupported-phishing");
});

test("a brand mention without a sensitive form doesn't trigger the brand check", () => {
  const article = makeFeatures({
    url: "https://news.example.org/story",
    title: "PayPal earnings beat estimates",
    text: "PayPal reported quarterly results on Tuesday.",
  });
  assert.notEqual(shouldEscalate(local("safe", 0.95), article).reason, "unverified-brand");
  // An ordinary own-brand login doesn't trigger it either.
  assert.equal(shouldEscalate(local("safe", 0.95), benignFeatures()).escalate, false);
});
