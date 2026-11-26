import { test } from "node:test";
import assert from "node:assert/strict";
import { modelClassifier } from "../src/triage/model.ts";
import type { TextModel } from "../src/triage/model.ts";
import { triage } from "../src/triage/pipeline.ts";
import type { Classifier, TriageResult, Verdict } from "../src/triage/types.ts";
import type { PageFeatures } from "../src/shared/messages.ts";
import { benignFeatures, phishFeatures } from "./helpers.ts";

function fake(source: "on-device" | "cloud", verdict: Verdict, confidence: number) {
  const seen: PageFeatures[] = [];
  const classifier: Classifier = {
    source,
    async classify(f) {
      seen.push(f);
      return { verdict, confidence, reasons: [`${source} says ${verdict}`], source, latencyMs: 1 } satisfies TriageResult;
    },
  };
  return { classifier, seen };
}
const failing = (source: "on-device" | "cloud", msg: string): Classifier => ({
  source,
  classify: async () => { throw new Error(msg); },
});
const hanging = (source: "on-device" | "cloud"): Classifier => ({ source, classify: () => new Promise(() => {}) });

test("confident on-device verdict is final and the cloud is never called", async () => {
  const local = fake("on-device", "phishing", 0.9);
  const cloud = fake("cloud", "safe", 0.9);
  const r = await triage(phishFeatures(), { local: local.classifier, cloud: cloud.classifier });
  assert.equal(r.final.source, "on-device");
  assert.equal(cloud.seen.length, 0);
});

test("low confidence escalates, and the cloud only ever sees redacted features", async () => {
  const local = fake("on-device", "phishing", 0.4);
  const cloud = fake("cloud", "phishing", 0.95);
  const r = await triage(phishFeatures(), { local: local.classifier, cloud: cloud.classifier });
  assert.equal(r.final.source, "cloud");
  assert.equal(r.escalation.reason, "low-confidence");
  assert.equal(local.seen[0].url.includes("jane.doe@gmail.com"), true); // on-device gets the real page
  const sent = JSON.stringify(cloud.seen[0]);
  assert.ok(!sent.includes("jane.doe@gmail.com") && !sent.includes("704-555-0199"));
});

test("local failure escalates; cloud failure falls back to the local verdict", async () => {
  const cloud = fake("cloud", "phishing", 0.9);
  const r1 = await triage(phishFeatures(), { local: failing("on-device", "model not downloaded"), cloud: cloud.classifier });
  assert.equal(r1.final.source, "cloud");
  assert.deepEqual(r1.errors, ["model not downloaded"]);

  const local = fake("on-device", "phishing", 0.5);
  const r2 = await triage(phishFeatures(), { local: local.classifier, cloud: failing("cloud", "quota exceeded") });
  assert.equal(r2.final.source, "on-device");
  assert.deepEqual(r2.errors, ["quota exceeded"]);
});

test("a distrusted 'safe' is replaced by the rules when the cloud is unavailable", async () => {
  const local = fake("on-device", "safe", 0.99);
  const r = await triage(phishFeatures(), { local: local.classifier });
  assert.equal(r.escalation.reason, "contradicts-heuristics");
  assert.equal(r.final.source, "rules");
  assert.equal(r.final.verdict, "phishing");
});

test("with no models at all, the rules answer", async () => {
  const r = await triage(benignFeatures());
  assert.equal(r.final.source, "rules");
  assert.equal(r.escalation.reason, "no-local-result");
});

test("a stalled on-device model times out and the cloud answers", async () => {
  const cloud = fake("cloud", "safe", 0.9);
  const r = await triage(benignFeatures(), { local: hanging("on-device"), cloud: cloud.classifier, localTimeoutMs: 20 });
  assert.equal(r.final.source, "cloud");
  assert.match(r.errors[0], /timed out after 20 ms/);
});

test("modelClassifier: prompt in, parsed verdict out; bad output throws", async () => {
  const prompts: string[] = [];
  const good: TextModel = { generate: async (p) => (prompts.push(p), '```json\n{"verdict":"phishing","confidence":0.88,"reasons":["fake login"]}\n```') };
  let t = 0;
  const r = await modelClassifier(good, "on-device", () => (t += 50)).classify(phishFeatures());
  assert.deepEqual(r, { verdict: "phishing", confidence: 0.88, reasons: ["fake login"], source: "on-device", latencyMs: 50 });
  assert.match(prompts[0], /Brands imitated in the web address, .*: Wells Fargo/);

  const bad: TextModel = { generate: async () => "Looks dodgy to me!" };
  await assert.rejects(modelClassifier(bad, "on-device").classify(phishFeatures()), /output rejected: no JSON/);
});

test("a reason-less Nano warning shows the rules' warning signs; a Nano 'safe' stays without reasons", async () => {
  const bare = (verdict: Verdict): Classifier => ({
    source: "on-device",
    classify: async () => ({ verdict, confidence: 0.9, reasons: [], source: "on-device", latencyMs: 1 }),
  });
  const warned = await triage(phishFeatures(), { local: bare("phishing") });
  assert.equal(warned.final.source, "on-device");
  assert.ok(warned.final.reasons.includes("Web address imitates a known brand"), warned.final.reasons.join("; "));
  const safe = await triage(benignFeatures(), { local: bare("safe") });
  assert.deepEqual(safe.final.reasons, []);
});

test("the on-device prompt can leave out reasons", async () => {
  const prompts: string[] = [];
  const model: TextModel = { generate: async (p) => (prompts.push(p), '{"verdict":"safe","confidence":0.9}') };
  const r = await modelClassifier(model, "on-device", undefined, { reasons: false }).classify(benignFeatures());
  assert.equal(r.verdict, "safe");
  assert.deepEqual(r.reasons, []);
  assert.doesNotMatch(prompts[0], /"reasons"/);
});

test("the report records exactly what was sent to the cloud, even when the call fails", async () => {
  const cloud = fake("cloud", "phishing", 0.95);
  const sent = await triage(phishFeatures(), { local: fake("on-device", "phishing", 0.4).classifier, cloud: cloud.classifier });
  assert.deepEqual(sent.sentToCloud, cloud.seen[0]);

  const confident = await triage(phishFeatures(), { local: fake("on-device", "phishing", 0.9).classifier, cloud: cloud.classifier });
  assert.equal(confident.sentToCloud, null);

  const failed = await triage(phishFeatures(), { local: fake("on-device", "phishing", 0.4).classifier, cloud: failing("cloud", "quota exceeded") });
  assert.ok(failed.sentToCloud, "a failed call still sent the features");
  assert.ok(!JSON.stringify(failed.sentToCloud).includes("jane.doe@gmail.com"));

  const noCloud = await triage(phishFeatures(), { local: fake("on-device", "phishing", 0.4).classifier });
  assert.equal(noCloud.sentToCloud, null);
});
