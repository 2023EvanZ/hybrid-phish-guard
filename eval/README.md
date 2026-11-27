# Evaluation set

85 hand-written, labeled page descriptions (39 phishing/scam, 46 benign) in
[cases/](cases), scored by `npm run eval`: the original 70, plus held-out set 1 since it
was retired on 2026-11-26. Held-out set 3 (14 cases, [cases/heldout.ts](cases/heldout.ts)) is scored separately;
set 2 ([cases/heldout-2.ts](cases/heldout-2.ts)) was retired on 2026-11-27 and joins the dev set with the
change it drives. Each case is a URL, title, visible text and
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

## Held-out set 3, frozen before the no-brand callback change (2026-11-27)

Set 2's miss `h-p-card-fraud-dept` (a callback scam that names no brand) drives the next
change, so set 2 is retired ([cases/heldout-2.ts](cases/heldout-2.ts)) and set 3 (14
no-form pages: 7 callback scams, 7 legitimate pages that say to call) was written and
committed before the change was written. Like set 2, its header records the fix the author
had in mind and the cases added to break it: scams without the account-lock wording or
with "contact" instead of "call", and organizations' own pages with the same threat, call
and deadline words. Set 2 joins the dev set in the same commit as the change.

## No-form gate change after run 5 (2026-11-26)

Run 5's only held-out miss was `h-p-coinbase-callback`: "your account is locked, call this
number", with no form, so the gate never checked it. The existing no-form scripts (fake
virus alert, crypto giveaway, recovery phrase) didn't cover it.

**Order of work, so the held-out result means something.** Because that case drove the
change, held-out set 1 was retired into the dev set, and held-out set 2 (12 no-form pages:
6 callback scams, 6 legitimate pages that say to call) was written and committed
(c7b4829) before the change was written. Its header records the fix the author had in
mind and the cases added to break it.

**The change** ([src/prefilter/signals.ts](../src/prefilter/signals.ts)): a new
`callback-scam` script, which opens the gate and adds 3 points. It needs an account threat
or unexpected charge ("account has been locked", "you've been charged", "didn't
authorize") and "call" followed by a phone number in the same sentence. It only counts
on a page that names a brand it isn't hosted by, because a bank's own "lost card? call
us" page has the same words.

**Rules only** (the models haven't seen it yet):

| | Before | After |
|---|---|---|
| Dev (85): phishing pages checked | 38/39 | 39/39 |
| Dev: lenient recall / false alarms | 34/39, 12/46 | 35/39, 12/46 |
| Dev: benign pages checked | 35/46 | 35/46 (no new pages) |
| Held-out set 2: lenient recall | 0/6 (all skipped) | 4/6 |
| Held-out set 2: false alarms / benign checked | 0/6, 0/6 | 0/6, 0/6 |

- On the dev set the signal fires on exactly one page, the one it was built for. The
  dev false alarm added when set 1 joined (`h-b-city-utility-paymentus`) predates it.
- **The two held-out misses are the known gap, and the cases written to expose it:**
  `h-p-card-fraud-dept` names no brand, and `h-p-geek-squad-renewal` names one the brand
  list doesn't know and has no account-lock wording. Dropping the brand requirement would
  catch the first, at the cost of checking every legitimate "call us" page.
- The 4 caught pages are rated "suspicious" by the rules (score 5-7). What matters more is
  that they now reach Gemini Nano and the cloud. The next model run will show how those
  do.

## Models, run 5: first full hybrid run with the cloud reachable (2026-11-26)

Raw output: [results/2026-11-26-models-run5.json](results/2026-11-26-models-run5.json).
Release build of the code after the speed change (instant rules warning, verdict-only
Nano), Chrome 158, App Check unenforced in the Firebase console. 0 failures on either
model. This is also the first measurement of the policy change after run 3.

| Dev (32 phishing / 38 benign) | Strict recall | Strict false alarms | Lenient recall | Lenient false alarms |
|---|---|---|---|---|
| Rules | 34.4% (11) | 0% (0) | 93.8% (30) | 28.9% (11) |
| Gemini Nano | 75.0% (24) | 7.9% (3) | 96.9% (31) | 23.7% (9) |
| Cloud | 100% (32) | 0% (0) | 100% (32) | 0% (0) |
| **Hybrid** | **100% (32)** | **0% (0)** | **100% (32)** | **0% (0)** |

| Held-out (7 / 8) | Strict recall | Strict false alarms | Lenient recall | Lenient false alarms |
|---|---|---|---|---|
| Rules | 0% (0) | 0% (0) | 57.1% (4) | 12.5% (1) |
| Gemini Nano | 14.3% (1) | 0% (0) | 85.7% (6) | 12.5% (1) |
| Cloud | 85.7% (6) | 0% (0) | 85.7% (6) | 0% (0) |
| **Hybrid** | **85.7% (6)** | **0% (0)** | **85.7% (6)** | **0% (0)** |

- **The hybrid matches the cloud's accuracy while 59% of checked dev pages (37 of 63)
  never leave the device.** Every page Nano got wrong was escalated and the cloud
  corrected it: all 9 Nano false alarms, `p-paypai` (Nano "safe", caught by the new
  `unverified-brand` rule) and every "suspicious". The held-out result counts: the
  policy was frozen before any model saw those cases. The one held-out miss,
  `h-p-coinbase-callback`, has no form, so the gate never checks it; no model can fix
  that (the no-form gate gap). `h-p-bofa-typo`, missed in run 4, was caught this time.
- **Be honest about what this shows.** The cloud alone is just as accurate here, so the
  hybrid's gain is privacy and cost (41% of dev pages go to the cloud, on redacted
  features), not accuracy. And the held-out set is small: one page is 14 points.
- **Escalations.** 26 of 63 dev pages (41%), in line with the run 2/3 replay (41-44%):
  10 Nano "suspicious", 8 unsupported "phishing", 5 unverified-brand, 3 low-confidence.
  13 of those were benign. Held-out: 6 of 10.
- **Speed.** Verdict-only Nano: median 1.8 s per page (p10 1.7 s, p90 2.0 s, max 3.8 s),
  against 3.0 s (p90 3.5 s) in run 4, so about 40% faster. Time to the final verdict
  across all checked dev pages: median 1.9 s, p90 3.1 s, max 5.2 s. Pages that escalate
  take Nano plus the cloud: median 2.6 s, p90 4.7 s.
- **Did dropping reasons hurt Nano?** Not measurably. Its error list is the same as run
  4 apart from two pages: `h-p-bofa-typo` went from "safe" to "suspicious" (better) and
  `b-library-bibliocommons` from "suspicious" to "phishing" (worse strictly, the same
  leniently). Two runs one day apart can't separate that from run-to-run noise.
- **Instant warning.** 11 dev pages get it (rules score 8+), all phishing, and the models
  confirmed every one, so none was withdrawn. No held-out page scores 8+.

## Models, run 4: cloud blocked by App Check (2026-11-25)

Raw output: [results/2026-11-25-models-run4.json](results/2026-11-25-models-run4.json).
Release build 0.0.5 (no App Check), Chrome 158, prompt and policy as after run 3.

**Every cloud call failed** (73 of 73): `401 Firebase App Check token is invalid`. The
release build sends no App Check token, so the Firebase project is enforcing App Check
for AI Logic. Escalated pages fell back to Nano's verdict, so "hybrid" in this run is
Nano alone and **the policy change after run 3 is still untested**. The fix is in the
Firebase console (App Check -> APIs -> Firebase AI Logic -> Unenforce), not the code.

| Gemini Nano | Dev, strict | Dev, lenient | Held-out, strict | Held-out, lenient |
|---|---|---|---|---|
| Recall | 71.9% (23/32) | 96.9% (31/32) | 14.3% (1/7) | 71.4% (5/7) |
| False alarms | 5.3% (2/38) | 23.7% (9/38) | 0% (0/8) | 12.5% (1/8) |

- **Held-out, the first time the models saw it.** Nano caught 5 of 7 if "suspicious"
  counts (the rules: 4 of 7), but called only 1 of 7 "phishing": on new pages it mostly
  hedges with "suspicious". Misses: `h-p-bofa-typo` (a one-letter typo, again "safe";
  the unverified-brand rule escalated it, but the cloud failed) and
  `h-p-coinbase-callback` (no form, so the gate never checks it). Seven phishing pages
  is too few for these rates to mean much: one page is 14 points.
- **Latency.** Nano median 3.0 s per page (p10 2.6 s, p90 3.5 s, max 4.3 s), with
  0 failures. The answers average ~210 characters of JSON, mostly reasons, which led
  to the speed change below.

## Speed change after run 4 (2026-11-25)

Measured in run 5 (above): Nano about 40% faster, with no measurable accuracy loss.

- **Instant rules warning.** When the rules alone rate a page "phishing" (score 8+: no
  false alarms on the dev or held-out sets in any run), the content script shows the
  warning at once, marked "Checking with the AI model…", instead of after the model
  check. The model's verdict then updates it, or withdraws it if the models find the
  page safe. 11 of 63 checked dev pages qualify.
- **Nano answers verdict and confidence only** (no reasons), cutting its output from
  ~60 tokens to ~15. The card shows the rules' warning signs as the reasons, and asks
  Nano to explain itself only when the user opens the card. **Risk to check in run 5:**
  writing reasons may have helped Nano's verdicts, so accuracy could drop.
- The eval page now reports model time to the final verdict (median, p90, max) and how
  many pages get the instant warning.

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

## Held-out cases, set 1 (2026-11-24; retired 2026-11-26)

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
