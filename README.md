# Hybrid Phish Guard

A Chrome extension that warns you about phishing and scam pages using **on-device AI first**. The page you're looking at only leaves your machine when the local model is unsure, and then only after personal data has been stripped out.

> **Status: work in progress** for the #BuildHybridAI 2026 hackathon. The prefilter, page analysis, triage pipeline and redaction work and are tested. The Firebase AI Logic models are **not wired in yet**, so verdicts currently come from the rules fallback.

## Why

Phishing pages are built to fool people at the exact moment they're about to type a password. Cloud-based checkers see every page you visit; purely local checkers are fast and private, but small models make mistakes. Hybrid Phish Guard uses the local model for the common case and the cloud model only for the hard cases.

## How it works

```
page loads
  └─ prefilter (rules, no model)         skip pages with no login/payment form and no risky URL
       └─ feature extraction             URL, form targets, brands, pressure phrases, links, text snippet
            └─ on-device model           Gemini Nano via Firebase AI Logic, ONLY_ON_DEVICE
                 ├─ confident → verdict
                 └─ unsure → redact → cloud model (Gemini via Firebase AI Logic, ONLY_IN_CLOUD)
                                       └─ unavailable → rules fallback
```

- **Prefilter** ([src/prefilter](src/prefilter)): cheap URL, form and text checks run on every page. Catches brand lookalikes (`wellsfarg0-secure-login…`), credential forms that submit to a different site, raw IPs, punycode, and scam scripts that need no form (fake virus alerts, crypto giveaways, seed-phrase requests). A short allowlist skips big sites; Google Forms/Sites and Microsoft Forms pages, which are widely abused for phishing, are always checked. Page text for the gate is read without forcing layout.
- **Feature extraction** ([src/content](src/content)): reads form *attributes* only, never what you type. Watches for login forms that render late in single-page apps.
- **Triage** ([src/triage](src/triage)): a prompt sized for Gemini Nano's context window, a parser that tolerates the format drift small models produce, and an escalation policy.

### Privacy and safety design

- **No silent cloud fallback.** The on-device model runs in `ONLY_ON_DEVICE` mode, not `PREFER_ON_DEVICE`, because the latter would fall back to the cloud with the unredacted page. Escalation is explicit and always goes through redaction.
- **Redaction before the cloud** ([src/triage/redact.ts](src/triage/redact.ts)): emails, phone/card/account numbers, greeting names, URL query strings, fragments and per-victim URL tokens are removed. The phishing evidence (domain, path shape, form targets) is kept. This is best effort; names outside greetings and street addresses are not detected.
- **Prompt-injection guard.** Page text is marked untrusted in the prompt and cannot close its delimiter. If the local model still says "safe" on a page the rules score as high risk, the verdict is not trusted and is escalated.

## Development

Requires Node 22.18+ and Chrome 139+.

```bash
npm install
npm test        # unit tests (node:test, no extra dependencies)
npm run build   # type-check and build to dist/
npm run eval    # score the classifier on the labeled eval set (see eval/README.md)
```

Load `dist/` at `chrome://extensions` with Developer mode on (**Load unpacked**).

The Firebase-backed models need a Firebase project with AI Logic enabled on the Gemini Developer API. Copy `.env.example` to `.env`, fill in the web app config, and rebuild. App Check runs with a debug token during development.

### Testing in a normal browser tab

`test/fixtures/` holds sample pages (a fake bank login, a news article, a late-loading login form, a form that hides its destination) plus a stub for the extension APIs, so the built content script can be exercised on ordinary pages. `sidepanel-harness.html` renders the built side panel with a sample report. Serve the repository root over HTTP and open the fixtures under `*.localhost` hostnames, which Chrome resolves to your machine, e.g. `http://wellsfarg0-secure-login.localhost:8765/test/fixtures/phish-login.html`.

## License

[Apache-2.0](LICENSE)
