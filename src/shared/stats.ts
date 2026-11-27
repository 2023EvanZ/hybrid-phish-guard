// Privacy stats: how many pages the extension has looked at, and how many of those sent
// anything to the cloud. Counts only: no addresses, titles or verdicts are recorded.
// Kept in chrome.storage.local (this device, never synced or sent). Pure helpers here;
// the background is the only writer.

export const STATS_KEY = "privacyStats";

export interface PrivacyStats {
  /** Pages the extension looked at: every page the content script reported, whether the
   *  rules screened it out, the site was trusted, or it was fully checked. */
  pages: number;
  /** Of those, pages that sent a redacted summary to the cloud at least once. */
  sentPages: number;
  /** When counting started (install or the last reset), as an ISO date. */
  since: string;
}

export const emptyStats = (now: Date): PrivacyStats => ({ pages: 0, sentPages: 0, since: now.toISOString() });

const count = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0);

/** Reads the stored value, tolerating a missing or malformed one. */
export function parseStats(value: unknown, now: Date): PrivacyStats {
  if (!value || typeof value !== "object") return emptyStats(now);
  const v = value as Record<string, unknown>;
  const since = typeof v.since === "string" && !Number.isNaN(Date.parse(v.since)) ? v.since : now.toISOString();
  const pages = count(v.pages);
  return { pages, sentPages: Math.min(count(v.sentPages), pages), since };
}

/** Adds one event. A page is counted once however many reports it sends (a late login
 *  form, a manual re-check), and counted as sent once however many cloud calls it made. */
export function recordStats(stats: PrivacyStats, event: { newPage: boolean; newSend: boolean }): PrivacyStats {
  const pages = stats.pages + (event.newPage ? 1 : 0);
  return { ...stats, pages, sentPages: Math.min(stats.sentPages + (event.newSend ? 1 : 0), pages) };
}

/** What's been counted for one tab's current document. */
export interface CountedPage {
  gen: number;
  sent: boolean;
}

/** Decides what a report adds, given what was already counted for this tab. `gen` is the
 *  tab's navigation generation, so a new document in the same tab counts as a new page. */
export function pageEvent(prev: CountedPage | undefined, gen: number, sent: boolean): { next: CountedPage; newPage: boolean; newSend: boolean } {
  const newPage = prev?.gen !== gen;
  const sentBefore = !newPage && Boolean(prev?.sent);
  return { next: { gen, sent: sent || sentBefore }, newPage, newSend: sent && !sentBefore };
}

export interface StatsView {
  headline: string;
  detail: string;
}

const n = (x: number) => x.toLocaleString("en-US");
const plural = (x: number, one: string, many: string) => `${n(x)} ${x === 1 ? one : many}`;

export function statsView(stats: PrivacyStats): StatsView {
  const date = new Date(stats.since).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (stats.pages === 0) return { headline: "No pages looked at yet", detail: `Counting since ${date}.` };
  const stayed = stats.pages - stats.sentPages;
  const headline =
    stats.sentPages === 0
      ? `${plural(stats.pages, "page", "pages")} looked at, and nothing left this device`
      : `${plural(stats.pages, "page", "pages")} looked at; ${n(stayed)} never left this device`;
  const sent =
    stats.sentPages === 0
      ? "No page needed the cloud model."
      : `${plural(stats.sentPages, "page was", "pages were")} sent to the cloud as a summary with personal details removed.`;
  return { headline, detail: `Since ${date}. ${sent}` };
}
