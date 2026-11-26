// The triage pipeline: on-device first, redacted cloud escalation when the policy says
// so, deterministic rules when nothing else is available. Always returns a verdict.

import type { PageFeatures } from "../shared/messages.ts";
import { DEFAULT_POLICY, shouldEscalate } from "./policy.ts";
import type { EscalationDecision, PolicyConfig } from "./policy.ts";
import { redactFeatures } from "./redact.ts";
import { NO_SIGNS, rulesVerdict } from "./rules.ts";
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
  /** Exactly what left the device: the redacted features given to the cloud model, or
   *  null when the cloud wasn't asked. Set before the call, so a cloud call that failed
   *  is still disclosed. The side panel's privacy view shows it. */
  sentToCloud: PageFeatures | null;
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

/**
 * Gemini Nano answers without reasons, to stay fast (see prompt.ts). When it warns, show
 * the rules engine's warning signs as the reasons; Nano explains itself on demand.
 */
function withSignals(local: TriageResult, features: PageFeatures): TriageResult {
  if (local.reasons.length || local.verdict === "safe") return local;
  const signals = rulesVerdict(features).reasons.filter((r) => r !== NO_SIGNS);
  return { ...local, reasons: signals };
}

export async function triage(features: PageFeatures, deps: TriageDeps = {}): Promise<TriageReport> {
  const errors: string[] = [];

  let local: TriageResult | null = null;
  if (deps.local) {
    try {
      const raw = await withTimeout(deps.local.classify(features), deps.localTimeoutMs ?? DEFAULT_LOCAL_TIMEOUT_MS, "on-device model");
      local = withSignals(raw, features);
    } catch (e) {
      errors.push(message(e));
    }
  }

  const escalation = shouldEscalate(local, features, deps.policy ?? DEFAULT_POLICY);
  if (!escalation.escalate && local) return { final: local, local, cloud: null, escalation, errors, sentToCloud: null };

  let cloud: TriageResult | null = null;
  let sentToCloud: PageFeatures | null = null;
  if (deps.cloud) {
    try {
      // Only redacted features ever leave the device.
      sentToCloud = redactFeatures(features);
      cloud = await withTimeout(deps.cloud.classify(sentToCloud), deps.cloudTimeoutMs ?? DEFAULT_CLOUD_TIMEOUT_MS, "cloud model");
      return { final: cloud, local, cloud, escalation, errors, sentToCloud };
    } catch (e) {
      errors.push(message(e));
    }
  }

  // Cloud unavailable. Keep the local verdict unless it is the one we distrusted: a
  // "safe" that contradicts strong heuristics falls back to the rules instead.
  const final = local && escalation.reason !== "contradicts-heuristics" ? local : rulesVerdict(features);
  return { final, local, cloud, escalation, errors, sentToCloud };
}
