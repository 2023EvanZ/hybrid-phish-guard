// How verdicts are shown to people. Pure, so the wording and the banner policy are
// unit-tested and shared by the side panel and the in-page banner.

import type { EscalationReason } from "./policy.ts";
import type { TriageReport } from "./pipeline.ts";
import type { Verdict, VerdictSource } from "./types.ts";

export type Tone = "danger" | "warning" | "ok" | "neutral";

export interface VerdictView {
  tone: Tone;
  headline: string;
  /** e.g. "Rule-based check, 75% confident". */
  detail: string;
  reasons: string[];
}

const HEADLINE: Record<Verdict, { tone: Tone; headline: string }> = {
  phishing: { tone: "danger", headline: "This page looks like phishing" },
  suspicious: { tone: "warning", headline: "Be careful on this page" },
  safe: { tone: "ok", headline: "No warning signs found" },
};

const SOURCE: Record<VerdictSource, string> = {
  "on-device": "Checked on this device",
  cloud: "Checked in the cloud, with personal data removed",
  rules: "Rule-based check (no AI model)",
};

export const ESCALATION_TEXT: Record<EscalationReason, string> = {
  "no-local-result": "the on-device model gave no answer",
  "low-confidence": "the on-device model was unsure",
  suspicious: "the on-device model rated it suspicious",
  "contradicts-heuristics": "the on-device model's \"safe\" contradicted strong warning signs",
  confident: "the on-device model was confident",
};

export function verdictView(report: TriageReport): VerdictView {
  const { final } = report;
  const { tone, headline } = HEADLINE[final.verdict];
  return {
    tone,
    headline,
    detail: `${SOURCE[final.source]}, ${Math.round(final.confidence * 100)}% confident`,
    reasons: final.reasons,
  };
}

/**
 * The in-page banner interrupts the user, so it is reserved for "phishing". The rules
 * fallback rates about a third of benign login pages "suspicious" on the eval set;
 * bannering those would teach people to ignore the banner. "Suspicious" shows in the
 * toolbar badge and the side panel instead.
 */
export function shouldShowBanner(report: TriageReport): boolean {
  return report.final.verdict === "phishing";
}

export function badgeFor(report: TriageReport | undefined): { text: string; color: string } {
  switch (report?.final.verdict) {
    case "phishing":
      return { text: "!", color: "#dc2626" };
    case "suspicious":
      return { text: "?", color: "#d97706" };
    default:
      return { text: "", color: "#000000" };
  }
}
