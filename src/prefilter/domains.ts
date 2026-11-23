// Domain knowledge for the prefilter. Pure data + pure functions: no DOM, no chrome.*,
// so it runs in the content script and in node:test unchanged.

// Two-label public suffixes we care about. This is a deliberate approximation of the
// Public Suffix List (which is ~250 KB): good enough to group "login.example.co.uk"
// under "example.co.uk", wrong for exotic suffixes. Revisit if false positives show up.
const MULTI_PART_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au",
  "co.jp", "co.in", "co.nz", "co.za", "co.kr",
  "com.br", "com.cn", "com.mx", "com.sg", "com.tr", "com.hk",
]);

export function isIpHost(host: string): boolean {
  // URL.hostname gives IPv6 in brackets, e.g. "[::1]".
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[");
}

export function registrableDomain(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (isIpHost(host)) return host;
  const labels = host.split(".");
  if (labels.length <= 2) return host;
  const lastTwo = labels.slice(-2).join(".");
  return MULTI_PART_SUFFIXES.has(lastTwo) ? labels.slice(-3).join(".") : lastTwo;
}

export function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith("." + domain);
}

// Well-known sites whose own pages we skip. Kept short on purpose: every entry is a
// blind spot, so only sites where a hit would almost always be a false positive.
const ALLOWLIST = new Set([
  "google.com", "youtube.com", "gmail.com", "apple.com", "icloud.com",
  "microsoft.com", "live.com", "office.com", "microsoftonline.com", "outlook.com",
  "amazon.com", "paypal.com", "venmo.com", "stripe.com",
  "wellsfargo.com", "chase.com", "bankofamerica.com", "capitalone.com", "citi.com", "usbank.com",
  "github.com", "gitlab.com", "stackoverflow.com", "linkedin.com",
  "facebook.com", "instagram.com", "x.com", "twitter.com", "reddit.com",
  "wikipedia.org", "netflix.com", "notion.so", "slack.com", "zoom.us",
  "dropbox.com", "ebay.com", "walmart.com", "target.com", "coinbase.com",
  "anthropic.com", "claude.ai", "openai.com", "devpost.com",
]);

// Hosts under allowlisted domains that serve user-generated content and are heavily
// abused for phishing (Google Forms/Sites credential harvesting, Apps Script redirects,
// Microsoft Forms). These are never skipped even though their parent domain is trusted.
const USER_CONTENT_HOSTS = [
  "sites.google.com", "docs.google.com", "drive.google.com", "script.google.com",
  "forms.office.com", "forms.microsoft.com",
];

export function isAllowlisted(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (USER_CONTENT_HOSTS.some((h) => hostMatches(host, h))) return false;
  return ALLOWLIST.has(registrableDomain(host));
}

// Form and site builders on trusted domains, where a credential-harvesting page has no
// password field, no odd URL and a same-origin submit, so nothing else in the prefilter
// would notice it. Pages here are always checked; this adds no points to the score, so
// it costs a model call but never makes a page look suspicious on its own.
const FORM_BUILDER_HOSTS = ["sites.google.com", "forms.office.com", "forms.microsoft.com"];

export function isFormBuilderPage(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (FORM_BUILDER_HOSTS.some((h) => hostMatches(host, h))) return true;
  return host === "docs.google.com" && url.pathname.startsWith("/forms/");
}

export interface Brand {
  name: string;
  /** Lowercase; multi-word keywords are matched with and without spaces. */
  keywords: string[];
  /** Registrable domains (or hosts) the brand legitimately uses. */
  domains: string[];
}

// Frequently impersonated brands. Hand-picked, not exhaustive.
export const BRANDS: Brand[] = [
  { name: "PayPal", keywords: ["paypal"], domains: ["paypal.com"] },
  { name: "Apple", keywords: ["apple", "icloud", "appleid"], domains: ["apple.com", "icloud.com"] },
  { name: "Microsoft", keywords: ["microsoft", "office365", "outlook", "onedrive"], domains: ["microsoft.com", "live.com", "office.com", "microsoftonline.com", "outlook.com", "onedrive.com"] },
  { name: "Google", keywords: ["google", "gmail"], domains: ["google.com", "gmail.com", "youtube.com"] },
  { name: "Amazon", keywords: ["amazon"], domains: ["amazon.com", "amazon.co.uk", "amazon.ca", "amazon.de", "aws.amazon.com"] },
  { name: "Netflix", keywords: ["netflix"], domains: ["netflix.com"] },
  { name: "Wells Fargo", keywords: ["wells fargo", "wellsfargo"], domains: ["wellsfargo.com"] },
  { name: "Chase", keywords: ["chase"], domains: ["chase.com"] },
  { name: "Bank of America", keywords: ["bank of america", "bankofamerica"], domains: ["bankofamerica.com"] },
  { name: "USPS", keywords: ["usps"], domains: ["usps.com"] },
  { name: "FedEx", keywords: ["fedex"], domains: ["fedex.com"] },
  { name: "DHL", keywords: ["dhl"], domains: ["dhl.com"] },
  { name: "IRS", keywords: ["irs"], domains: ["irs.gov"] },
  { name: "Coinbase", keywords: ["coinbase"], domains: ["coinbase.com"] },
  { name: "MetaMask", keywords: ["metamask"], domains: ["metamask.io"] },
  { name: "DocuSign", keywords: ["docusign"], domains: ["docusign.com", "docusign.net"] },
  { name: "Dropbox", keywords: ["dropbox"], domains: ["dropbox.com"] },
  { name: "LinkedIn", keywords: ["linkedin"], domains: ["linkedin.com"] },
  { name: "Facebook", keywords: ["facebook"], domains: ["facebook.com"] },
  { name: "Instagram", keywords: ["instagram"], domains: ["instagram.com"] },
  { name: "Venmo", keywords: ["venmo"], domains: ["venmo.com"] },
  { name: "Zelle", keywords: ["zelle"], domains: ["zellepay.com"] },
  { name: "Steam", keywords: ["steam", "steamcommunity"], domains: ["steampowered.com", "steamcommunity.com"] },
];

export function brandOwnsHost(brand: Brand, hostname: string): boolean {
  const host = hostname.toLowerCase();
  return brand.domains.some((d) => hostMatches(host, d));
}

// Cheap TLDs that show up disproportionately in phishing reports. A weak signal only.
export const SUSPICIOUS_TLDS = new Set([
  "zip", "mov", "top", "xyz", "icu", "click", "link", "cfd", "sbs", "rest",
  "quest", "buzz", "cyou", "monster", "gq", "tk", "ml", "cf", "ga",
]);
