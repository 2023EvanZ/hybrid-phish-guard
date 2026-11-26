// Adapter from "a model that completes text" to a Classifier. The Firebase AI Logic
// implementation of TextModel plugs in here once the spike confirms it works in the
// side panel; until then tests use a scripted fake.
//
// PRIVACY: the on-device TextModel must be backed by InferenceMode.ONLY_ON_DEVICE, never
// PREFER_ON_DEVICE. PREFER silently falls back to the cloud with the *unredacted*
// prompt; escalation to the cloud must go through the pipeline, which redacts first.

import { parseVerdict } from "./parse.ts";
import { buildTriagePrompt } from "./prompt.ts";
import type { PromptOptions } from "./prompt.ts";
import type { Classifier, VerdictSource } from "./types.ts";

export interface TextModel {
  generate(prompt: string): Promise<string>;
}

export function modelClassifier(
  model: TextModel,
  source: Exclude<VerdictSource, "rules">,
  now: () => number = () => performance.now(),
  prompt: PromptOptions = {},
): Classifier {
  return {
    source,
    async classify(features) {
      const t0 = now();
      const text = await model.generate(buildTriagePrompt(features, prompt));
      const parsed = parseVerdict(text);
      // A short snippet of the raw output makes format failures diagnosable from an eval run.
      if (!parsed.ok) throw new Error(`${source} model output rejected: ${parsed.error} (output: ${JSON.stringify(text.slice(0, 80))})`);
      return { ...parsed.value, source, latencyMs: Math.round(now() - t0) };
    },
  };
}
