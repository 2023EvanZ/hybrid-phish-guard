// Held-out set 1: written on 2026-11-24, after model eval run 3 and before the next policy
// change, and committed before anything scored them (rules included).
//
// RETIRED on 2026-11-26, after model eval run 5: its one remaining miss
// (h-p-coinbase-callback, a no-form callback scam) drives the no-form gate change, so per
// the rule below these no longer count as held out. Set 2 (heldout.ts) replaces them.
//
// How they were written, so the result can be judged:
// - Scenarios are drawn from common real-world phishing patterns and everyday legitimate
//   pages, not from the failures of runs 1-3. The author (same as for the dev set) knows
//   Nano's known weak spots (typos, cross-site forms); the mix below tries to match how
//   often each pattern shows up, not to avoid or pile onto those.
// - No case is to be edited, dropped or relabeled after seeing a score. If a case turns
//   out to be mislabeled or malformed, it is fixed in a separate commit that says so.
// - Once these have informed a change, they stop being held out; new ones replace them.
//
// Hostnames are illustrative or real; paths and page text are approximations written from
// scratch. None were visited.

import type { EvalCase } from "../case.ts";

const P = (c: Omit<EvalCase, "label">): EvalCase => ({ ...c, label: "phishing" });
const B = (c: Omit<EvalCase, "label">): EvalCase => ({ ...c, label: "benign" });

export const HELDOUT_1_PHISHING: EvalCase[] = [
  P({
    id: "h-p-onedrive-compromised-wp", category: "compromised-site",
    note: "Shared-document lure in a hacked dental office WordPress install; no brand in the host.",
    url: "https://www.greenvalleydental.com/wp-includes/js/od/index.php",
    title: "OneDrive - Shared document",
    text: "Mary Collins shared \"Q4 Invoice.pdf\" with you. To view the document, sign in with your Microsoft account.",
    forms: [{ fields: ["email", "password"] }],
  }),
  P({
    id: "h-p-toll-unpaid", category: "delivery-toll",
    note: "Unpaid-toll smishing landing page; toll brand only in the text.",
    url: "https://ezdrive-tollservices.com/pay/balance",
    title: "Toll Services - Outstanding Balance",
    text: "Our records show an unpaid toll balance of $4.15. To avoid a late fee of $50.00 and suspension of your vehicle registration, pay today.",
    forms: [{ fields: ["name", "card", "exp", "cvv"] }],
  }),
  P({
    id: "h-p-docusign-r2", category: "free-hosting",
    note: "Document-signing lure on a Cloudflare R2 public bucket URL.",
    url: "https://pub-3f9a2c71b8e04d55.r2.dev/docs/review.html",
    title: "DocuSign",
    text: "Please review and sign: Employee Compensation Adjustment 2026. Sign in with your email to access the document.",
    forms: [{ fields: ["email", "password"] }],
  }),
  P({
    id: "h-p-bofa-typo", category: "typosquat",
    note: "One-letter swap in the brand (l for i) on a secure- subdomain.",
    url: "https://secure.bankofamerlca.com/login/sign-in",
    title: "Bank of America | Online Banking | Sign In",
    text: "Sign in to Online Banking. Online ID. Passcode. Forgot ID/Passcode?",
    forms: [{ fields: ["user", "password"] }],
  }),
  P({
    id: "h-p-coinbase-callback", category: "tech-support",
    note: "Fake account-lock page pushing a phone number; no form, brand only in the text.",
    url: "https://wallet-recovery-center.com/case/88213",
    title: "Account Locked - Case #88213",
    text: "Coinbase Security: your account has been locked after a login attempt from Lagos, Nigeria. Do not attempt to log in. Call our recovery team immediately at 1-888-555-0143 to secure your funds.",
  }),
  P({
    id: "h-p-job-onboarding", category: "job-scam",
    note: "Fake remote-job onboarding asking for SSN and bank details for 'direct deposit'.",
    url: "https://careers-amazonhiring.net/onboarding/step2",
    title: "Onboarding - Direct Deposit Setup",
    text: "Congratulations on your new remote Data Entry role ($42/hr). Complete direct deposit setup today so we can send your equipment check.",
    forms: [{ fields: ["name", "ssn", "routing", "account"] }],
  }),
  P({
    id: "h-p-att-webflow", category: "free-hosting",
    note: "Webmail login clone on a site-builder subdomain.",
    url: "https://att-mail-signin.webflow.io/",
    title: "AT&T Mail - Sign In",
    text: "Sign in to AT&T Mail. Your mailbox will be deactivated if you do not verify your account.",
    forms: [{ fields: ["email", "password"] }],
  }),
];

export const HELDOUT_1_BENIGN: EvalCase[] = [
  B({
    id: "h-b-chase-logon", category: "bank-login",
    note: "The real Chase online logon.",
    url: "https://secure.chase.com/web/auth/#/logon/logon/chaseOnline",
    title: "Sign in - chase.com",
    text: "Welcome. Username. Password. Remember me. Forgot username/password?",
    forms: [{ fields: ["user", "password"], synthetic: true }],
  }),
  B({
    id: "h-b-stripe-checkout", category: "hosted-checkout",
    note: "Stripe-hosted checkout for a small merchant; the page names a business that isn't the host.",
    url: "https://checkout.stripe.com/c/pay/cs_live_a1B2c3D4e5F6g7H8",
    title: "Acme Coffee Roasters",
    text: "Pay Acme Coffee Roasters. 2 lb Ethiopia Yirgacheffe, $38.00. Pay with card. Email. Card information. Name on card.",
    forms: [{ fields: ["email", "card", "exp", "cvv", "name"], synthetic: true }],
  }),
  B({
    id: "h-b-okta-tenant", category: "sso",
    note: "A company's Okta sign-in on its okta.com tenant subdomain.",
    url: "https://acmecorp.okta.com/",
    title: "Acme Corp - Sign In",
    text: "Sign In. Username. Keep me signed in. Next. Help.",
    forms: [{ fields: ["user", "password"] }],
  }),
  B({
    id: "h-b-city-utility-paymentus", category: "cross-origin-legit",
    note: "City utility bill page whose payment form posts to its payment processor.",
    url: "https://www.springfieldmo.gov/utilities/pay-my-bill",
    title: "Pay My Utility Bill | City of Springfield",
    text: "Pay your water and sewer bill online. Payments are processed by Paymentus. A convenience fee applies to card payments.",
    forms: [{ action: "https://ipn.paymentus.com/cp/sprm", fields: ["account", "name", "card", "exp", "cvv"] }],
  }),
  B({
    id: "h-b-reddit-scam-thread", category: "security-news",
    note: "Forum thread quoting a toll scam text and asking whether it's real.",
    url: "https://www.reddit.com/r/Scams/comments/1h2k9x/got_a_text_saying_i_owe_a_toll_is_this_real/",
    title: "Got a text saying I owe a toll, is this real? : r/Scams",
    text: "Got this text: 'Your vehicle has an unpaid toll of $4.15. Pay now to avoid a $50 late fee' with a link. I haven't driven on a toll road in months. Top comment: It's a scam, don't click it. Report it and delete.",
  }),
  B({
    id: "h-b-google-signin", category: "ordinary-login",
    note: "Google account sign-in, email step.",
    url: "https://accounts.google.com/v3/signin/identifier?continue=https%3A%2F%2Fmail.google.com",
    title: "Gmail",
    text: "Sign in. to continue to Gmail. Email or phone. Forgot email? Create account.",
    forms: [{ fields: ["email"] }],
  }),
  B({
    id: "h-b-university-sso", category: "sso",
    note: "University single sign-on with a Duo prompt mention.",
    url: "https://shib.ncsu.edu/idp/profile/SAML2/Redirect/SSO?execution=e1s1",
    title: "NC State Unity ID Login",
    text: "Log in with your Unity ID. Unity ID. Password. You will be prompted for two-factor authentication with Duo.",
    forms: [{ fields: ["user", "password"] }],
  }),
  B({
    id: "h-b-small-shop-sale", category: "ordinary-payment",
    note: "Small store checkout with sale-deadline urgency.",
    url: "https://www.bluebirdcandleco.com/checkouts/c/8f2e1a",
    title: "Checkout - Bluebird Candle Co.",
    text: "Holiday sale ends at midnight! Complete your order to lock in 25% off. Shipping address. Payment. All transactions are secure and encrypted.",
    forms: [{ fields: ["email", "name", "address", "card", "exp", "cvv"] }],
  }),
];

export const HELDOUT_1_CASES = [...HELDOUT_1_PHISHING, ...HELDOUT_1_BENIGN];
