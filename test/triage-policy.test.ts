import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldEscalate } from "../src/triage/policy.ts";
import type { TriageResult, Verdict } from "../src/triage/types.ts";
import { benignFeatures, phishFeatures } from "./helpers.ts";

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
  const strict = { minConfidence: 0.95, highRiskScore: 100 };
  assert.equal(shouldEscalate(local("phishing", 0.9), phishFeatures(), strict).reason, "low-confidence");
  assert.equal(shouldEscalate(local("safe", 0.99), phishFeatures(), strict).escalate, false);
});
