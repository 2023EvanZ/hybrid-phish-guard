import { test } from "node:test";
import assert from "node:assert/strict";
import { NANO_UNAVAILABLE } from "../src/shared/messages.ts";
import { triage } from "../src/triage/pipeline.ts";
import { NEVER_SENT, privacyView } from "../src/triage/privacy.ts";
import { CLOUD_PROMPT, buildTriagePrompt } from "../src/triage/prompt.ts";
import type { Classifier, Verdict } from "../src/triage/types.ts";
import { benignFeatures, phishFeatures } from "./helpers.ts";

const fake = (source: "on-device" | "cloud", verdict: Verdict, confidence: number, latencyMs = 1800): Classifier => ({
  source,
  classify: async () => ({ verdict, confidence, reasons: [], source, latencyMs }),
});
const failing = (source: "on-device" | "cloud", msg: string): Classifier => ({
  source,
  classify: async () => { throw new Error(msg); },
});

test("a confident on-device check says nothing left the device", async () => {
  const f = benignFeatures();
  const view = privacyView(f, await triage(f, { local: fake("on-device", "safe", 0.95), cloud: fake("cloud", "safe", 0.9) }));
  assert.equal(view.leftDevice, false);
  assert.equal(view.headline, "Nothing left this device");
  assert.match(view.why, /Gemini Nano was confident/);
  assert.equal(view.sent, null);
  assert.deepEqual(view.steps.map((s) => [s.name, s.where, s.ran]), [
    ["Rule-based check", "device", true],
    ["Gemini Nano", "device", true],
    ["Cloud model", "cloud", false],
  ]);
  assert.equal(view.steps[1].result, "Safe, 95% confident, 1.8 s");
  assert.equal(view.steps[2].result, "Not used");
});

test("an escalated check says why, and shows each redaction and the exact prompt", async () => {
  const f = phishFeatures();
  const report = await triage(f, { local: fake("on-device", "suspicious", 0.6), cloud: fake("cloud", "phishing", 0.97, 1100) });
  const view = privacyView(f, report);
  assert.equal(view.leftDevice, true);
  assert.equal(view.why, "Sent because the on-device model was unsure.");
  assert.equal(view.steps[2].result, "Phishing, 97% confident, 1.1 s");

  const fields = Object.fromEntries(view.sent!.redactions.map((r) => [r.field, r]));
  assert.equal(fields["Web address"].onPage, f.url);
  assert.equal(fields["Web address"].sent, "https://wellsfarg0-secure-login.example.ru/verify?[redacted]#[redacted]");
  assert.equal(fields["Form destination"].sent, "https://collect.evil.example/p.php?[redacted]");
  assert.equal(fields.Title, undefined, "an unchanged title isn't listed");

  // "Dear Jane", the phone number, the email and the card number in the fixture text.
  assert.equal(view.sent!.removedFromText, "1 email address, 2 long numbers, 1 name");
  assert.equal(view.sent!.prompt, buildTriagePrompt(report.sentToCloud!, CLOUD_PROMPT));
  assert.ok(!view.sent!.prompt.includes("jane.doe@gmail.com"));
});

test("a failed cloud call is still disclosed as sent", async () => {
  const f = phishFeatures();
  const view = privacyView(f, await triage(f, { local: fake("on-device", "suspicious", 0.6), cloud: failing("cloud", "quota exceeded") }));
  assert.equal(view.leftDevice, true);
  assert.equal(view.steps[2].result, "Sent, but no answer came back");
  assert.equal(view.steps[2].ran, true);
});

test("no Gemini Nano: says so, and why the page went to the cloud", async () => {
  const f = phishFeatures();
  const view = privacyView(f, await triage(f, { local: failing("on-device", `${NANO_UNAVAILABLE} (downloadable)`), cloud: fake("cloud", "phishing", 0.9) }));
  assert.equal(view.steps[1].result, "Not available on this device");
  assert.equal(view.why, "Sent because Gemini Nano isn't available on this device.");
});

test("rules only: nothing sent, and it says the rules decided", async () => {
  const f = phishFeatures();
  const view = privacyView(f, await triage(f));
  assert.equal(view.leftDevice, false);
  assert.match(view.why, /rules decided/);
  assert.equal(view.steps[1].result, "No answer");
});

test("the never-sent list states the text cap from the extractor", () => {
  assert.ok(NEVER_SENT.some((l) => l.includes("1,500 characters")));
});
