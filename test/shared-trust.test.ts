import { test } from "node:test";
import assert from "node:assert/strict";
import type { TriageReport } from "../src/triage/pipeline.ts";
import { hostToTrust, mayTrust, parseTrusted, trustHost, withHost, withoutHost } from "../src/shared/trust.ts";
import type { Verdict } from "../src/triage/types.ts";

const report = (verdict: Verdict): TriageReport => ({
  final: { verdict, confidence: 0.6, reasons: [], source: "on-device", latencyMs: 1 },
  local: null,
  cloud: null,
  escalation: { escalate: false, reason: "confident" },
  errors: [],
  sentToCloud: null,
});
const stored = (verdict: Verdict, url = "https://Shop.Example.com/login?x=1") => ({ url, triage: report(verdict) });

test("trustHost: exact lowercased hostname, http(s) only", () => {
  assert.equal(trustHost("https://Shop.Example.com/login?x=1#y"), "shop.example.com");
  assert.equal(trustHost("http://192.168.1.1/"), "192.168.1.1");
  assert.equal(trustHost("chrome://settings"), null);
  assert.equal(trustHost("file:///tmp/a.html"), null);
  assert.equal(trustHost("not a url"), null);
});

test("only a suspicious verdict can be trusted, never phishing", () => {
  assert.equal(mayTrust(report("suspicious")), true);
  assert.equal(mayTrust(report("phishing")), false);
  assert.equal(mayTrust(report("safe")), false);
  assert.equal(mayTrust(undefined), false);
});

test("hostToTrust: the stored verdict and the requesting page must agree", () => {
  assert.equal(hostToTrust(stored("suspicious"), "https://shop.example.com/cart"), "shop.example.com");
  assert.equal(hostToTrust(stored("phishing"), "https://shop.example.com/cart"), null, "never for phishing");
  assert.equal(hostToTrust(undefined, "https://shop.example.com/"), null, "no verdict stored");
  assert.equal(hostToTrust(stored("suspicious"), "https://evil.example.net/"), null, "a different site");
  assert.equal(hostToTrust(stored("suspicious"), "https://example.com/"), null, "the parent domain is a different host");
  assert.equal(hostToTrust(stored("suspicious"), undefined), null);
});

test("the stored list: tolerant reads, no duplicates, sorted", () => {
  assert.deepEqual(parseTrusted(undefined), []);
  assert.deepEqual(parseTrusted("x"), []);
  assert.deepEqual(parseTrusted(["a.com", 3, null, "b.com"]), ["a.com", "b.com"]);
  assert.deepEqual(withHost(["b.com"], "a.com"), ["a.com", "b.com"]);
  assert.deepEqual(withHost(["a.com"], "a.com"), ["a.com"]);
  assert.deepEqual(withoutHost(["a.com", "b.com"], "a.com"), ["b.com"]);
});
