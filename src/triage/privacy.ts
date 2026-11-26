// The side panel's "Where this check ran" view: which steps ran on this device, whether
// anything went to the cloud and why, and exactly what was sent. Pure, so the wording and
// the redaction summary are unit-tested.

import { SNIPPET_CHARS } from "../content/extract.ts";
import { NANO_UNAVAILABLE } from "../shared/messages.ts";
import type { PageFeatures } from "../shared/messages.ts";
import type { TriageReport } from "./pipeline.ts";
import { ESCALATION_TEXT } from "./present.ts";
import { CLOUD_PROMPT, buildTriagePrompt } from "./prompt.ts";
import type { TriageResult } from "./types.ts";

export type Where = "device" | "cloud";

export interface Step {
  name: string;
  where: Where;
  /** What the step found, e.g. "Phishing, 95% confident, 1.8 s". */
  result: string;
  /** False for a step that didn't run (no cloud call, no Nano on this device). */
  ran: boolean;
}

/** One field that was changed before it left the device. */
export interface Redaction {
  field: string;
  onPage: string;
  sent: string;
}

export interface PrivacyView {
  leftDevice: boolean;
  headline: string;
  /** Why the cloud was or wasn't asked. */
  why: string;
  steps: Step[];
  /** Only when something was sent: what changed, and the exact prompt. */
  sent: {
    redactions: Redaction[];
    /** e.g. "2 email addresses, 1 long number, 1 name". Empty when nothing matched. */
    removedFromText: string;
    prompt: string;
  } | null;
}

/** What a cloud check sends, in plain words. Matches redactFeatures and buildTriagePrompt. */
export const SENT_SUMMARY =
  "The web address without anything after ? or #, the page title, where each form sends data and what kinds of fields it has (never what's typed in them), the warning signs, and the start of the page's visible text. Email addresses, long numbers (phone, card, account) and names after a greeting are replaced first.";

/** Known gaps in redact.ts, said plainly rather than implying the redaction is complete. */
export const REDACTION_GAPS = "Not caught: names that don't follow a greeting, street addresses, and text in non-Latin scripts.";

/** Never leaves the device, on any path. Each line is backed by the code: extract.ts never
 *  reads field values; the manifest has no cookies, history or tabs permission; redactUrl
 *  drops the query and fragment; extract.ts caps the text at SNIPPET_CHARS. */
export const NEVER_SENT = [
  "Anything typed into the page's forms. The extension never reads field values.",
  "The part of the web address after ? or #, where phishing kits put your email and session tokens.",
  `Page text beyond the first ${SNIPPET_CHARS.toLocaleString("en-US")} characters.`,
  "Cookies, saved passwords, browsing history and other tabs. The extension has no permission to read them.",
];

const pct = (c: number) => `${Math.round(c * 100)}% confident`;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const describeResult = (r: TriageResult) => `${cap(r.verdict)}, ${pct(r.confidence)}, ${secs(r.latencyMs)}`;

function nanoStep(report: TriageReport): Step {
  const name = "Gemini Nano";
  if (report.local) return { name, where: "device", result: describeResult(report.local), ran: true };
  if (report.errors.some((e) => e.includes(NANO_UNAVAILABLE))) return { name, where: "device", result: "Not available on this device", ran: false };
  return { name, where: "device", result: "No answer", ran: false };
}

function cloudStep(report: TriageReport): Step {
  const name = "Cloud model";
  if (!report.sentToCloud) return { name, where: "cloud", result: "Not used", ran: false };
  if (report.cloud) return { name, where: "cloud", result: describeResult(report.cloud), ran: true };
  // The redacted features went out, but no answer came back: still disclosed.
  return { name, where: "cloud", result: "Sent, but no answer came back", ran: true };
}

const PLACEHOLDERS: [token: string, one: string, many: string][] = [
  ["[email]", "email address", "email addresses"],
  ["[number]", "long number", "long numbers"],
  ["[name]", "name", "names"],
];

const occurrences = (s: string, token: string) => s.split(token).length - 1;

/** Counts the placeholders redaction added to the page text and pressure phrases. */
function removedFromText(original: PageFeatures, sent: PageFeatures): string {
  const before = [original.textSnippet, ...original.text.urgencyHits].join("\n");
  const after = [sent.textSnippet, ...sent.text.urgencyHits].join("\n");
  return PLACEHOLDERS.map(([token, one, many]) => {
    const n = occurrences(after, token) - occurrences(before, token);
    return n > 0 ? `${n} ${n === 1 ? one : many}` : null;
  })
    .filter((x): x is string => x !== null)
    .join(", ");
}

function redactions(original: PageFeatures, sent: PageFeatures): Redaction[] {
  const out: Redaction[] = [];
  if (original.url !== sent.url) out.push({ field: "Web address", onPage: original.url, sent: sent.url });
  if (original.title !== sent.title) out.push({ field: "Title", onPage: original.title, sent: sent.title });
  original.forms.forEach((form, i) => {
    const after = sent.forms[i]?.action ?? null;
    if (form.action !== null && form.action !== after) {
      out.push({ field: original.forms.length > 1 ? `Form ${i + 1} destination` : "Form destination", onPage: form.action, sent: after ?? "" });
    }
  });
  return out;
}

export function privacyView(features: PageFeatures, report: TriageReport): PrivacyView {
  const steps: Step[] = [
    { name: "Rule-based check", where: "device", result: `Risk score ${features.prefilter.score}`, ran: true },
    nanoStep(report),
    cloudStep(report),
  ];
  const sent = report.sentToCloud;
  if (!sent) {
    const why = report.local
      ? "Gemini Nano was confident, so the cloud wasn't asked."
      : "No AI model answered and the cloud wasn't used, so the rules decided.";
    return { leftDevice: false, headline: "Nothing left this device", why, steps, sent: null };
  }
  const noNano = report.errors.some((e) => e.includes(NANO_UNAVAILABLE));
  const why = noNano
    ? "Sent because Gemini Nano isn't available on this device."
    : `Sent because ${ESCALATION_TEXT[report.escalation.reason]}.`;
  return {
    leftDevice: true,
    headline: "Sent to the cloud, with personal details removed",
    why,
    steps,
    sent: {
      redactions: redactions(features, sent),
      removedFromText: removedFromText(features, sent),
      prompt: buildTriagePrompt(sent, CLOUD_PROMPT),
    },
  };
}
