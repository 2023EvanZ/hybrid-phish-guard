// When is the on-device answer good enough, and when do we pay the privacy and latency
// cost of asking the cloud? Thresholds are parameters so they can later come from
// Firebase Remote Config and be tuned against the evaluation set.

import type { ReasonCode } from "../prefilter/signals.ts";
import type { PageFeatures } from "../shared/messages.ts";
import type { TriageResult } from "./types.ts";

export interface PolicyConfig {
  /** Below this local confidence, ask the cloud. */
  minConfidence: number;
  /** A prefilter score this high makes a local "safe" verdict untrustworthy. */
  highRiskScore: number;
  /** Below this prefilter score, a local "phishing" verdict needs a second opinion. A
   * score of 4 is still "low" here: in eval run 3 Nano gave a confident "phishing" on two
   * legitimate score-4 pages whose forms post to a payment or auth provider. */
  lowRiskScore: number;
  /** Second-guess a local "safe" when the page asks for secrets under a brand it isn't hosted by. */
  brandCheck: boolean;
}

export const DEFAULT_POLICY: PolicyConfig = { minConfidence: 0.7, highRiskScore: 8, lowRiskScore: 5, brandCheck: true };

export type EscalationReason =
  | "no-local-result" // local model missing, failed, or returned unparseable output
  | "low-confidence"
  | "suspicious" // the local model itself is unsure which way it goes
  | "contradicts-heuristics" // local says safe on a page the rules find very risky
  | "unsupported-phishing" // local says phishing on a page the rules find low-risk
  | "unverified-brand" // local says safe on a page asking for secrets under a brand it isn't hosted by
  | "confident"; // no escalation

/** Form flags for data a phishing page wants. */
const SENSITIVE_FIELDS: ReadonlySet<ReasonCode> = new Set(["password-field", "payment-field", "bank-or-ssn-field", "otp-field"]);

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
  // A page that names a brand it isn't hosted by and asks for a password, card, bank or
  // one-time code is exactly where a lookalike domain the brand list doesn't know would
  // be (paypai.com). Nano doesn't reliably spot one-letter typos, and twice said "safe"
  // at 90% on paypai.com, so its "safe" there needs the cloud to agree. Legitimate pages
  // that trip this (a brand's own site on a domain the list doesn't know) cost one cloud
  // call on redacted features.
  if (
    config.brandCheck &&
    local.verdict === "safe" &&
    features.prefilter.reasons.includes("brand-text-mismatch") &&
    features.prefilter.reasons.some((r) => SENSITIVE_FIELDS.has(r))
  ) {
    return { escalate: true, reason: "unverified-brand" };
  }
  // The mirror image: a phishing warning interrupts the user, so a "phishing" the rules see almost
  // no evidence for (e.g. an article *about* seed-phrase scams) gets a second opinion.
  // Costs a cloud call on low-signal phishing too, which the cloud handles well.
  if (local.verdict === "phishing" && features.prefilter.score < config.lowRiskScore) {
    return { escalate: true, reason: "unsupported-phishing" };
  }
  if (local.confidence < config.minConfidence) return { escalate: true, reason: "low-confidence" };
  if (local.verdict === "suspicious") return { escalate: true, reason: "suspicious" };
  return { escalate: false, reason: "confident" };
}
