import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIDENCE, parseReasons, parseVerdict } from "../src/triage/parse.ts";

const ok = (text: string) => {
  const r = parseVerdict(text);
  assert.ok(r.ok, `expected ok, got: ${!r.ok && r.error}`);
  return r.value;
};
const err = (text: string) => {
  const r = parseVerdict(text);
  assert.equal(r.ok, false);
  return !r.ok ? r.error : "";
};

test("parses clean JSON", () => {
  assert.deepEqual(ok('{"verdict":"phishing","confidence":0.92,"reasons":["Fake bank login"]}'), {
    verdict: "phishing", confidence: 0.92, reasons: ["Fake bank login"],
  });
});

test("tolerates code fences and surrounding prose", () => {
  const v = ok('Sure! Here is my analysis:\n```json\n{"verdict": "Safe", "confidence": 0.8, "reasons": []}\n```\nHope this helps.');
  assert.equal(v.verdict, "safe");
});

test("maps synonyms and 0-100 confidence", () => {
  assert.equal(ok('{"verdict":"malicious","confidence":85}').verdict, "phishing");
  assert.equal(ok('{"verdict":"malicious","confidence":85}').confidence, 0.85);
  assert.equal(ok('{"verdict":"legitimate","confidence":"0.7"}').verdict, "safe");
  assert.equal(ok('{"verdict":"uncertain","confidence":0.4}').verdict, "suspicious");
});

test("missing confidence defaults low; reasons are normalised and capped", () => {
  const v = ok(`{"verdict":"phishing","reasons":"one reason","extra":1}`);
  assert.equal(v.confidence, DEFAULT_CONFIDENCE);
  assert.deepEqual(v.reasons, ["one reason"]);
  const many = ok(JSON.stringify({ verdict: "phishing", confidence: 1, reasons: ["a", "  b  ", 3, "", "c", "d", "x".repeat(500)] }));
  assert.deepEqual(many.reasons, ["a", "b", "c"]);
});

test("rejects output it cannot interpret", () => {
  assert.match(err("I think this page is probably phishing."), /no JSON/);
  assert.match(err('{"verdict": phishing}'), /not valid JSON/);
  assert.match(err('{"verdict":"maybe","confidence":0.5}'), /unrecognised verdict/);
  assert.match(err('{"verdict":"safe","confidence":250}'), /invalid confidence/);
  assert.match(err('{"verdict":"safe","confidence":-0.1}'), /invalid confidence/);
});

test("parseReasons reads an explanation and gives up quietly on anything else", () => {
  assert.deepEqual(parseReasons('{"reasons": ["Address misspells PayPal", "  Form sends to another site "]}'), [
    "Address misspells PayPal",
    "Form sends to another site",
  ]);
  assert.deepEqual(parseReasons("not json"), []);
  assert.deepEqual(parseReasons('{"verdict": "safe"}'), []);
});
