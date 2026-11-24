// When is the on-device answer good enough, and when do we pay the privacy and latency
// cost of asking the cloud? Thresholds are parameters so they can later come from
// Firebase Remote Config and be tuned against the evaluation set.

import type { PageFeatures } from "../shared/messages.ts";
import type { TriageResult } from "./types.ts";

export interface PolicyConfig {
  /** Below this local confidence, ask the cloud. */
  minConfidence: number;
  /** A prefilter score this high makes a local "safe" verdict untrustworthy. */
  highRiskScore: number;
  /** Below this prefilter score, a local "phishing" verdict needs a second opinion. */
  lowRiskScore: number;
}

export const DEFAULT_POLICY: PolicyConfig = { minConfidence: 0.7, highRiskScore: 8, lowRiskScore: 4 };

export type EscalationReason =
  | "no-local-result" // local model missing, failed, or returned unparseable output
  | "low-confidence"
  | "suspicious" // the local model itself is unsure which way it goes
  | "contradicts-heuristics" // local says safe on a page the rules find very risky
  | "unsupported-phishing" // local says phishing on a page the rules find low-risk
  | "confident"; // no escalation

export interface EscalationDecision {
  escalate: boolean;
  reason: EscalationReason;
}

export function shouldEscalate(
  local: TriageResult | null,
  features: PageFeatures,
  config: PolicyConfig = DEFAULT_POLICY,
): EscalationDecision {
  if (!local) return { escalate: true, reason: "no-local-result" };
  // Checked before confidence: a confident "safe" on a page scoring this high is exactly
  // what a prompt injection in the page text would produce.
  if (local.verdict === "safe" && features.prefilter.score >= config.highRiskScore) {
    return { escalate: true, reason: "contradicts-heuristics" };
  }
  // The mirror image: a banner interrupts the user, so a "phishing" the rules see almost
  // no evidence for (e.g. an article *about* seed-phrase scams) gets a second opinion.
  // Costs a cloud call on low-signal phishing too, which the cloud handles well.
  if (local.verdict === "phishing" && features.prefilter.score < config.lowRiskScore) {
    return { escalate: true, reason: "unsupported-phishing" };
  }
  if (local.confidence < config.minConfidence) return { escalate: true, reason: "low-confidence" };
  if (local.verdict === "suspicious") return { escalate: true, reason: "suspicious" };
  return { escalate: false, reason: "confident" };
}
