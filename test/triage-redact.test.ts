import { test } from "node:test";
import assert from "node:assert/strict";
import { redactFeatures, redactText, redactUrl } from "../src/triage/redact.ts";
import { phishFeatures } from "./helpers.ts";

test("redactText removes emails, long numbers and greeting names", () => {
  assert.equal(
    redactText("Dear Jane Doe, call 704-555-0199 or (704) 555 0199, card 4111 1111 1111 1111, SSN 123-45-6789, mail jane.doe+x@gmail.com"),
    "Dear [name], call [number] or [number], card [number], SSN [number], mail [email]",
  );
});

// Known trade-off: the greeting rule over-redacts ("Hello World Bank" loses "World Bank").
// Losing a little context is preferred to leaking a name.
test("redactText keeps prices, years and short dates; greeting rule errs towards redacting", () => {
  const s = "Pay $1,250.00 by 11/30/2026 or within 24 hours. Hello World Bank customers.";
  assert.equal(redactText(s), "Pay $1,250.00 by 11/30/2026 or within 24 hours. Hello [name] customers.");
});

test("redactUrl keeps host and path shape, drops query, fragment and credentials", () => {
  assert.equal(
    redactUrl("https://user:pw@login.evil.example/secure/verify?email=jane@gmail.com#c2Vzc2lvbg"),
    "https://login.evil.example/secure/verify?[redacted]#[redacted]",
  );
  assert.equal(redactUrl("https://evil.example/u/jane.doe%40gmail.com/step2"), "https://evil.example/u/[email]/step2");
  assert.equal(redactUrl("https://evil.example/s/8f3a9c2b7d1e4f60a1b2/login"), "https://evil.example/s/[id]/login");
  assert.equal(redactUrl("https://evil.example/acct/00012345678"), "https://evil.example/acct/[id]");
  assert.equal(redactUrl("https://evil.example/wells-fargo-login/index.html"), "https://evil.example/wells-fargo-login/index.html");
  assert.equal(redactUrl("mailto:jane@gmail.com"), "mailto:[redacted]");
  assert.equal(redactUrl("not a url"), "[url]");
});

test("redactFeatures leaves no personal data and does not mutate its input", () => {
  const original = phishFeatures();
  const before = JSON.stringify(original);
  const red = redactFeatures(original);
  const out = JSON.stringify(red);

  assert.equal(JSON.stringify(original), before);
  for (const pii of ["jane.doe@gmail.com", "Jane", "704-555-0199", "4111 1111", "c2Vzc2lvbg", "8f3a9c2b7d1e4f60a1b2"]) {
    assert.ok(!out.includes(pii), `leaked ${pii}`);
  }
  // The phishing evidence survives.
  assert.equal(red.urlSignals.registrableDomain, "example.ru");
  assert.deepEqual(red.urlSignals.brandsInHost, ["Wells Fargo"]);
  assert.equal(red.forms[0].action, "https://collect.evil.example/p.php?[redacted]");
  assert.match(red.textSnippet, /account has been locked/);
});
