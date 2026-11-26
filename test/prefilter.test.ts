import { test } from "node:test";
import assert from "node:assert/strict";
import { isAllowlisted, isPrivateIp, registrableDomain } from "../src/prefilter/domains.ts";
import {
  classifyField,
  decide,
  formSignals,
  textSignals,
  urlSignals,
} from "../src/prefilter/signals.ts";
import type { FieldDescriptor, FormDescriptor } from "../src/prefilter/signals.ts";

const field = (over: Partial<FieldDescriptor>): FieldDescriptor => ({
  type: "text", name: "", id: "", autocomplete: "", placeholder: "", label: "", ...over,
});
const form = (fields: FieldDescriptor[], action: string | null = null, synthetic = false): FormDescriptor => ({
  action, method: "post", fields, synthetic,
});
const run = (href: string, forms: FormDescriptor[] = [], title = "", text = "") => {
  const url = new URL(href);
  const u = urlSignals(url);
  const f = formSignals(forms, url);
  return decide(u, f, textSignals(title, text, u.hostname));
};

test("registrableDomain groups subdomains and handles two-label suffixes", () => {
  assert.equal(registrableDomain("login.secure.example.com"), "example.com");
  assert.equal(registrableDomain("www.bbc.co.uk"), "bbc.co.uk");
  assert.equal(registrableDomain("example.com."), "example.com");
  assert.equal(registrableDomain("192.168.1.10"), "192.168.1.10");
});

test("allowlist skips trusted domains but never their user-content hosts", () => {
  assert.equal(isAllowlisted("www.wellsfargo.com"), true);
  assert.equal(isAllowlisted("accounts.google.com"), true);
  assert.equal(isAllowlisted("docs.google.com"), false);
  assert.equal(isAllowlisted("sites.google.com"), false);
  assert.equal(isAllowlisted("forms.office.com"), false);
  assert.equal(isAllowlisted("wellsfargo.com.evil.example"), false);
});

test("brand-in-host catches lookalikes without flagging innocent words", () => {
  assert.deepEqual(urlSignals(new URL("https://wellsfarg0-secure-login.example.ru/")).brandsInHost, ["Wells Fargo"]);
  assert.deepEqual(urlSignals(new URL("https://wells-fargo.verify-now.top/")).brandsInHost, ["Wells Fargo"]);
  assert.deepEqual(urlSignals(new URL("https://securepaypal-help.com/")).brandsInHost, ["PayPal"]);
  assert.deepEqual(urlSignals(new URL("https://appleid-unlock.net/")).brandsInHost, ["Apple"]);
  // Owned by the brand, or the brand name is only a substring of another word.
  assert.deepEqual(urlSignals(new URL("https://www.paypal.com/signin")).brandsInHost, []);
  assert.deepEqual(urlSignals(new URL("https://pineapple-recipes.com/")).brandsInHost, []);
  assert.deepEqual(urlSignals(new URL("https://purchase-orders.example.com/")).brandsInHost, []);
  assert.deepEqual(urlSignals(new URL("https://firstbank.example/")).brandsInHost, []);
});

test("classifyField reads attributes, never values", () => {
  assert.equal(classifyField(field({ type: "password" })), "password");
  assert.equal(classifyField(field({ autocomplete: "cc-number" })), "card");
  assert.equal(classifyField(field({ name: "cardNumber" })), "card");
  assert.equal(classifyField(field({ label: "Security code (CVV)" })), "card");
  assert.equal(classifyField(field({ id: "routingNumber" })), "bank");
  assert.equal(classifyField(field({ placeholder: "Social Security Number" })), "ssn");
  assert.equal(classifyField(field({ autocomplete: "one-time-code" })), "otp");
  assert.equal(classifyField(field({ type: "email" })), "identity");
  assert.equal(classifyField(field({ name: "q", placeholder: "Search" })), "other");
});

test("formSignals flags cross-origin and insecure credential forms only", () => {
  const page = new URL("https://shop.example.com/login");
  const pw = field({ type: "password" });

  assert.deepEqual(formSignals([form([pw], "https://collect.evil.example/p.php")], page).crossOriginHosts, ["collect.evil.example"]);
  // Same registrable domain (auth subdomain) is fine; relative actions are fine.
  assert.deepEqual(formSignals([form([pw], "https://auth.example.com/session")], page).crossOriginHosts, []);
  assert.deepEqual(formSignals([form([pw], "/session")], page).crossOriginHosts, []);
  // A search form posting elsewhere is not a credential form.
  assert.deepEqual(formSignals([form([field({ name: "q" })], "https://search.other.example/")], page).crossOriginHosts, []);
  assert.equal(formSignals([form([pw], "http://example.com/login")], page).hasInsecureAction, true);
  assert.deepEqual(formSignals([form([pw], "mailto:x@evil.example")], page).crossOriginHosts, ["mailto:"]);
});

test("decide: classic credential phish is checked with a high score", () => {
  const r = run(
    "https://wellsfarg0-secure-login.example.ru/verify",
    [form([field({ type: "email" }), field({ type: "password" })], "https://collect.evil.example/p.php")],
    "Wells Fargo Sign On",
    "Your account has been locked. Verify your identity within 24 hours.",
  );
  assert.equal(r.shouldCheck, true);
  for (const code of ["password-field", "cross-origin-form", "brand-in-host", "brand-text-mismatch", "urgency-language"] as const) {
    assert.ok(r.reasons.includes(code), `missing ${code}`);
  }
  assert.ok(r.score >= 10, `score ${r.score}`);
});

test("decide: ordinary pages without sensitive forms are skipped", () => {
  const r = run("https://news.example.com/article", [form([field({ name: "q" })])], "News", "PayPal reported earnings today.");
  assert.equal(r.shouldCheck, false);
});

test("decide: allowlisted login pages are skipped unless forced", () => {
  const url = new URL("https://connect.secure.wellsfargo.com/auth/login");
  const forms = formSignals([form([field({ type: "password" })])], url);
  assert.equal(decide(urlSignals(url), forms).shouldCheck, false);
  assert.deepEqual(decide(urlSignals(url), forms).reasons.slice(0, 1), ["allowlisted"]);
  assert.equal(decide(urlSignals(url), forms, undefined, { force: true }).shouldCheck, true);
});

test("decide: a strongly suspicious URL is checked even before any form appears", () => {
  assert.equal(run("https://paypal-account-verify.xyz/").shouldCheck, true);
  assert.equal(run("http://192.168.4.20/").shouldCheck, false); // IP alone is not enough
});

test("textSignals: email addresses and bare domains are not brand mentions", () => {
  const t = textSignals("Contact us", "Reply to jane.doe@gmail.com or visit help.apple.com/support", "shop.example.com");
  assert.deepEqual(t.brandsMentioned, []);
  assert.deepEqual(textSignals("", "Sign in with your Apple ID", "x.example").brandsMentioned, ["Apple"]);
});

test("decide: generic text signals raise the score but never open the gate", () => {
  const r = run("https://blog.example.com/", [], "Security alert", "Verify your account within 24 hours");
  assert.equal(r.shouldCheck, false);
  assert.ok(r.reasons.includes("urgency-language"));
});

test("decide: form and site builder pages are always checked, at no score cost", () => {
  const forms = run("https://docs.google.com/forms/d/e/abc/viewform", [form([field({ name: "entry.1" })])]);
  assert.equal(forms.shouldCheck, true);
  assert.equal(forms.score, 0);
  assert.ok(forms.reasons.includes("form-builder-host"));
  assert.equal(run("https://sites.google.com/view/anything/home").shouldCheck, true);
  assert.equal(run("https://forms.office.com/Pages/ResponsePage.aspx?id=x").shouldCheck, true);
  // A Google Doc or Sheet is not a form builder page.
  assert.equal(run("https://docs.google.com/document/d/abc/edit").shouldCheck, false);
});

test("scam scripts open the gate; mentions without the full script don't", () => {
  const tech = run("https://alert.example.com/", [], "", "Your computer is infected with spyware. Call support at 1-888-555-0147.");
  assert.equal(tech.shouldCheck, true);
  assert.ok(tech.reasons.includes("tech-support-pitch"));
  const crypto = run("https://x.example.com/", [], "", "Send 0.1 BTC to the address below and receive double back.");
  assert.ok(crypto.reasons.includes("crypto-giveaway"));
  const seed = run("https://x.example.com/", [], "", "Paste your 12 or 24 word phrase to sync.");
  assert.ok(seed.reasons.includes("seed-phrase-request"));

  // Half a script is not enough.
  assert.equal(run("https://x.example.com/", [], "", "A virus was detected in the wild last week.").shouldCheck, false);
  assert.equal(run("https://x.example.com/", [], "", "Never share your Secret Recovery Phrase.").shouldCheck, false);
  assert.equal(run("https://x.example.com/", [], "", "Bitcoin fell 4% on Tuesday.").shouldCheck, false);
  // Allowlisted sites stay skipped.
  assert.equal(run("https://www.youtube.com/watch?v=x", [], "", "Send 1 ETH and get 2x back!").shouldCheck, false);
});

test("a callback script opens the gate only on a page posing as a brand", () => {
  const script = "PayPal: your account has been locked after unusual activity. Call our team at 1-888-555-0143 to restore access.";
  const scam = run("https://account-help-center.com/case/1", [], "", script);
  assert.equal(scam.shouldCheck, true);
  assert.ok(scam.reasons.includes("callback-scam"));
  // The same words on the brand's own site are a help page, not a scam.
  const own = run("https://www.paypal.com/us/smarthelp/article/1", [], "", script);
  assert.ok(!own.reasons.includes("callback-scam"));
  // No brand named: not counted (a known gap, see eval held-out set 2).
  const noBrand = run("https://account-help-center.com/case/1", [], "", "Your card has been suspended. Call 1-866-555-0119 now.");
  assert.equal(noBrand.shouldCheck, false);
  // The phone number has to be in the sentence that says to call.
  const warning = run("https://news.example.com/a", [], "", "Scammers claim your PayPal account is locked and tell you to call a number. Report it to 919-555-0155.");
  assert.ok(!warning.reasons.includes("callback-scam"));
});

test("isPrivateIp: loopback, RFC 1918, link-local and IPv6 local ranges only", () => {
  for (const h of ["10.0.0.1", "127.0.0.1", "172.16.0.1", "172.31.255.1", "192.168.1.1", "169.254.1.1", "[::1]", "[fd12:3456::1]", "[fe80::1]"]) {
    assert.equal(isPrivateIp(h), true, h);
  }
  for (const h of ["172.32.0.1", "185.234.72.19", "8.8.8.8", "[2001:db8::1]", "router.localhost", "192.168.example.com"]) {
    assert.equal(isPrivateIp(h), false, h);
  }
});

test("decide: a router login on a private IP is checked but not scored as an IP/HTTP phish", () => {
  const lan = run("http://192.168.1.1/login.html", [form([field({ type: "password" })])]);
  assert.equal(lan.shouldCheck, true); // still reaches the model
  assert.deepEqual(lan.reasons, ["password-field", "private-network"]);
  const pub = run("http://185.234.72.19/login.php", [form([field({ type: "password" })])]);
  assert.ok(pub.reasons.includes("ip-host") && pub.reasons.includes("not-https"));
  assert.ok(pub.score > lan.score);
});
