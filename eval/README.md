# Evaluation set

64 hand-written, labeled page descriptions (32 phishing/scam, 32 benign) in
[cases/](cases), scored by `npm run eval`. Each case is a URL, title, visible text and
form field list; it is turned into `PageFeatures` by the same pure prefilter code the
content script runs, then passed through the prefilter gate and a classifier.

## What it is and isn't

- **A regression and comparison harness, not a real-world accuracy estimate.** The cases
  were written by the same people who wrote the heuristics, so the rules have a home
  advantage. Treat the numbers as relative (rules vs on-device vs cloud, before vs after
  a change), not as "the extension catches 75% of phishing".
- **Deliberately hard on both sides.** The phishing set includes pages the heuristics
  can't see (Google Forms/Sites, tech-support pop-ups with no form, seed-phrase pages).
  The benign set includes brands on domains the brand list doesn't know, legitimate
  cross-site form posts and a home router.
- **Benign cases are login-heavy.** Real browsing is mostly pages without forms, so the
  "benign pages checked" figure overstates how often the gate calls a model.
- No page was visited. Phishing hostnames are illustrative.

## Metrics

- **Gate**: share of pages the prefilter passes to a classifier. A page the gate skips
  gets no warning, so it counts as a "safe" prediction in the scores below.
- **Strict**: only a `phishing` verdict counts as a warning.
- **Lenient**: `suspicious` counts too (the UI warns on both).

## Baseline: rules fallback (2026-11-22)

| | Precision | Recall | F1 | FPR |
|---|---|---|---|---|
| Strict | 100% | 31.3% | 47.6% | 0% |
| Lenient | 66.7% | 75.0% | 70.6% | 37.5% |

Gate: 78.1% of phishing cases checked (7 never reach a classifier).

Where the rules fail:
- **Missed**: user-content hosts (3/3), tech-support scams (2/2), two of three crypto
  scams, and an OTP page whose host uses "bofa" rather than a listed brand keyword.
  All but the OTP page are skipped by the gate, so no model would see them either.
- **False alarms**: every brand on an unlisted domain (7/7: wellsfargoadvisors.com,
  dhl.de, appleinsider.com, ...), every legitimate cross-site form post (3/3), the home
  router, and one deeply nested enterprise login.

`test/eval-cases.test.ts` fails if a change drops below this baseline.
