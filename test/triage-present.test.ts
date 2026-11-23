import { test } from "node:test";
import assert from "node:assert/strict";
import { triage } from "../src/triage/pipeline.ts";
import { badgeFor, shouldShowBanner, verdictView } from "../src/triage/present.ts";
import type { TriageReport } from "../src/triage/pipeline.ts";
import type { Verdict, VerdictSource } from "../src/triage/types.ts";
import { benignFeatures, phishFeatures } from "./helpers.ts";

const report = (verdict: Verdict, source: VerdictSource = "on-device", confidence = 0.9): TriageReport => ({
  final: { verdict, confidence, reasons: ["r"], source, latencyMs: 1 },
  local: null,
  cloud: null,
  escalation: { escalate: false, reason: "confident" },
  errors: [],
});

test("verdictView words the verdict and says where it came from", async () => {
  const v = verdictView(await triage(phishFeatures()));
  assert.equal(v.tone, "danger");
  assert.equal(v.headline, "This page looks like phishing");
  assert.equal(v.detail, "Rule-based check (no AI model), 75% confident");
  assert.ok(v.reasons.length > 0);
  assert.equal(verdictView(report("safe", "cloud", 0.82)).detail, "Checked in the cloud, with personal data removed, 82% confident");
});

test("only a phishing verdict interrupts the page", () => {
  assert.equal(shouldShowBanner(report("phishing")), true);
  assert.equal(shouldShowBanner(report("suspicious")), false);
  assert.equal(shouldShowBanner(report("safe")), false);
});

test("badge: red for phishing, amber for suspicious, none otherwise", async () => {
  assert.deepEqual(badgeFor(report("phishing")), { text: "!", color: "#dc2626" });
  assert.equal(badgeFor(report("suspicious")).text, "?");
  assert.equal(badgeFor(await triage(benignFeatures())).text, "");
  assert.equal(badgeFor(undefined).text, "");
});
