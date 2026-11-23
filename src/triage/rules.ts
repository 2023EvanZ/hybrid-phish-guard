// Deterministic fallback classifier: turns the prefilter score into a verdict. Used when
// no model is available (no Firebase config, on-device model missing, cloud failed), so
// the pipeline always produces an answer. Deliberately conservative: it never claims
// high confidence, which keeps the escalation policy willing to ask a model.

import type { ReasonCode } from "../prefilter/signals.ts";
import type { PageFeatures } from "../shared/messages.ts";
import type { Classifier, TriageResult } from "./types.ts";

export const RULES_PHISHING_SCORE = 8;
export const RULES_SUSPICIOUS_SCORE = 4;

const REASON_TEXT: Partial<Record<ReasonCode, string>> = {
  "brand-in-host": "Web address imitates a known brand",
  "cross-origin-form": "Sensitive form submits to a different site",
  "insecure-form": "Sensitive form is sent without encryption",
  "brand-text-mismatch": "Page names a brand it isn't hosted by",
  "urgency-language": "Uses pressure tactics (deadlines, account threats)",
  "ip-host": "Hosted on a raw IP address",
  "punycode-host": "Web address uses lookalike characters",
  "at-in-url": "Web address hides the real destination",
  "password-field": "Asks for a password",
  "payment-field": "Asks for card details",
  "bank-or-ssn-field": "Asks for bank or Social Security numbers",
  "otp-field": "Asks for a one-time code",
  "suspicious-tld": "Uses a domain ending common in scams",
  "tech-support-pitch": "Fake virus alert telling you to call for help",
  "crypto-giveaway": "Promises to multiply crypto you send",
  "seed-phrase-request": "Asks for a wallet recovery phrase",
};

// Most telling first, so the top 3 are the ones worth showing.
const PRIORITY: ReasonCode[] = [
  "seed-phrase-request", "tech-support-pitch", "crypto-giveaway", "brand-in-host", "cross-origin-form", "brand-text-mismatch", "insecure-form", "punycode-host",
  "at-in-url", "ip-host", "urgency-language", "bank-or-ssn-field", "payment-field",
  "otp-field", "password-field", "suspicious-tld",
];

export function rulesVerdict(features: PageFeatures): TriageResult {
  const { score, reasons } = features.prefilter;
  const reasonText = PRIORITY.filter((r) => reasons.includes(r))
    .slice(0, 3)
    .map((r) => REASON_TEXT[r]!);

  if (score >= RULES_PHISHING_SCORE) {
    return { verdict: "phishing", confidence: 0.75, reasons: reasonText, source: "rules", latencyMs: 0 };
  }
  if (score >= RULES_SUSPICIOUS_SCORE) {
    return { verdict: "suspicious", confidence: 0.5, reasons: reasonText, source: "rules", latencyMs: 0 };
  }
  return {
    verdict: "safe",
    confidence: 0.6,
    reasons: reasonText.length ? reasonText : ["No strong warning signs found"],
    source: "rules",
    latencyMs: 0,
  };
}

export const rulesClassifier: Classifier = {
  source: "rules",
  classify: async (features) => rulesVerdict(features),
};
