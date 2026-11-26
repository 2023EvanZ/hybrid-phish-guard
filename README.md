# Hybrid Phish Guard

[![CI](https://github.com/2023EvanZ/hybrid-phish-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/2023EvanZ/hybrid-phish-guard/actions/workflows/ci.yml)

A Chrome extension that warns you about phishing and scam pages using **on-device AI first**. The page you're looking at only leaves your machine when the local model is unsure, and then only after personal data has been stripped out.

> **Status: work in progress** for the #BuildHybridAI 2026 hackathon. The prefilter, page analysis, triage pipeline and redaction are tested. Gemini Nano (on-device) and Gemini (cloud) run through Firebase AI Logic from an offscreen document; both work end to end in Chrome (real pages, in-page warning), and three model eval runs are recorded in [eval/README.md](eval/README.md).

## Try it

You need desktop Chrome 139 or newer.

1. Download `hybrid-phish-guard-<version>.zip` from the latest [release](../../releases) and unzip it.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick the unzipped folder.
3. Click the extension's toolbar icon to open the side panel. It shows the verdict for the current tab.

**Gemini Nano (on-device).** Chrome only runs Gemini Nano on machines that meet its hardware and disk-space requirements. To check, open the side panel, go to **Diagnostics**, and click **1**. If it says `downloadable`, click **2** to download the model; this can take several minutes. Without Gemini Nano everything still works, but every checked page goes to the cloud model, always with personal details removed, and the side panel says so.

**Demo pages.** These are harmless fake scam pages that run only on your machine; nothing is hosted publicly. Clone this repository, run `python3 -m http.server 8765` in its root, then open:

| Page | What it shows |
|---|---|
| `http://wellsfarg0-secure-login.localhost:8765/demo/phish-login.html` | A lookalike bank login that sends passwords to another site. Expect a red warning icon in the top-right corner; click it for the details. |
| `http://windows-security-alert.localhost:8765/demo/tech-support.html` | A fake virus alert with a phone number and no form. Expect a warning. |
| `http://account-help-center.localhost:8765/demo/callback-scam.html` | A fake "your account is locked, call this number" page posing as PayPal, with no form. Expect a warning. |
| `http://news.localhost:8765/demo/benign-article.html` | An ordinary article. Expect nothing on the page. |

Chrome sends any `*.localhost` address to your own machine, so the fake hostnames never reach the internet.

**Model eval.** In the side panel, go to **Diagnostics** and click **7**. This runs the 85 labeled cases through Gemini Nano, the cloud model and the hybrid pipeline. Allow about 6 minutes. See [eval/README.md](eval/README.md) for results and caveats.

**What the release does and doesn't do.**
- The zip calls the cloud model through this project's Firebase app.
- Firebase App Check is **not** enforced. An MV3 extension can't load reCAPTCHA, and a debug token can't safely ship in a public zip.
- The zip has no sourcemaps and no debug token; `scripts/package-release.ts` checks for both before zipping.

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

- **Prefilter** ([src/prefilter](src/prefilter)): cheap URL, form and text checks run on every page. Catches brand lookalikes (`wellsfarg0-secure-login…`), credential forms that submit to a different site, raw IPs, punycode, and scam scripts that need no form (fake virus alerts, crypto giveaways, seed-phrase requests, and "your account is locked, call this number" pages that pose as a brand). A short allowlist skips big sites; Google Forms/Sites and Microsoft Forms pages, which are widely abused for phishing, are always checked. Page text for the gate is read without forcing layout.
- **Feature extraction** ([src/content](src/content)): reads form *attributes* only, never what you type. Watches for login forms that render late in single-page apps.
- **Triage** ([src/triage](src/triage)): a prompt sized for Gemini Nano's context window, a parser that tolerates the format drift small models produce, and an escalation policy. The pipeline runs in the background service worker. The models run in an offscreen document ([src/offscreen.ts](src/offscreen.ts)), because Chrome's Prompt API isn't available in service workers; it only turns prompts into text, so redaction and parsing stay in the tested pipeline. Gemini Nano is warmed up when the document loads (first call ~8–16 s, then ~1 s).
- **Warnings**: an icon in the top-right corner of the page (in a closed shadow root, so the page can't restyle or rewrite it): red with a pulsing ring for "phishing", amber for "suspicious", nothing for "safe". Clicking it opens a card with the reasons, how the page was checked, **Full report** (opens the side panel) and, for phishing, **Leave this page**; the card can be minimized back to the icon or closed. It never opens by itself: the rules fallback rates about a third of benign login pages suspicious on the eval set, and interrupting on those would train people to ignore the warning. Phishing warnings are announced to screen readers.

### Privacy and safety design

- **No silent cloud fallback.** The on-device model runs in `ONLY_ON_DEVICE` mode, not `PREFER_ON_DEVICE`, because the latter would fall back to the cloud with the unredacted page. Escalation is explicit and always goes through redaction.
- **Redaction before the cloud** ([src/triage/redact.ts](src/triage/redact.ts)): emails, phone/card/account numbers, greeting names, URL query strings, fragments and per-victim URL tokens are removed. The phishing evidence (domain, path shape, form targets) is kept. This is best effort; names outside greetings and street addresses are not detected.
- **Prompt-injection guard.** Page text is marked untrusted in the prompt and cannot close its delimiter. If the local model still says "safe" on a page the rules score as high risk, the verdict is not trusted and is escalated.
- **Trust this site** ([src/shared/trust.ts](src/shared/trust.ts)): an amber ("suspicious") warning can be dismissed for good from the warning card or the side panel, and that site is no longer checked automatically ("Check this page now" still checks it). A red "phishing" warning can't be: the background, not the button, refuses unless the tab's stored verdict is "suspicious" and the site matches the page asking. Trust is per exact hostname (no wildcards), kept in `chrome.storage.local` on this device only, and listed in the side panel with a remove button. If a trusted site later scores high enough for the instant rules warning (say it was hacked), the red warning still shows.
- **Where this check ran** ([src/triage/privacy.ts](src/triage/privacy.ts)): the side panel shows each step (rules and Gemini Nano on this device, the cloud model only if asked) with its verdict and time, and either "Nothing left this device" or why the page went to the cloud. For a cloud check it shows every field redaction changed (original next to what was sent), what was replaced in the page text, the known redaction gaps, and the exact prompt sent. The pipeline records the redacted features before the cloud call, so a call that failed is still disclosed. A "never leaves this device" list covers form input, the URL query and fragment, text past 1,500 characters, and cookies, history and other tabs (the extension has no permission to read them).
- **Fast first answer.** A page the rules alone rate "phishing" gets the red icon at once, while the models are still checking; their verdict then updates or withdraws it. Gemini Nano answers with a verdict and confidence only, which keeps it quick, and explains itself on demand when you open the card (on-device, so that explanation sees the unredacted page and never leaves the machine).
- **Nano decides alone only when the evidence agrees.** A Nano "phishing" on a page the rules score under 5 goes to the cloud before any warning appears. So does a Nano "safe" on a page that asks for a password, card, bank details or a one-time code under a brand it isn't hosted by, which is where an unknown lookalike domain would be. Nano doesn't reliably catch one-letter typos.

## Development

Requires Node 22.18+ and Chrome 139+.

```bash
npm install
npm test        # unit tests (node:test, no extra dependencies)
npm run build   # type-check and build to dist/ (development: App Check debug mode, sourcemaps)
npm run build:release  # release build, checked and zipped to release/ (needs .env)
npm run eval    # score the classifier on the labeled eval set (see eval/README.md)
```

Load `dist/` at `chrome://extensions` with Developer mode on (**Load unpacked**).

The Firebase-backed models need a Firebase project with AI Logic enabled on the Gemini Developer API. Copy `.env.example` to `.env`, fill in the web app config, and rebuild. App Check runs with a debug token in development builds only; release builds never start App Check (see [Try it](#try-it)).

### CI and releases

GitHub Actions runs two workflows:

- **CI** (`.github/workflows/ci.yml`, every push and pull request): type-check, unit tests, the rules-engine eval, the development build, and the release build with its checks (using a placeholder Firebase config, so that zip is for inspection only). A second job scans for committed secrets with [gitleaks](https://github.com/gitleaks/gitleaks): new commits on every push and pull request, and the full git history weekly or when the workflow is run by hand.
- **Release** (`.github/workflows/release.yml`, on a `v*` tag): checks that the tag matches the manifest version, builds the release zip with the Firebase web config from repository secrets (`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`), and publishes it as a GitHub Release. The App Check debug token is never given to CI.

To cut a release: bump `version` in `public/manifest.json`, commit, then `git tag v<version> && git push origin v<version>`.

Actions are pinned to commit SHAs.

### Testing in a normal browser tab

`test/fixtures/` holds sample pages (a fake bank login, a news article, a late-loading login form, a form that hides its destination) plus a stub for the extension APIs, so the built content script can be exercised on ordinary pages. `sidepanel-harness.html` renders the built side panel with a sample report; `?state=` picks one (`phishing`, `suspicious`, `device`, `cloud`, `cloud-failed`, `skipped`, `trusted`, `none`). Serve the repository root over HTTP and open the fixtures under `*.localhost` hostnames, which Chrome resolves to your machine, e.g. `http://wellsfarg0-secure-login.localhost:8765/test/fixtures/phish-login.html`.

### Testing the installed extension

`demo/` holds the same sample pages without the API stub, for the real extension loaded from `dist/`. Serve the repository root (`python3 -m http.server 8765`) and open the pages listed under [Try it](#try-it).

## License

[Apache-2.0](LICENSE)
