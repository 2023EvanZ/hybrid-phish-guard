// DOM layer: reads the page into plain descriptors for src/prefilter/signals.ts.
// Privacy rule: never read an input's value. Only attributes and visible page text.

import { registrableDomain } from "../prefilter/domains.ts";
import { decide, formSignals, textSignals, urlSignals } from "../prefilter/signals.ts";
import type { FieldDescriptor, FormDescriptor, PrefilterResult } from "../prefilter/signals.ts";
import type { LinkStats, PageFeatures } from "../shared/messages.ts";

const MAX_FORMS = 20;
const MAX_FIELDS_PER_FORM = 30;
const MAX_ORPHAN_FIELDS = 50;
const MAX_LINKS = 300;
const SCAN_TEXT_CHARS = 20_000;
// Roughly 400 tokens; the on-device model's whole budget is ~9k tokens.
export const SNIPPET_CHARS = 1_500;

const IGNORED_TYPES = new Set(["hidden", "submit", "button", "reset", "image", "checkbox", "radio", "file", "range", "color"]);

const attr = (el: Element, name: string) => (el.getAttribute(name) ?? "").trim();

function describeField(input: HTMLInputElement): FieldDescriptor {
  const label = input.labels?.[0]?.textContent ?? attr(input, "aria-label");
  return {
    type: attr(input, "type") || "text",
    name: attr(input, "name"),
    id: input.id,
    autocomplete: attr(input, "autocomplete"),
    placeholder: attr(input, "placeholder"),
    label: label.replace(/\s+/g, " ").trim().slice(0, 80),
  };
}

const relevant = (i: HTMLInputElement) => !IGNORED_TYPES.has((attr(i, "type") || "text").toLowerCase());

export function describeForms(doc: Document): FormDescriptor[] {
  const out: FormDescriptor[] = [];
  for (const form of Array.from(doc.forms).slice(0, MAX_FORMS)) {
    const fields = Array.from(form.querySelectorAll("input")).filter(relevant).slice(0, MAX_FIELDS_PER_FORM);
    if (!fields.length) continue;
    out.push({
      // getAttribute, not form.action / form.method: an <input name="action"> shadows
      // those properties (DOM clobbering), which a phishing page could use to hide
      // where it posts.
      action: form.hasAttribute("action") ? attr(form, "action") : null,
      method: attr(form, "method") || "get",
      fields: fields.map(describeField),
      synthetic: false,
    });
  }
  // SPAs often render login fields with no <form> and submit via fetch().
  const orphans = Array.from(doc.querySelectorAll("input"))
    .filter((i) => !i.closest("form") && relevant(i))
    .slice(0, MAX_ORPHAN_FIELDS);
  if (orphans.length) out.push({ action: null, method: "", fields: orphans.map(describeField), synthetic: true });
  return out;
}

const DOMAIN_IN_TEXT = /\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b/i;

export function linkStats(doc: Document, pageUrl: URL): LinkStats {
  const pageDomain = registrableDomain(pageUrl.hostname);
  const stats: LinkStats = { total: 0, external: 0, mismatchedText: 0 };
  for (const a of Array.from(doc.querySelectorAll<HTMLAnchorElement>("a[href]")).slice(0, MAX_LINKS)) {
    let href: URL;
    try {
      href = new URL(attr(a, "href"), pageUrl);
    } catch {
      continue;
    }
    if (href.protocol !== "http:" && href.protocol !== "https:") continue;
    stats.total++;
    const target = registrableDomain(href.hostname);
    if (target !== pageDomain) stats.external++;
    const shown = (a.textContent ?? "").match(DOMAIN_IN_TEXT)?.[1];
    if (shown && registrableDomain(shown) !== target) stats.mismatchedText++;
  }
  return stats;
}

/**
 * Cheap gate: URL + form attributes only, no layout. Runs on every DOM-mutation batch.
 */
export function quickDecision(doc: Document, href: string): PrefilterResult {
  const url = new URL(href);
  return decide(urlSignals(url), formSignals(describeForms(doc), url));
}

/**
 * Full feature extraction. Reads innerText (forces layout), so it only runs once a page
 * has passed the gate or the user asked for it.
 */
export function buildFeatures(doc: Document, href: string, opts: { force?: boolean } = {}): PageFeatures {
  const url = new URL(href);
  const u = urlSignals(url);
  const f = formSignals(describeForms(doc), url);
  const body = (doc.body?.innerText ?? "").replace(/\s+/g, " ").trim();
  const title = doc.title.trim().slice(0, 200);
  const t = textSignals(title, body.slice(0, SCAN_TEXT_CHARS), u.hostname);
  return {
    url: url.href,
    title,
    urlSignals: u,
    forms: f.forms,
    text: t,
    links: linkStats(doc, url),
    textSnippet: body.slice(0, SNIPPET_CHARS),
    prefilter: decide(u, f, t, opts),
    capturedAt: Date.now(),
  };
}
