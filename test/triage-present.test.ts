import { test } from "node:test";
import assert from "node:assert/strict";
import { triage } from "../src/triage/pipeline.ts";
import { NOTHING_SENT, adviceFor, badgeFor, pendingView, showsNotice, provenanceNote, verdictView, whereView } from "../src/triage/present.ts";
import type { TriageReport } from "../src/triage/pipeline.ts";
import type { Verdict, VerdictSource } from "../src/triage/types.ts";
import { benignFeatures, phishFeatures } from "./helpers.ts";

const report = (verdict: Verdict, source: VerdictSource = "on-device", confidence = 0.9): TriageReport => ({
  final: { verdict, confidence, reasons: ["r"], source, latencyMs: 1 },
  local: null,
  cloud: null,
  escalation: { escalate: false, reason: "confident" },
  errors: [],
  sentToCloud: null,
});

test("verdictView words the verdict and says where it came from", async () => {
  const v = verdictView(await triage(phishFeatures()));
  assert.equal(v.tone, "danger");
  assert.equal(v.headline, "This page looks like phishing");
  assert.equal(v.detail, "Rule-based check (no AI model), 75% confident");
  assert.ok(v.reasons.length > 0);
  assert.equal(verdictView(report("safe", "cloud", 0.82)).detail, "Checked in the cloud, with personal data removed, 82% confident");
});

test("phishing and suspicious get the corner notice, safe gets nothing", () => {
  assert.equal(showsNotice(report("phishing")), true);
  assert.equal(showsNotice(report("suspicious")), true);
  assert.equal(showsNotice(report("safe")), false);
  assert.match(adviceFor("phishing"), /Don't enter passwords/);
  assert.match(adviceFor("suspicious"), /Check the web address/);
});

test("badge: red for phishing, amber for suspicious, none otherwise", async () => {
  assert.deepEqual(badgeFor(report("phishing")), { text: "!", color: "#dc2626" });
  assert.equal(badgeFor(report("suspicious")).text, "?");
  assert.equal(badgeFor(await triage(benignFeatures())).text, "");
  assert.equal(badgeFor(undefined).text, "");
});

test("provenanceNote explains escalations and fallbacks", async () => {
  assert.equal(provenanceNote(report("phishing", "on-device")), null);
  assert.equal(
    provenanceNote({ ...report("phishing", "cloud"), escalation: { escalate: true, reason: "low-confidence" } }),
    "Sent to the cloud because the on-device model was unsure.",
  );
  assert.equal(provenanceNote(await triage(benignFeatures())), "No AI model is connected yet, so rules decided.");
  assert.equal(
    provenanceNote({ ...report("phishing", "rules"), errors: ["quota exceeded"] }),
    "AI models unavailable (quota exceeded), so rules decided.",
  );
  const distrusted = { ...report("phishing", "rules"), local: report("safe").final, escalation: { escalate: true, reason: "contradicts-heuristics" as const } };
  assert.match(provenanceNote(distrusted)!, /wasn't trusted/);
});

test("provenanceNote says when a device has no Gemini Nano", () => {
  const cloudOnly = {
    ...report("phishing", "cloud"),
    escalation: { escalate: true, reason: "no-local-result" as const },
    errors: ["on-device model: Gemini Nano isn't available on this device yet (status: downloadable)"],
  };
  assert.match(provenanceNote(cloudOnly)!, /isn't available on this device, so this page was checked in the cloud/);
});

test("the instant rules warning says where it came from", () => {
  const v = pendingView({ verdict: "phishing", confidence: 0.75, reasons: ["Web address imitates a known brand"], source: "rules", latencyMs: 0 });
  assert.equal(v.tone, "danger");
  assert.equal(v.headline, "This page looks like phishing");
  assert.equal(v.detail, "Found by the rule-based check");
  assert.deepEqual(v.reasons, ["Web address imitates a known brand"]);
});

test("whereView follows what was sent, not where the verdict came from", async () => {
  assert.deepEqual(whereView(report("phishing", "on-device")), NOTHING_SENT);
  assert.equal(whereView(await triage(benignFeatures())).leftDevice, false);
  const sent = phishFeatures();
  const cloud = { ...report("phishing", "cloud"), sentToCloud: sent };
  assert.equal(whereView(cloud).leftDevice, true);
  assert.match(whereView(cloud).text, /personal details removed/);
  // The cloud call failed and Nano's verdict stood: the summary still left the device.
  assert.equal(whereView({ ...report("suspicious", "on-device"), sentToCloud: sent }).leftDevice, true);
  // Reports stored before sentToCloud existed.
  const old = { ...report("phishing", "on-device") } as Partial<TriageReport>;
  delete old.sentToCloud;
  assert.equal(whereView(old as TriageReport).leftDevice, false);
});

test("provenanceNote says when the cloud was asked but didn't answer", () => {
  const sent = phishFeatures();
  const nanoKept = {
    ...report("suspicious", "on-device"),
    escalation: { escalate: true, reason: "low-confidence" as const },
    errors: ["cloud model timed out after 20000 ms"],
    sentToCloud: sent,
  };
  assert.equal(provenanceNote(nanoKept), "Sent to the cloud because the on-device model was unsure, but no answer came back, so this is Gemini Nano's verdict.");
  const rulesDecided = {
    ...report("phishing", "rules"),
    escalation: { escalate: true, reason: "no-local-result" as const },
    errors: ["on-device model: Gemini Nano isn't available on this device yet (status: downloadable)", "cloud model: quota exceeded"],
    sentToCloud: sent,
  };
  assert.equal(provenanceNote(rulesDecided), "Gemini Nano isn't available on this device, so this page was sent to the cloud, but no answer came back, so the rules decided.");
});

test("a failed cloud call through the real pipeline is disclosed on the card", async () => {
  const failing = { source: "cloud" as const, classify: () => Promise.reject(new Error("cloud model: offline")) };
  const r = await triage(phishFeatures(), { cloud: failing });
  assert.equal(r.final.source, "rules");
  assert.equal(whereView(r).leftDevice, true);
  assert.match(provenanceNote(r)!, /no answer came back, so the rules decided/);
});
