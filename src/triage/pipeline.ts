// The triage pipeline: on-device first, redacted cloud escalation when the policy says
// so, deterministic rules when nothing else is available. Always returns a verdict.

import type { PageFeatures } from "../shared/messages.ts";
import { DEFAULT_POLICY, shouldEscalate } from "./policy.ts";
import type { EscalationDecision, PolicyConfig } from "./policy.ts";
import { redactFeatures } from "./redact.ts";
import { rulesVerdict } from "./rules.ts";
import type { Classifier, TriageResult } from "./types.ts";

export interface TriageDeps {
  local?: Classifier;
  cloud?: Classifier;
  policy?: PolicyConfig;
  /** The on-device model can stall (e.g. first download); don't block the verdict on it. */
  localTimeoutMs?: number;
  cloudTimeoutMs?: number;
}

export interface TriageReport {
  final: TriageResult;
  local: TriageResult | null;
  cloud: TriageResult | null;
  escalation: EscalationDecision;
  errors: string[];
}

export const DEFAULT_LOCAL_TIMEOUT_MS = 10_000;
export const DEFAULT_CLOUD_TIMEOUT_MS = 20_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function triage(features: PageFeatures, deps: TriageDeps = {}): Promise<TriageReport> {
  const errors: string[] = [];

  let local: TriageResult | null = null;
  if (deps.local) {
    try {
      local = await withTimeout(deps.local.classify(features), deps.localTimeoutMs ?? DEFAULT_LOCAL_TIMEOUT_MS, "on-device model");
    } catch (e) {
      errors.push(message(e));
    }
  }

  const escalation = shouldEscalate(local, features, deps.policy ?? DEFAULT_POLICY);
  if (!escalation.escalate && local) return { final: local, local, cloud: null, escalation, errors };

  let cloud: TriageResult | null = null;
  if (deps.cloud) {
    try {
      // Only redacted features ever leave the device.
      cloud = await withTimeout(deps.cloud.classify(redactFeatures(features)), deps.cloudTimeoutMs ?? DEFAULT_CLOUD_TIMEOUT_MS, "cloud model");
      return { final: cloud, local, cloud, escalation, errors };
    } catch (e) {
      errors.push(message(e));
    }
  }

  // Cloud unavailable. Keep the local verdict unless it is the one we distrusted: a
  // "safe" that contradicts strong heuristics falls back to the rules instead.
  const final = local && escalation.reason !== "contradicts-heuristics" ? local : rulesVerdict(features);
  return { final, local, cloud, escalation, errors };
}
