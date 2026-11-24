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

## Policy change after run 3 (2026-11-24)

Shipped in [src/triage/policy.ts](../src/triage/policy.ts), made after the held-out cases
were frozen and before any model saw them:

- `lowRiskScore` 4 to 5: a Nano "phishing" on a page scoring 4 or less goes to the cloud
  before any banner.
- New `unverified-brand` escalation: a Nano "safe" on a page that names a brand it isn't
  hosted by (`brand-text-mismatch`) and has a password, payment, bank/SSN or one-time-code
  field goes to the cloud. The run 3 replay tried passwords only; the shipped check covers
  all four sensitive field types.
- The prompt is unchanged (it still describes the score as "under 4 is low"), so the next
  run measures the policy alone.

Offline replay of the recorded answers through the real `shouldEscalate`, local timeout
included. The old-policy row reproduces run 3's recorded hybrid result exactly. These are
the dev cases the change was designed on, so they show that it does what it was built to do,
not how well it generalizes. That is the held-out set's job.

| Run | Policy | False alarms | Misses | Sent to cloud | Benign sent to cloud |
|---|---|---|---|---|---|
| 2 | old | 0 | 1 | 18 / 63 (29%) | 7 |
| 2 | new | 0 | 0 | 26 / 63 (41%) | 11 |
| 3 | old | 2 | 1 | 16 / 63 (25%) | 6 |
| 3 | new | 0 | 0 | 28 / 63 (44%) | 12 |

The cost is privacy and latency: about 4 in 10 checked pages now get a cloud call (on
redacted features, about 1 s), against 1 in 4 before. That is still far below run 1, where
28 of 31 benign pages went to the cloud.

## Held-out cases (2026-11-24)

15 cases (7 phishing, 8 benign) in [cases/heldout.ts](cases/heldout.ts), written after
model run 3 and before the next policy change. They were committed (1366d2a) before
anything scored them, the rules engine included, and stay out of `ALL_CASES`, the rules
test floors and any tuning. Rules: no case is edited, dropped or relabeled after a score is
seen; once they inform a change they stop counting as held out. The eval page and
`npm run eval` score them separately.

Caveats: the same person wrote the dev cases, the prompt and these cases, and knew Nano's
weak spots while writing them. With 7 and 8 cases, one case moves a rate by 12-14 points.

**Rules engine on held-out vs dev (lenient):**

| Set | Precision | Recall | F1 | FPR |
|---|---|---|---|---|
| Dev (70 cases) | 73.2% | 93.8% | 82.2% | 28.9% |
| Held-out (15 cases) | 80.0% | 57.1% | 66.7% | 12.5% |

The recall drop is the overfitting the held-out set exists to show: the rules and their
brand list were grown against the dev cases. Missed: `h-p-toll-unpaid` (score 2; toll
brand only in the text), `h-p-att-webflow` (score 3), and `h-p-coinbase-callback`, a
phone-number scam with no form that the prefilter gate **skips**, so no model sees it
either. The gate passes 6 of 7 held-out phishing pages. False alarm:
`h-b-city-utility-paymentus` (score 6), a city bill form that posts to its payment processor.

## Models, run 3: schema-constrained Nano (2026-11-23)

Changes since run 2: Nano's output is constrained to the verdict JSON schema
(`responseConstraint`), and the prompt's brand line says the list misses most misspellings
and tells the model to check the address itself. Two changes in one run, so a shift in
Nano's verdicts can't be pinned on either one. Raw output:
[results/2026-11-23-models-run3.json](results/2026-11-23-models-run3.json).

| System | Strict precision | Strict recall | Lenient precision | Lenient recall | Lenient F1 | Lenient FPR |
|---|---|---|---|---|---|---|
| Rules only | 100% | 34.4% | 73.2% | 93.8% | 82.2% | 28.9% |
| Gemini Nano (on-device) | 88.0% | 68.8% | 78.9% | 93.8% | 85.7% | 21.1% |
| Gemini (cloud, redacted) | 100% | 100% | 100% | 100% | 100% | 0% |
| **Hybrid (what users see)** | 93.9% | 96.9% | 93.9% | 96.9% | 95.4% | 5.3% |

- **The schema constraint worked**: 0 invalid-JSON answers (run 2: 5). Nano latency is
  unchanged (median 2.93 s, p90 3.60 s; run 2: 2.92 s / 3.55 s). Of the 5 former
  failures, 2 are now confident "phishing" and 3 are "suspicious" (sent to the cloud).
- **Regression: 2 hybrid false alarms** (run 2: 0). On `b-authorize-net-checkout` and
  `b-library-bibliocommons`, legitimate forms that post to a payment or auth provider
  (score 4), Nano went from "suspicious" 70% to "phishing" 85%. That is confident enough
  to skip the cloud, and 4 is not under the `lowRiskScore` cutoff of 4. One of its reasons
  was "Cross-origin form detected with a high risk score", although the prompt says
  under 4 is low and 8 or more is high.
- **`p-paypai` still missed; the brand-line rewording did nothing.** Nano said "safe" 90%
  again, now citing "Registered domain matches the brand in the URL", which is false.
  Prompt wording doesn't get Nano to notice a one-letter typo.
- The policy's mirror check did its job once: `b-metamask-help-import` (score 3) got a
  Nano "phishing", escalated as `unsupported-phishing`, and the cloud cleared it.
- **1 lost reply, then 1 timeout.** On `p-usps-redelivery` the call failed with "message
  channel closed before a response was received", and the next case took 12.1 s (cold-model
  territory), so it timed out. Unverified guess: the offscreen document died and was
  recreated, so Nano had to load again. Both cases escalated and were caught.
- Cloud was back to normal: mean 0.85 s, max 2.1 s, no failures, every case right.
- Escalation fell to 25% (16 of 63), because Nano answers more often and more confidently.

**Counterfactual policies, replayed offline on the recorded answers of runs 2 and 3.**
These are tuned on the same data, so they show direction only:

| Policy | Run 2 FP / FN | Run 3 FP / FN | Run 3 escalated (benign) |
|---|---|---|---|
| Current (`lowRiskScore` 4) | 0 / 1 | 2 / 1 | 15 (6) |
| `lowRiskScore` 5 | 0 / 1 | 0 / 1 | 22 (8) |
| `lowRiskScore` 5, plus escalate a Nano "safe" when the page asks for a password and names a brand it isn't hosted by | 0 / 0 | 0 / 0 | 27 (12) |

The replay ignores the 10 s local timeout, so its escalation counts can be off by one
from the table above. The structural lesson matters more than the numbers: Nano's verdict
should stand alone only when it agrees with the rules' evidence. Where they disagree in a
way that hurts, cloud review costs about 1 s. Prompt edits have changed *which* cases
Nano gets wrong more than *how many*.

## Models, run 2: evidence-based prompt (2026-11-23)

Changes since run 1: the prompt defines each verdict by evidence and says a form alone
is normal; form-content flags are no longer listed as warning signs; a Nano "phishing"
on a page scoring under 4 gets a cloud second opinion; private-network IPs don't score.
Raw output: [results/2026-11-23-models-run2.json](results/2026-11-23-models-run2.json).
These changes were designed after seeing run 1's failures, so this run flatters them.

| System | Strict precision | Strict recall | Lenient precision | Lenient recall | Lenient F1 | Lenient FPR |
|---|---|---|---|---|---|---|
| Rules only | 100% | 34.4% | 73.2% | 93.8% | 82.2% | 28.9% |
| Gemini Nano (on-device) | 95.5% | 65.6% | 78.8% | 81.3% | 80.0% | 18.4% |
| Gemini (cloud, redacted) | 100% | 100% | 97.0% | 100% | 98.5% | 2.6% |
| **Hybrid (what users see)** | 100% | 96.9% | 100% | 96.9% | 98.4% | 0% |

- **The goal was met**: Nano now calls 24 of 31 checked benign pages "safe" (run 1: 3).
  Benign pages sent to the cloud fell from 28 of 31 to 7 of 31. Overall escalation 29%.
- **Nano got worse at phishing on its own** (strict recall 96.9% to 65.6%): it says
  "suspicious" on several clear lookalikes, which escalate and are caught by the cloud.
- **5 unparseable Nano answers, all on phishing pages** (run 1: 1). Each escalated, so
  the hybrid caught them, but that is safety by accident.
- **The one hybrid miss**: `p-paypai` (paypai.com). Nano said "safe" 90%, citing "No
  brand imitation in URL", which repeats the prompt's "Brands imitated in the web
  address: none". The rules' brand list doesn't know "paypai", and Nano took the list's
  silence as a finding instead of reading the address itself.
- Cloud latency rose to mean 4.1 s, max 16.6 s (run 1: 1.6 s / 8.8 s), with the same
  model and nearly the same prompt; likely service-side variance. The cloud timeout is 20 s.

## Models, run 1: first prompt (2026-11-23)

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
