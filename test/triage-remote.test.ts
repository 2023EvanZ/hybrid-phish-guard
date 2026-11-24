import { test } from "node:test";
import assert from "node:assert/strict";
import { modelClassifier } from "../src/triage/model.ts";
import { triage } from "../src/triage/pipeline.ts";
import { offscreenTextModel } from "../src/triage/remote.ts";
import type { OffscreenRequest } from "../src/shared/messages.ts";
import { phishFeatures } from "./helpers.ts";

const VERDICT = '{"verdict":"phishing","confidence":0.92,"reasons":["fake login"]}';

test("sends a generate request in the requested mode and returns the text", async () => {
  const sent: OffscreenRequest[] = [];
  const model = offscreenTextModel("on-device", async (req) => {
    sent.push(req);
    return { ok: true, text: VERDICT };
  });
  assert.equal(await model.generate("hello"), VERDICT);
  assert.deepEqual(sent, [{ target: "offscreen", type: "generate", mode: "on-device", prompt: "hello" }]);
});

test("surfaces offscreen errors and missing replies as failures", async () => {
  await assert.rejects(
    offscreenTextModel("cloud", async () => ({ ok: false, error: "AI/api-not-enabled" })).generate("x"),
    /cloud model: AI\/api-not-enabled/,
  );
  await assert.rejects(offscreenTextModel("on-device", async () => undefined).generate("x"), /no reply/);
  await assert.rejects(offscreenTextModel("on-device", async () => ({ ok: true })).generate("x"), /no reply/);
});

test("through the pipeline, the cloud mode only ever receives the redacted page", async () => {
  const prompts: Record<string, string[]> = { "on-device": [], cloud: [] };
  const send = async (req: OffscreenRequest) => {
    if (req.type !== "generate") throw new Error("unexpected");
    prompts[req.mode].push(req.prompt);
    // Low local confidence forces escalation.
    return { ok: true, text: req.mode === "on-device" ? '{"verdict":"phishing","confidence":0.3,"reasons":[]}' : VERDICT };
  };
  const r = await triage(phishFeatures(), {
    local: modelClassifier(offscreenTextModel("on-device", send), "on-device"),
    cloud: modelClassifier(offscreenTextModel("cloud", send), "cloud"),
  });
  assert.equal(r.final.source, "cloud");
  assert.equal(prompts["on-device"].length, 1);
  assert.equal(prompts.cloud.length, 1);
  assert.ok(prompts["on-device"][0].includes("jane.doe@gmail.com")); // local sees the real page
  assert.ok(!prompts.cloud[0].includes("jane.doe@gmail.com"));
  assert.ok(!prompts.cloud[0].includes("704-555-0199"));
});
