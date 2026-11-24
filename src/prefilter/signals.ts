// Pure prefilter logic: turns plain descriptors (URL, form fields, page text) into
// signals and a check/skip decision. The DOM layer (src/content/extract.ts) builds the
// descriptors; nothing here touches the DOM, so it is unit-tested with node:test.

import {
  BRANDS,
  SUSPICIOUS_TLDS,
  brandOwnsHost,
  isAllowlisted,
  isFormBuilderPage,
  isIpHost,
  isPrivateIp,
  registrableDomain,
} from "./domains.ts";
import type { Brand } from "./domains.ts";

export type ReasonCode =
  | "allowlisted"
  | "password-field"
  | "payment-field"
  | "bank-or-ssn-field"
  | "otp-field"
  | "cross-origin-form"
  | "insecure-form"
  | "ip-host"
  | "private-network"
  | "punycode-host"
  | "brand-in-host"
  | "at-in-url"
  | "many-subdomains"
  | "long-host"
  | "many-hyphens"
  | "suspicious-tld"
  | "not-https"
  | "brand-text-mismatch"
  | "urgency-language"
  | "form-builder-host"
  | "tech-support-pitch"
  | "crypto-giveaway"
  | "seed-phrase-request";

// ---------------------------------------------------------------- fields & forms

export type FieldKind = "password" | "card" | "bank" | "ssn" | "otp" | "identity" | "other";

/** Attributes of one input. Never includes the input's value. */
export interface FieldDescriptor {
  type: string;
  name: string;
  id: string;
  autocomplete: string;
  placeholder: string;
  label: string;
}

export interface FormDescriptor {
  /** Raw action attribute, or null when absent (submits to the page itself). */
  action: string | null;
  method: string;
  fields: FieldDescriptor[];
  /** True for inputs that sit outside any <form> (common in SPAs), grouped together. */
  synthetic: boolean;
}

const CARD_RE = /card.?num|cc.?num|credit.?card|debit.?card|\bcvv|\bcvc|\bcsc\b|security.?code|expir/i;
const BANK_RE = /routing|account.?num|acct.?num|\biban\b|sort.?code/i;
const SSN_RE = /\bssn\b|social.?security/i;
const OTP_RE = /\botp\b|one.?time|verification.?code|auth.?code|\b2fa\b|\bmfa\b|passcode/i;
const IDENTITY_RE = /e-?mail|user.?name|login|user.?id/i;

export function classifyField(f: FieldDescriptor): FieldKind {
  const type = f.type.toLowerCase();
  const ac = f.autocomplete.toLowerCase();
  if (type === "password" || ac.includes("password")) return "password";
  if (ac.startsWith("cc-")) return "card";
  if (ac === "one-time-code") return "otp";

  const text = [f.name, f.id, f.placeholder, f.label].join(" ");
  if (CARD_RE.test(text)) return "card";
  if (SSN_RE.test(text)) return "ssn";
  if (BANK_RE.test(text)) return "bank";
  if (OTP_RE.test(text)) return "otp";
  if (type === "email" || ac === "username" || ac === "email" || IDENTITY_RE.test(text)) return "identity";
  return "other";
}

export interface FormSummary {
  /** Resolved action URL, or null when the form submits to the page itself. */
  action: string | null;
  method: string;
  crossOrigin: boolean;
  insecure: boolean;
  synthetic: boolean;
  fieldKinds: FieldKind[];
}

export interface FormSignals {
  hasPassword: boolean;
  hasPayment: boolean;
  hasBankOrSsn: boolean;
  hasOtp: boolean;
  crossOriginHosts: string[];
  hasInsecureAction: boolean;
  forms: FormSummary[];
}

function resolveAction(action: string | null, pageUrl: URL): URL | null {
  if (action === null || action.trim() === "") return null;
  try {
    return new URL(action, pageUrl);
  } catch {
    return null;
  }
}

export function formSignals(forms: FormDescriptor[], pageUrl: URL): FormSignals {
  const pageDomain = registrableDomain(pageUrl.hostname);
  const crossOriginHosts = new Set<string>();
  const out: FormSignals = {
    hasPassword: false,
    hasPayment: false,
    hasBankOrSsn: false,
    hasOtp: false,
    crossOriginHosts: [],
    hasInsecureAction: false,
    forms: [],
  };

  for (const form of forms) {
    const kinds = form.fields.map(classifyField);
    const sensitive = kinds.some((k) => k !== "identity" && k !== "other");
    out.hasPassword ||= kinds.includes("password");
    out.hasPayment ||= kinds.includes("card");
    out.hasBankOrSsn ||= kinds.includes("bank") || kinds.includes("ssn");
    out.hasOtp ||= kinds.includes("otp");

    const target = resolveAction(form.action, pageUrl);
    let crossOrigin = false;
    let insecure = false;
    if (target) {
      if (target.protocol === "http:" || target.protocol === "https:") {
        crossOrigin = registrableDomain(target.hostname) !== pageDomain;
        insecure = target.protocol === "http:";
      } else {
        // mailto:, data:, javascript: and friends: odd for a credential form.
        crossOrigin = true;
      }
    } else {
      insecure = pageUrl.protocol === "http:";
    }
    if (sensitive && crossOrigin && target) crossOriginHosts.add(target.hostname || target.protocol);
    if (sensitive && insecure) out.hasInsecureAction = true;

    out.forms.push({
      action: target ? target.href : null,
      method: form.method.toLowerCase(),
      crossOrigin,
      insecure,
      synthetic: form.synthetic,
      fieldKinds: kinds,
    });
  }
  out.crossOriginHosts = [...crossOriginHosts];
  return out;
}

// ---------------------------------------------------------------------- URL

export interface UrlSignals {
  hostname: string;
  registrableDomain: string;
  isHttps: boolean;
  isIp: boolean;
  /** A private-network IP (router, printer, local server). See isPrivateIp. */
  privateNetwork: boolean;
  isPunycode: boolean;
  hasAt: boolean;
  subdomainDepth: number;
  hyphenCount: number;
  suspiciousTld: boolean;
  /** Brands whose name appears in the hostname but which do not own it. */
  brandsInHost: string[];
  /** Google Forms/Sites or Microsoft Forms: always checked, see isFormBuilderPage. */
  formBuilder: boolean;
}

const LEET: Record<string, string> = { "0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "7": "t" };
const deLeet = (s: string) => s.replace(/[013457]/g, (c) => LEET[c] ?? c);

function hostMentionsBrand(tokens: string[], brand: Brand): boolean {
  // Candidates: each token and each pair of adjacent tokens ("wells" + "fargo"), raw
  // and de-leeted ("wellsfarg0" -> "wellsfargo").
  const candidates = new Set<string>();
  tokens.forEach((t, i) => {
    candidates.add(t);
    if (i + 1 < tokens.length) candidates.add(t + tokens[i + 1]);
  });
  for (const c of [...candidates]) candidates.add(deLeet(c));

  const keywords = brand.keywords.map((k) => k.replace(/\s+/g, ""));
  for (const c of candidates) {
    for (const k of keywords) {
      // Long names may sit anywhere in a token ("securepaypal"). Short names must start
      // the token, so "apple" matches "appleid" but not "pineapple", and "chase" does
      // not match "purchase".
      if (k.length >= 6 ? c.includes(k) : c === k || c.startsWith(k)) return true;
    }
  }
  return false;
}

export function urlSignals(url: URL): UrlSignals {
  const hostname = url.hostname.toLowerCase();
  const isIp = isIpHost(hostname);
  const domain = registrableDomain(hostname);
  const labels = hostname.split(".");
  const tokens = isIp ? [] : hostname.split(/[.\-_]+/).filter(Boolean);

  return {
    hostname,
    registrableDomain: domain,
    isHttps: url.protocol === "https:",
    isIp,
    privateNetwork: isIp && isPrivateIp(hostname),
    isPunycode: labels.some((l) => l.startsWith("xn--")),
    hasAt: url.username !== "" || url.password !== "",
    subdomainDepth: isIp ? 0 : labels.length - domain.split(".").length,
    hyphenCount: (hostname.match(/-/g) ?? []).length,
    suspiciousTld: !isIp && SUSPICIOUS_TLDS.has(labels[labels.length - 1]),
    brandsInHost: BRANDS.filter((b) => !brandOwnsHost(b, hostname) && hostMentionsBrand(tokens, b)).map(
      (b) => b.name,
    ),
    formBuilder: isFormBuilderPage(url),
  };
}

// ---------------------------------------------------------------------- text

export type ScamPattern = "tech-support-pitch" | "crypto-giveaway" | "seed-phrase-request";

export interface TextSignals {
  brandsMentioned: string[];
  /** Mentioned brands that do not own this page's host. */
  brandMismatch: string[];
  urgencyHits: string[];
  /** Scam scripts specific enough to open the gate without any form or URL signal. */
  scamPatterns: ScamPattern[];
}

const URGENCY_PATTERNS: RegExp[] = [
  /verify your (account|identity|information)/i,
  /(account|access) (has been|will be|is) (suspended|locked|disabled|limited|restricted|closed)/i,
  /within (24|48|72) hours/i,
  /unusual (sign-?in|login|activity)/i,
  /confirm your (password|payment|billing|identity)/i,
  /update your (payment|billing|card)/i,
  /(password|account) (has expired|will expire|expires)/i,
  /security alert/i,
  /final (notice|warning)/i,
  /(failure|failed) to (verify|comply)/i,
  /gift cards?/i,
  /wire transfer/i,
  /act (now|immediately)/i,
  /package (could not|couldn't) be delivered/i,
];

// Each scam needs two parts to match, so a page that merely mentions a virus, bitcoin
// or a recovery phrase doesn't count. Matching stays within a sentence: the gap between
// parts may not cross ".", "!" or "?", except a decimal point ("0.1 BTC").
const gap = (n: number) => `(?:[^.!?]|\\.(?=\\d)){0,${n}}`;
const re = (src: string) => new RegExp(src, "i");

const SCAM_PATTERNS: Record<ScamPattern, RegExp[]> = {
  // "Your computer is infected ... call support", the fake virus-alert script.
  "tech-support-pitch": [
    re(`\\b(computer|pc|device|system|windows|mac|browser)\\b${gap(40)}\\b(infected|blocked|locked|compromised|hacked)\\b|\\b(virus|spyware|trojan|malware)\\b${gap(20)}\\b(detected|found|alert)\\b`),
    re(`\\bcall\\b${gap(40)}\\b(support|helpline|help desk|technician|toll[- ]free|now|immediately)\\b|\\b\\d{3}[-. )]\\s?\\d{3}[-. ]\\d{4}\\b`),
  ],
  // "Send 0.1 BTC to this address and receive double back."
  "crypto-giveaway": [
    re(`\\bsend\\b${gap(40)}\\b(btc|eth|bitcoin|ethereum|usdt|sol|crypto)\\b${gap(80)}\\b(double|2x|twice|back)\\b`),
  ],
  // "Enter your Secret Recovery Phrase" / "paste your 12 or 24 word phrase".
  "seed-phrase-request": [
    re(`\\b(enter|paste|type|import|input|submit)\\b${gap(30)}\\b(recovery|seed|secret|mnemonic)\\s+phrase\\b|\\b(enter|paste|type|input|submit)\\b${gap(30)}\\b(12|24)\\b${gap(20)}\\bwords?\\b`),
  ],
};

export function scamPatterns(text: string): ScamPattern[] {
  return (Object.keys(SCAM_PATTERNS) as ScamPattern[]).filter((p) => SCAM_PATTERNS[p].every((re) => re.test(text)));
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function textSignals(title: string, text: string, hostname: string): TextSignals {
  const haystack = `${title}\n${text}`;
  // An address like jane@gmail.com or a link to apple.com is not the page posing as that
  // brand, so emails and domains are removed before looking for brand names.
  const prose = haystack.replace(/\S+@\S+/g, " ").replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\S*/gi, " ");
  const brandsMentioned = BRANDS.filter((b) =>
    b.keywords.some((k) => new RegExp(`\\b${escapeRe(k)}\\b`, "i").test(prose)),
  );
  return {
    brandsMentioned: brandsMentioned.map((b) => b.name),
    brandMismatch: brandsMentioned.filter((b) => !brandOwnsHost(b, hostname)).map((b) => b.name),
    urgencyHits: URGENCY_PATTERNS.flatMap((re) => {
      const m = haystack.match(re);
      return m ? [m[0]] : [];
    }),
    scamPatterns: scamPatterns(haystack),
  };
}

// ------------------------------------------------------------------ decision

export interface PrefilterResult {
  shouldCheck: boolean;
  /** Higher = more suspicious. For ordering and for the model prompt, not a verdict. */
  score: number;
  reasons: ReasonCode[];
}

/** URL-only score at or above which a page is checked even without a sensitive form. */
export const URL_ONLY_THRESHOLD = 3;

/**
 * The gate opens on a sensitive form, a risky URL, a form-builder page, or a specific scam
 * script in the text (tech-support pitch, crypto giveaway, seed-phrase request). Generic
 * text signals (brand mentions, pressure phrases) raise the score but never open the
 * gate: news and advice pages use the same words.
 */
export function decide(
  url: UrlSignals,
  forms: FormSignals,
  text?: TextSignals,
  opts: { force?: boolean } = {},
): PrefilterResult {
  const reasons: ReasonCode[] = [];
  let urlScore = 0;
  let score = 0;
  const add = (code: ReasonCode, points: number, isUrl = false) => {
    reasons.push(code);
    score += points;
    if (isUrl) urlScore += points;
  };

  const allowlisted = isAllowlisted(url.hostname);
  if (allowlisted) reasons.push("allowlisted");

  if (forms.hasPassword) add("password-field", 2);
  if (forms.hasPayment) add("payment-field", 2);
  if (forms.hasBankOrSsn) add("bank-or-ssn-field", 2);
  if (forms.hasOtp) add("otp-field", 1);
  if (forms.crossOriginHosts.length) add("cross-origin-form", 2);
  // Private-network devices (routers, printers) are plain-HTTP IP addresses by nature;
  // those signals only mean something on the public internet.
  const lan = url.privateNetwork;
  if (forms.hasInsecureAction && !lan) add("insecure-form", 2);

  if (lan) add("private-network", 0);
  else if (url.isIp) add("ip-host", 2, true);
  if (url.isPunycode) add("punycode-host", 2, true);
  if (url.brandsInHost.length) add("brand-in-host", 3, true);
  if (url.hasAt) add("at-in-url", 2, true);
  if (url.subdomainDepth >= 4) add("many-subdomains", 1, true);
  if (url.hostname.length > 40) add("long-host", 1, true);
  if (url.hyphenCount >= 3) add("many-hyphens", 1, true);
  if (url.suspiciousTld) add("suspicious-tld", 1, true);
  if (!url.isHttps && !lan) add("not-https", 1);
  if (url.formBuilder) add("form-builder-host", 0);

  if (text?.brandMismatch.length) add("brand-text-mismatch", 2);
  if (text?.urgencyHits.length) add("urgency-language", Math.min(text.urgencyHits.length, 3));
  for (const p of text?.scamPatterns ?? []) add(p, 3);

  const sensitiveForm = forms.hasPassword || forms.hasPayment || forms.hasBankOrSsn || forms.hasOtp;
  const scamText = Boolean(text?.scamPatterns.length);
  const passesGate = !allowlisted && (sensitiveForm || urlScore >= URL_ONLY_THRESHOLD || url.formBuilder || scamText);
  return { shouldCheck: Boolean(opts.force) || passesGate, score, reasons };
}
