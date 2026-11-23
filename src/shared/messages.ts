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
  /** In-page banner -> background: take the user away from this page. */
  | { type: "hpg/leave" };

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
