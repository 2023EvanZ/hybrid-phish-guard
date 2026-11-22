import { test } from "node:test";
import assert from "node:assert/strict";
import { isAllowlisted, registrableDomain } from "../src/prefilter/domains.ts";
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

test("decide: text signals raise the score but never open the gate", () => {
  const r = run("https://blog.example.com/", [], "Security alert", "Verify your account within 24 hours");
  assert.equal(r.shouldCheck, false);
  assert.ok(r.reasons.includes("urgency-language"));
});
