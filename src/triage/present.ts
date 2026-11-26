// How verdicts are shown to people. Pure, so the wording and the in-page notice policy are
// unit-tested and shared by the side panel and the in-page notice.

import { NANO_UNAVAILABLE } from "../shared/messages.ts";
import type { EscalationReason } from "./policy.ts";
import type { TriageReport } from "./pipeline.ts";
import type { TriageResult, Verdict, VerdictSource } from "./types.ts";

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
 * The instant warning shown from the rules alone while the models run. Only used for a
 * rules "phishing" (score 8+), which had no false alarms on the dev or held-out sets.
 */
export function pendingView(rules: TriageResult): VerdictView {
  const { tone, headline } = HEADLINE[rules.verdict];
  return { tone, headline, detail: "Found by the rule-based check", reasons: rules.reasons };
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
export function adviceFor(verdict: Verdict): string {
  return verdict === "phishing"
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

/** Whether anything about the page left the device, for the in-page card. */
export interface WhereView {
  leftDevice: boolean;
  text: string;
}

export const NOTHING_SENT: WhereView = { leftDevice: false, text: "Nothing about this page left your device." };
const REDACTED_SENT: WhereView = { leftDevice: true, text: "Only a summary of this page, with personal details removed, left your device." };

/** Based on sentToCloud, not the verdict's source: a cloud call that failed still sent
 *  the redacted summary, even though the verdict then came from Nano or the rules. */
export function whereView(report: TriageReport): WhereView {
  return report.sentToCloud != null ? REDACTED_SENT : NOTHING_SENT; // != null: reports stored before 0.0.6 lack the field
}

/** One sentence on how the verdict was reached, or null when there's nothing to add. */
export function provenanceNote(report: TriageReport): string | null {
  const { final, local, escalation, errors } = report;
  const noNano = errors.some((e) => e.includes(NANO_UNAVAILABLE));
  if (report.sentToCloud != null && !report.cloud) {
    // The cloud was asked but didn't answer, so the verdict fell back to Nano or the rules.
    const sent = noNano
      ? "Gemini Nano isn't available on this device, so this page was sent to the cloud"
      : `Sent to the cloud because ${ESCALATION_TEXT[escalation.reason]}`;
    return `${sent}, but no answer came back, so ${final.source === "on-device" ? "this is Gemini Nano's verdict" : "the rules decided"}.`;
  }
  if (final.source === "on-device") return null;
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
