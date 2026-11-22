import type { FormSummary, PrefilterResult, TextSignals, UrlSignals } from "../prefilter/signals.ts";

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
  | { type: "hpg/report"; report: PrefilterReport }
  | { type: "hpg/inspect" };

export const tabKey = (tabId: number) => `tab:${tabId}`;
