// "Report a mistake": the user marks a verdict as wrong (a false alarm, or a scam the
// extension missed). Reports stay in chrome.storage.local on this device; nothing is sent
// anywhere. They can be exported as draft eval cases in the same shape as eval/cases/,
// so real browsing can feed the eval set. Pure helpers here; the side panel is the writer.

import type { EvalCase, FieldSpec, FormSpec } from "../../eval/case.ts";
import type { FieldKind } from "../prefilter/signals.ts";
import type { TriageReport } from "../triage/pipeline.ts";
import { redactFeatures } from "../triage/redact.ts";
import type { Verdict, VerdictSource } from "../triage/types.ts";
import type { PageFeatures } from "./messages.ts";

export const MISTAKES_KEY = "mistakeReports";
/** Oldest reports are dropped past this, so the list can't grow without bound. */
export const MAX_MISTAKES = 50;

export type MistakeKind = "false-alarm" | "missed";

export interface MistakeReport {
  id: string;
  /** ISO time the report was made. */
  at: string;
  kind: MistakeKind;
  /** What the extension said, or null when the page wasn't checked. */
  verdict: Verdict | null;
  source: VerdictSource | null;
  /** The page as the cloud would see it: redacted, so even the local copy and any export
   *  carry no query strings, emails, long numbers or greeting names. */
  features: PageFeatures;
}

/** A warning the user says is wrong is a false alarm; anything else (safe, or never
 *  checked) that they report is a missed scam. */
export const mistakeKind = (verdict: Verdict | null): MistakeKind => (verdict === "phishing" || verdict === "suspicious" ? "false-alarm" : "missed");

export function makeMistake(features: PageFeatures, triage: TriageReport | null, now: Date, id: string): MistakeReport {
  const verdict = triage?.final.verdict ?? null;
  return { id, at: now.toISOString(), kind: mistakeKind(verdict), verdict, source: triage?.final.source ?? null, features: redactFeatures(features) };
}

const isReport = (r: unknown): r is MistakeReport => {
  const m = r as Partial<MistakeReport> | null;
  return Boolean(m && typeof m.id === "string" && typeof m.at === "string" && (m.kind === "false-alarm" || m.kind === "missed") && m.features && typeof m.features.url === "string");
};

/** Reads the stored list, newest first, tolerating a missing or malformed value. */
export function parseMistakes(value: unknown): MistakeReport[] {
  return Array.isArray(value) ? value.filter(isReport) : [];
}

/** Adds a report (newest first). A second report for the same address replaces the first. */
export function withMistake(list: MistakeReport[], report: MistakeReport): MistakeReport[] {
  return [report, ...list.filter((r) => r.features.url !== report.features.url)].slice(0, MAX_MISTAKES);
}

export const withoutMistake = (list: MistakeReport[], id: string): MistakeReport[] => list.filter((r) => r.id !== id);

export function mistakeHost(r: MistakeReport): string {
  try {
    return new URL(r.features.url).hostname;
  } catch {
    return r.features.url;
  }
}

/** Field shorthand (eval/case.ts) that the prefilter classifies back to the same kind. */
const FIELD_FOR: Record<FieldKind, FieldSpec> = {
  password: "password",
  card: "card",
  bank: "account",
  ssn: "ssn",
  otp: "otp",
  identity: "email",
  other: "text:field",
};

/** A fictional number (555-01xx is reserved for fiction) to stand in for a redacted phone. */
const FICTIONAL_PHONE = "1-800-555-0100";

/** YYYY-MM-DD in the user's own time zone (an ISO slice would be UTC, a day off in the evening). */
export const localDate = (d: Date): string => d.toLocaleDateString("en-CA");

const SOURCE_TEXT: Record<VerdictSource, string> = { "on-device": "Gemini Nano", cloud: "the cloud model", rules: "the rules" };

/** A draft eval case. Ids follow the eval set's convention (p- phishing, b- benign) and
 *  carry "user" so they're easy to tell apart. Review before adding: the page is redacted,
 *  and the user's label is a claim, not ground truth. */
export function toEvalCase(r: MistakeReport, index: number): EvalCase {
  const f = r.features;
  const label = r.kind === "missed" ? "phishing" : "benign";
  const slug = mistakeHost(r).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 40) || "page";
  const said = r.verdict ? `the extension said ${r.verdict} (${SOURCE_TEXT[r.source ?? "rules"]})` : "the extension didn't check it";
  const forms: FormSpec[] = f.forms.map((form) => ({
    ...(form.action === null ? {} : { action: form.action }),
    method: form.method,
    fields: form.fieldKinds.map((k) => FIELD_FOR[k]),
    ...(form.synthetic ? { synthetic: true } : {}),
  }));
  // Redaction turns phone numbers into [number], which would stop the callback-scam signal
  // from firing when the case is rebuilt. If the page tripped it, put a fictional one back.
  const callback = f.prefilter.reasons.includes("callback-scam") && f.textSnippet.includes("[number]");
  const text = callback ? f.textSnippet.replaceAll("[number]", FICTIONAL_PHONE) : f.textSnippet;
  const caveat = callback ? ` Redacted numbers replaced with ${FICTIONAL_PHONE} so the phone-number signal still fires.` : "";
  return {
    id: `${label === "phishing" ? "p" : "b"}-user-${slug}-${index + 1}`,
    label,
    category: "user-report",
    note: `Reported ${localDate(new Date(r.at))} as ${r.kind === "missed" ? "a missed scam" : "a false alarm"}: ${said}. Redacted; review before adding.${caveat}`,
    url: f.url,
    title: f.title,
    text,
    ...(forms.length ? { forms } : {}),
    links: f.links,
  };
}

/** The export file: draft cases plus what they were made from. */
export function exportMistakes(list: MistakeReport[], now: Date): string {
  return JSON.stringify(
    {
      format: "hybrid-phish-guard/mistakes@1",
      exportedAt: now.toISOString(),
      note: "Draft eval cases from user reports, redacted. Labels are the user's claim: review each before adding it to eval/cases/, and keep held-out sets frozen.",
      cases: list.map(toEvalCase),
      reports: list,
    },
    null,
    2,
  );
}
