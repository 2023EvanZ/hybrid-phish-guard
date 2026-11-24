# Evaluation set

70 hand-written, labeled page descriptions (32 phishing/scam, 38 benign) in
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

## Models: Gemini Nano, cloud Gemini, hybrid (2026-11-23)

Run in Chrome 157 from the model eval page (side panel → Diagnostics → 7). Raw output:
[results/2026-11-23-models.json](results/2026-11-23-models.json). One run; model output
varies between runs, and with 38 benign cases one false alarm moves FPR by 2.6 points.

| System | Strict precision | Strict recall | Lenient precision | Lenient recall | Lenient F1 | Lenient FPR |
|---|---|---|---|---|---|---|
| Rules only | 100% | 34.4% | 71.4% | 93.8% | 81.1% | 31.6% |
| Gemini Nano (on-device) | 93.9% | 96.9% | 54.2% | 100% | 70.3% | 71.1% |
| Gemini (cloud, redacted) | 100% | 96.9% | 94.1% | 100% | 97.0% | 5.3% |
| **Hybrid (what users see)** | 93.9% | 96.9% | 91.4% | 100% | 95.5% | 7.9% |

- **Latency**: Nano mean 3.0 s, max 4.3 s (warm; well under the 10 s timeout); cloud
  mean 1.6 s, max 8.8 s. 1 of 63 Nano answers was unparseable; no cloud failures.
- **Escalation**: 27 of 63 checked pages (43%) went to the cloud: 24 because Nano said
  "suspicious", 2 low confidence, 1 unparseable.
- **Nano almost never says "safe"** (3 of 31 checked benign pages). It says "phishing"
  on phishing and "suspicious" on nearly everything else, so in practice Nano *catches*
  and the cloud *clears*. The 43% escalation rate is a product of the 50/50 eval mix:
  on real traffic, where checked pages are mostly legitimate logins, most checks would
  go to the cloud (redacted). This is the main thing to fix in the prompt.
- **Hybrid false alarms come from confident Nano mistakes**, which skip the cloud:
  the home router (Nano "phishing" 95%: HTTP + IP address + password) and a MetaMask
  help article that explains seed phrases (Nano "phishing" 90%, cloud "safe" 95%). Both
  would show the banner. The third, a hyphenated credit union login, is "suspicious"
  from both models.
- **Strict miss**: the Microsoft Forms password-reset page is "suspicious" from both
  models (badge, no banner).
- Confidence carries some signal (Nano 93% mean when right vs 74% when wrong), but Nano
  uses a few fixed values (0.95, 0.7, ...), so thresholds can only be coarse.

## Baseline: rules fallback (2026-11-23)

| | Precision | Recall | F1 | FPR |
|---|---|---|---|---|
| Strict | 100% | 34.4% | 51.2% | 0% |
| Lenient | 73.2% | 93.8% | 82.2% | 28.9% |

Gate: 100% of phishing cases reach a classifier; 81.6% of benign cases do (see the
login-heavy caveat above).

Where the rules still fail:
- **Missed**: the Microsoft Forms "password reset" page (checked, but nothing in its
  text scores) and an OTP page whose host says "bofa" rather than a listed brand
  keyword. Both now reach the model; the rules alone call them safe.
- **False alarms**: every brand on an unlisted domain (7/7: wellsfargoadvisors.com,
  dhl.de, appleinsider.com, ...), every legitimate cross-site form post (3/3) and one
  deeply nested enterprise login. Unchanged; these are for the model.

### History

| Date | Change | Gate (phishing) | Lenient recall | Lenient FPR |
|---|---|---|---|---|
| 2026-11-22 | Initial rules, 64 cases | 78.1% | 75.0% | 37.5% |
| 2026-11-23 | +6 benign traps written before the gate change (no metric change) | 78.1% | 75.0% | 31.6% |
| 2026-11-23 | Always check Google Forms/Sites, Microsoft Forms | 87.5% | 81.3% | 31.6% |
| 2026-11-23 | Scam scripts open the gate (tech support, crypto giveaway, seed phrase) | 100% | 93.8% | 31.6% |
| 2026-11-23 | Private-network IPs (routers, printers) don't score as IP/HTTP signals | 100% | 93.8% | 28.9% |

The FPR drop in the second row is only the larger benign denominator.

`test/eval-cases.test.ts` fails if a change drops below this baseline.
