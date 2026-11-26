import type { FormSummary, PrefilterResult, TextSignals, UrlSignals } from "../prefilter/signals.ts";
import type { TriageReport } from "../triage/pipeline.ts";

export interface LinkStats {
  total: number;
  /** Links whose registrable domain differs from the page's. */
  external: number;
  /** Links whose visible text names a domain other than where they actually go. */
  mismatchedText: number;
}

/** Everything the model will see about a page. Built locally; contains no input values. */
export interface PageFeatures {
  url: string;
  title: string;
  urlSignals: UrlSignals;
  forms: FormSummary[];
  text: TextSignals;
  links: LinkStats;
  /** Collapsed visible text, capped so the on-device prompt stays within its token limit. */
  textSnippet: string;
  prefilter: PrefilterResult;
  capturedAt: number;
}

/** What the content script reports for every page it runs on. */
export interface PrefilterReport {
  url: string;
  prefilter: PrefilterResult;
  /** Present only when the prefilter decided the page should be checked (or it was forced). */
  features?: PageFeatures;
}

export type HpgMessage =
  /** Content script -> background. Answered with a ReportReply. */
  | { type: "hpg/report"; report: PrefilterReport; manual?: boolean }
  /** Side panel -> content script. Answered with the forced PrefilterReport. */
  | { type: "hpg/inspect" }
  /** In-page notice -> background: take the user away from this page. */
  | { type: "hpg/leave" }
  /** In-page notice's "Full report" button -> background: open the side panel. Answered with { opened }. */
  | { type: "hpg/open-panel" }
  /** In-page notice opened on an on-device verdict -> background: ask Gemini Nano why.
   *  Answered with ExplainReply. */
  | { type: "hpg/explain" }
  /** Side panel diagnostics -> background: create the offscreen document and probe it. */
  | { type: "hpg/probe-offscreen" }
  /** Model eval page -> background: forward one request to the offscreen document. */
  | { type: "hpg/model"; req: OffscreenRequest };

/** The verdict for a reported page, or null when the page wasn't checked. */
export interface ReportReply {
  verdict: TriageReport | null;
}

export interface StoredVerdict {
  url: string;
  manual: boolean;
  triage: TriageReport;
}

export const tabKey = (tabId: number) => `tab:${tabId}`;
export const verdictKey = (tabId: number) => `verdict:${tabId}`;

// --- Offscreen document (hosts the Firebase models; the Prompt API isn't exposed in
// service workers). Only the background talks to it. Content scripts' runtime messages
// also reach every extension page, so the offscreen side ignores anything without
// `target: "offscreen"`.

/** "on-device" is ONLY_ON_DEVICE; "cloud" is ONLY_IN_CLOUD. There is no PREFER mode. */
export type ModelMode = "on-device" | "cloud";

export type OffscreenRequest =
  | { target: "offscreen"; type: "generate"; mode: ModelMode; prompt: string }
  /** On-device only: a prompt answered with {"reasons": [...]} (buildExplainPrompt). */
  | { target: "offscreen"; type: "explain"; prompt: string }
  | { target: "offscreen"; type: "probe" };

export interface ExplainReply {
  reasons: string[] | null;
}

export type GenerateReply = { ok: true; text: string } | { ok: false; error: string };

export interface ProbeReply {
  /** Is the LanguageModel global defined in the offscreen document? */
  languageModelGlobal: boolean;
  availability: string | null;
  /** Result of the warm-up run at load: how long it took, or why it failed. */
  warmup: { ms: number } | { error: string } | "pending";
  /** A fresh tiny on-device call made for the probe. */
  probe: { ms: number; text: string } | { error: string };
}

/** Error prefix for a device without a ready Gemini Nano; the side panel keys on it. */
export const NANO_UNAVAILABLE = "Gemini Nano isn't available";
