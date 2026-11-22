// Best-effort removal of personal data before features leave the device for the cloud
// model. Targets what phishing pages typically echo back: the victim's email (often in
// the URL), account/card/phone numbers, greeting names, and per-victim URL tokens.
// Known gaps: names outside greetings, street addresses, non-Latin scripts.

import type { PageFeatures } from "../shared/messages.ts";

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// A run of digits with common separators. Replaced only if it holds 9+ digits, which
// covers phone, card, account and SSN numbers while keeping prices, years and short dates.
const NUMBER_RUN_RE = /\+?\(?\d[\d\s().-]{6,}\d/g;
const GREETING_RE = /\b(Dear|Hi|Hello|Hey)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?/g;

const digitCount = (s: string) => (s.match(/\d/g) ?? []).length;

export function redactText(text: string): string {
  return text
    .replace(EMAIL_RE, "[email]")
    .replace(NUMBER_RUN_RE, (m) => (digitCount(m) >= 9 ? "[number]" : m))
    .replace(GREETING_RE, "$1 [name]");
}

function redactPathSegment(segment: string): string {
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // keep the raw segment
  }
  if (decoded.includes("@")) return "[email]";
  if (digitCount(decoded) >= 6) return "[id]";
  // Tokens: long, mixing letters and digits (hex ids, base64, session keys).
  if (decoded.length >= 16 && /\d/.test(decoded) && /[a-z]/i.test(decoded)) return "[id]";
  return segment;
}

/**
 * Keeps scheme, host and path shape (the useful phishing signals), drops credentials,
 * query string and fragment (where kits put victim emails and session tokens), and
 * masks id-like path segments. The presence of a query/fragment is kept as a marker.
 */
export function redactUrl(href: string): string {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return "[url]";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return `${url.protocol}[redacted]`;
  const path = url.pathname.split("/").map(redactPathSegment).join("/");
  return `${url.protocol}//${url.host}${path}${url.search ? "?[redacted]" : ""}${url.hash ? "#[redacted]" : ""}`;
}

/** Returns a copy safe to send to the cloud. The input is not modified. */
export function redactFeatures(features: PageFeatures): PageFeatures {
  const copy = structuredClone(features);
  copy.url = redactUrl(copy.url);
  copy.title = redactText(copy.title);
  copy.textSnippet = redactText(copy.textSnippet);
  copy.text.urgencyHits = copy.text.urgencyHits.map(redactText);
  copy.forms = copy.forms.map((f) => ({ ...f, action: f.action === null ? null : redactUrl(f.action) }));
  return copy;
}
