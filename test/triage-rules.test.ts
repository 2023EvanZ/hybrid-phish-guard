import { test } from "node:test";
import assert from "node:assert/strict";
import { rulesVerdict } from "../src/triage/rules.ts";
import { benignFeatures, makeFeatures, phishFeatures } from "./helpers.ts";

test("rules: obvious phish is 'phishing' with the most telling reasons first", () => {
  const r = rulesVerdict(phishFeatures());
  assert.equal(r.verdict, "phishing");
  assert.equal(r.source, "rules");
  assert.deepEqual(r.reasons, [
    "Web address imitates a known brand",
    "Sensitive form submits to a different site",
    "Page names a brand it isn't hosted by",
  ]);
});

test("rules: a plain same-site login is 'suspicious' at most, never confident", () => {
  const r = rulesVerdict(benignFeatures());
  assert.notEqual(r.verdict, "phishing");
  assert.ok(r.confidence <= 0.75);
});

test("rules: no signals means 'safe' with a placeholder reason", () => {
  const r = rulesVerdict(makeFeatures({ url: "https://blog.example.com/" }));
  assert.equal(r.verdict, "safe");
  assert.deepEqual(r.reasons, ["No strong warning signs found"]);
});
