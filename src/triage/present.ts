// How verdicts are shown to people. Pure, so the wording and the in-page notice policy are
// unit-tested and shared by the side panel and the in-page notice.

import { NANO_UNAVAILABLE } from "../shared/messages.ts";
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
  "unsupported-phishing": "the on-device model's \"phishing\" had little supporting evidence",
  "unverified-brand": "the page asks for sensitive details under a brand it isn't hosted by",
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
 * Whether the page gets the corner notice: an icon that expands into the full card on
 * click. Shown for "phishing" (red, with a pulsing ring) and "suspicious" (amber); "safe"
 * shows nothing. It never opens by itself: the rules fallback rates about a third of
 * benign login pages suspicious on the eval set, and interrupting on those would teach
 * people to ignore the warning.
 */
export function showsNotice(report: TriageReport): boolean {
  return report.final.verdict !== "safe";
}

/** One line of advice under the headline in the expanded notice. */
export function adviceFor(report: TriageReport): string {
  return report.final.verdict === "phishing"
    ? "Don't enter passwords, card numbers or codes here."
    : "Check the web address before entering anything sensitive.";
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

/** One sentence on how the verdict was reached, or null when there's nothing to add. */
export function provenanceNote(report: TriageReport): string | null {
  const { final, local, escalation, errors } = report;
  if (final.source === "on-device") return null;
  const noNano = errors.some((e) => e.includes(NANO_UNAVAILABLE));
  if (final.source === "cloud" && noNano) {
    return "Gemini Nano isn't available on this device, so this page was checked in the cloud with personal details removed.";
  }
  if (final.source === "cloud") return `Sent to the cloud because ${ESCALATION_TEXT[escalation.reason]}.`;
  if (local && escalation.reason === "contradicts-heuristics") {
    return "The on-device model said \"safe\" despite strong warning signs, so its answer wasn't trusted.";
  }
  if (errors.length) return `AI models unavailable (${errors.join("; ")}), so rules decided.`;
  return local ? null : "No AI model is connected yet, so rules decided.";
}
