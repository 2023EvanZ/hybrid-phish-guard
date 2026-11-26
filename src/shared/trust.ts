// "Trust this site": hostnames the user has said not to check automatically. Kept in
// chrome.storage.local (on this device, never synced or sent anywhere). Pure helpers here;
// the background is the only writer of new entries, and enforces mayTrust.

import type { TriageReport } from "../triage/pipeline.ts";

export const TRUSTED_KEY = "trustedSites";

/** The hostname a trust entry is keyed on: exact, lowercased, http(s) only. No wildcards,
 *  so trusting www.example.com doesn't cover example.com or evil.example.com.github.io. */
export function trustHost(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/** Only a "suspicious" verdict can be dismissed this way. A "phishing" verdict can't: one
 *  click shouldn't silence the warning that matters most. */
export const mayTrust = (report: TriageReport | null | undefined): boolean => report?.final.verdict === "suspicious";

/**
 * The hostname to trust for a request, or null to refuse. Allowed only for a stored
 * "suspicious" verdict, and only for the page that verdict was stored for, so a stale or
 * tampered request can't trust some other site.
 */
export function hostToTrust(stored: { url: string; triage: TriageReport } | undefined, pageUrl: string | undefined): string | null {
  const host = pageUrl ? trustHost(pageUrl) : null;
  if (!stored || !mayTrust(stored.triage) || host === null || trustHost(stored.url) !== host) return null;
  return host;
}

/** Reads the stored list, tolerating a missing or malformed value. */
export function parseTrusted(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((h): h is string => typeof h === "string") : [];
}

export const withHost = (list: string[], host: string): string[] => (list.includes(host) ? list : [...list, host].sort());
export const withoutHost = (list: string[], host: string): string[] => list.filter((h) => h !== host);
