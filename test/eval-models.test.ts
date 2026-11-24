import { test } from "node:test";
import assert from "node:assert/strict";
import { isRateLimit, outcomesFor, predictionFor, report, runCase, withRetry } from "../eval/models.ts";
import type { EvalCase } from "../eval/case.ts";
import type { Classifier, TriageResult, Verdict } from "../src/triage/types.ts";
import type { PageFeatures } from "../src/shared/messages.ts";

const phish: EvalCase = {
  id: "p-test", label: "phishing", category: "brand-lookalike", note: "",
  url: "https://wellsfarg0-secure-login.example.ru/verify?user=jane.doe@gmail.com",
  title: "Wells Fargo Sign On",
  text: "Your account has been locked. Verify your identity within 24 hours. Contact jane.doe@gmail.com",
  forms: [{ action: "https://collect.example.ru/p.php", fields: ["user", "password"] }],
};
const skipped: EvalCase = {
  id: "b-test", label: "benign", category: "news", note: "",
  url: "https://news.example.org/story", title: "Markets", text: "Stocks rose on Tuesday.",
};

function fake(source: "on-device" | "cloud", verdict: Verdict, confidence: number, latencyMs = 5) {
  const seen: PageFeatures[] = [];
  const classifier: Classifier = {
    source,
    async classify(f) {
      seen.push(f);
      return { verdict, confidence, reasons: [], source, latencyMs } satisfies TriageResult;
    },
  };
  return { classifier, seen };
}

test("a case the gate skips calls no model and counts as unchecked for every system", async () => {
  const local = fake("on-device", "phishing", 0.9);
  const run = await runCase(skipped, { local: local.classifier });
  assert.equal(run.checked, false);
  assert.equal(local.seen.length, 0);
  assert.equal(predictionFor(run, "hybrid"), "unchecked");
  assert.equal(predictionFor(run, "on-device"), "unchecked");
});

test("the cloud model gets the redacted page; on-device gets the real one", async () => {
  const local = fake("on-device", "phishing", 0.95);
  const cloud = fake("cloud", "phishing", 0.95);
  await runCase(phish, { local: local.classifier, cloud: cloud.classifier });
  assert.ok(JSON.stringify(local.seen[0]).includes("jane.doe@gmail.com"));
  assert.ok(!JSON.stringify(cloud.seen[0]).includes("jane.doe@gmail.com"));
});

test("hybrid replays the recorded results through the real policy", async () => {
  const confident = await runCase(phish, { local: fake("on-device", "phishing", 0.95).classifier, cloud: fake("cloud", "safe", 0.9).classifier });
  assert.equal(confident.hybrid!.final.source, "on-device");
  assert.equal(confident.hybrid!.escalation.escalate, false);

  const unsure = await runCase(phish, { local: fake("on-device", "phishing", 0.4).classifier, cloud: fake("cloud", "phishing", 0.9).classifier });
  assert.equal(unsure.hybrid!.final.source, "cloud");
  assert.equal(unsure.hybrid!.escalation.reason, "low-confidence");
});

test("a local answer slower than the timeout is treated as a timeout by the hybrid replay", async () => {
  const run = await runCase(phish, {
    local: fake("on-device", "phishing", 0.95, 15_000).classifier,
    cloud: fake("cloud", "phishing", 0.9).classifier,
    localTimeoutMs: 10_000,
  });
  assert.equal(predictionFor(run, "on-device"), "phishing"); // the model itself was right
  assert.equal(run.hybrid!.final.source, "cloud");
  assert.match(run.hybrid!.errors[0], /timed out/);
});

test("a failed model call scores as no warning for that model, and unrun models are left out", async () => {
  const failing: Classifier = { source: "on-device", classify: async () => { throw new Error("no JSON object"); } };
  const run = await runCase(phish, { local: failing });
  assert.equal(predictionFor(run, "on-device"), "safe");
  assert.equal(outcomesFor([run], "cloud"), null);
  const r = report([run]);
  assert.equal(r.systems.cloud, undefined);
  assert.equal(r.local!.failures, 1);
  assert.deepEqual(r.local!.errors, [{ error: "no JSON object", count: 1 }]);
  assert.equal(r.hybrid.finalSource.rules, 1); // no local, no cloud -> rules
});

test("report computes escalation rate and confidence when right vs wrong", async () => {
  const runs = [
    await runCase(phish, { local: fake("on-device", "phishing", 0.9).classifier }),
    await runCase(phish, { local: fake("on-device", "safe", 0.8).classifier }),
    await runCase(skipped, { local: fake("on-device", "safe", 0.8).classifier }),
  ];
  const r = report(runs);
  assert.equal(r.hybrid.checked, 2);
  assert.equal(r.hybrid.escalationRate, 0.5); // the "safe" contradicts high heuristics
  assert.equal(r.local!.meanConfidenceRight, 0.9);
  assert.equal(r.local!.meanConfidenceWrong, 0.8);
  assert.equal(r.systems["on-device"]!.lenient.tp, 1);
  assert.equal(r.systems["on-device"]!.lenient.fn, 1);
});

test("withRetry retries rate limits only, then gives up", async () => {
  let calls = 0;
  const slept: number[] = [];
  const sleep = async (ms: number) => { slept.push(ms); };
  const ok = await withRetry(async () => {
    if (++calls < 3) throw new Error("[429] RESOURCE_EXHAUSTED");
    return "done";
  }, { retries: 3, delayMs: 100, isRetryable: isRateLimit, sleep });
  assert.equal(ok, "done");
  assert.deepEqual(slept, [100, 100]);

  calls = 0;
  await assert.rejects(withRetry(async () => { calls++; throw new Error("bad JSON"); }, { retries: 3, delayMs: 1, isRetryable: isRateLimit, sleep }));
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(withRetry(async () => { calls++; throw new Error("quota exceeded"); }, { retries: 2, delayMs: 1, isRetryable: isRateLimit, sleep }));
  assert.equal(calls, 3);
});
