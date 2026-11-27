// Held-out set 3: written on 2026-11-27, after held-out set 2 was scored by the rules and
// BEFORE the next callback-scam change was written, and committed before anything scored
// them (rules included). Kept out of ALL_CASES so the rules tests and tuning never touch
// them. Not yet seen by any model.
//
// How they were written, so the result can be judged:
// - Narrow on purpose, like set 2: the coming change is about callback scams (no form,
//   "call this number") that name no brand, or one the brand list doesn't know. So the
//   set is all no-form pages. It is not a general accuracy sample.
// - The author knows the current callback-scam signal (an account threat or unexpected
//   charge, plus "call" and a phone number in one sentence, only on a page naming a brand
//   it isn't hosted by) and had a candidate fix in mind while writing: on a page naming no
//   brand, count the script when it also carries urgency (a deadline, "immediately") or a
//   made-up department ("Fraud Prevention Department", "Billing Department").
// - Cases were added to break that fix on both sides:
//   - scams that don't use the account-lock / you-were-charged wording at all (customs
//     fee, refund overpayment, tax warrant), and one that says "contact" instead of "call"
//     (h-p-wallet-frozen-contact);
//   - legitimate pages with the same threat + call + deadline words on the organization's
//     own site: a utility's disconnection notice, a university IT lockout, a DMV
//     suspension page, a gym's auto-renewal terms, a hospital billing page, a bank's own
//     fraud page, and a scam warning that quotes a no-brand script.
// - The rules from sets 1 and 2 still apply: no case is edited, dropped or relabeled
//   after a score is seen; a malformed case is fixed in a separate commit that says so;
//   once these inform a change they stop being held out.
//
// Hostnames are illustrative or real; paths, text and phone numbers (555 numbers) are
// written from scratch. None were visited.

import type { EvalCase } from "../case.ts";

const P = (c: Omit<EvalCase, "label">): EvalCase => ({ ...c, label: "phishing" });
const B = (c: Omit<EvalCase, "label">): EvalCase => ({ ...c, label: "benign" });

export const HELDOUT_PHISHING: EvalCase[] = [
  P({
    id: "h-p-online-banking-suspended", category: "callback-scam",
    note: "Generic 'online banking' suspension notice; no bank is named anywhere.",
    url: "https://secure-banking-review.com/alert/7731",
    title: "Online Banking Security Notice",
    text: "Online Banking Security Team. Your account access has been suspended due to unusual activity. Call 1-833-555-0148 immediately to verify your identity and restore access. Failure to call within 24 hours will result in permanent closure.",
  }),
  P({
    id: "h-p-pc-care-renewal", category: "callback-scam",
    note: "Fake auto-renewal charge for a made-up software brand no brand list would know.",
    url: "https://pc-care-billing.net/receipt/22091",
    title: "Payment Receipt - Total PC Care Pro",
    text: "Thank you for your payment. Your annual subscription to Total PC Care Pro has been renewed and $349.99 was charged to your card today. If you did not request this renewal, call our billing department at 1-888-555-0191 to cancel and get a refund.",
  }),
  P({
    id: "h-p-email-deactivation", category: "callback-scam",
    note: "Email account 'deactivation' page naming no provider.",
    url: "https://mail-account-verify.net/deactivate",
    title: "Mailbox Deactivation Notice",
    text: "Your email account is scheduled for deactivation today because of a security violation. All messages will be deleted. To keep your account active, call Mail Support at 1-800-555-0171 now.",
  }),
  P({
    id: "h-p-customs-release-fee", category: "callback-scam",
    note: "Parcel held at customs with a 'release fee' phone line; no account threat or charge wording.",
    url: "https://parcel-customs-hold.com/track/CN8812047",
    title: "Shipment on hold - customs fee due",
    text: "Your international parcel CN8812047 is being held at customs. An import fee of $36.80 must be paid before delivery. Please phone our clearance desk at 1-877-555-0139 today or the parcel will be returned to sender.",
  }),
  P({
    id: "h-p-refund-overpayment", category: "callback-scam",
    note: "Refund-overpayment script: 'we sent you too much, call to fix it'. No brand, no account lock.",
    url: "https://refund-processing-desk.com/case/55102",
    title: "Refund Processing Error",
    text: "Refund Department. Due to a system error, a refund of $4,999.00 was issued to your account instead of $49.99. This must be corrected right away. Call our refund desk at 1-866-555-0158 so an agent can help you return the difference.",
  }),
  P({
    id: "h-p-tax-warrant", category: "callback-scam",
    note: "Back-taxes 'warrant' threat from an unnamed state agency; the threat is arrest, not an account.",
    url: "https://state-tax-collections.org/notice/WR-40921",
    title: "Final Notice - Outstanding Tax Balance",
    text: "Tax Collections Unit. Final notice: you have an outstanding balance of $2,316.00. A warrant will be issued in your name if this is not resolved by end of business today. Call 1-844-555-0126 to arrange payment and stop legal action.",
  }),
  P({
    id: "h-p-wallet-frozen-contact", category: "callback-scam",
    note: "Crypto wallet 'frozen' page that says 'contact' rather than 'call'; no brand.",
    url: "https://wallet-compliance-review.com/frozen",
    title: "Wallet Frozen - Compliance Review",
    text: "Your wallet has been frozen pending a compliance review and withdrawals are disabled. To unfreeze your funds, contact our recovery desk at +1 (855) 555-0162 within 12 hours.",
  }),
];

export const HELDOUT_BENIGN: EvalCase[] = [
  B({
    id: "h-b-utility-disconnection", category: "support-phone",
    note: "A utility's own past-due page: disconnection threat, deadline and a toll-free number, on its own domain.",
    url: "https://www.duke-energy.com/home/billing/past-due",
    title: "Past Due Bills | Duke Energy",
    text: "If your account is past due, service may be disconnected. To avoid disconnection, call us at 1-800-555-0114 before your due date to set up a payment arrangement. Assistance programs are available.",
  }),
  B({
    id: "h-b-university-it-lockout", category: "support-phone",
    note: "University IT page about a locked account, telling you to call the service desk.",
    url: "https://its.unc.edu/accounts/locked-onyen/",
    title: "Locked Account | Information Technology Services",
    text: "Your account has been locked after too many failed sign-in attempts. Wait 30 minutes and try again, or call the ITS Service Desk at 919-555-0137 to unlock it immediately.",
  }),
  B({
    id: "h-b-dmv-license-suspended", category: "government",
    note: "State DMV page on suspended licenses with a reinstatement phone line.",
    url: "https://www.ncdot.gov/dmv/license-id/license-suspension/",
    title: "License Suspensions | NCDMV",
    text: "If your driver license has been suspended, you must resolve the suspension before driving. Fees may apply. For questions about reinstatement, call 1-877-555-0129, Monday through Friday.",
  }),
  B({
    id: "h-b-gym-auto-renewal", category: "support-phone",
    note: "A gym's membership terms: you will be charged automatically; call to cancel.",
    url: "https://www.ymcacharlotte.org/membership/terms",
    title: "Membership Terms | YMCA of Greater Charlotte",
    text: "Memberships renew automatically each month and you will be charged $39.99 on your billing date. If you did not mean to renew or want to cancel, call your home branch at 704-555-0152 at least 5 days before your next billing date.",
  }),
  B({
    id: "h-b-hospital-billing", category: "support-phone",
    note: "Hospital billing office page about charges you don't recognize.",
    url: "https://www.unchealthcare.org/billing/questions/",
    title: "Billing Questions | UNC Health",
    text: "If you were charged for a visit you don't recognize or think your bill is wrong, call our Patient Billing Office at 919-555-0181. We can review your charges and set up a payment plan.",
  }),
  B({
    id: "h-b-bank-fraud-page", category: "support-phone",
    note: "A bank's own fraud page: unauthorized charges, locked card, call immediately, on its own domain.",
    url: "https://www.firstcitizens.com/security/report-fraud",
    title: "Report Fraud | First Citizens Bank",
    text: "If you see a charge you didn't authorize, call us immediately at 1-888-555-0145. We'll lock your card, review the transaction and send you a new card. First Citizens will never ask for your PIN.",
  }),
  B({
    id: "h-b-aarp-callback-warning", category: "security-news",
    note: "Consumer warning that quotes a no-brand callback script verbatim.",
    url: "https://www.aarp.org/money/scams-fraud/info-2026/refund-scam.html",
    title: "Watch Out for Fake Refund Calls",
    text: "The message says your account has been suspended or that a refund was sent by mistake, and tells you to call a number within 24 hours. It's a scam. Hang up, don't call back, and contact the company using the number on your statement.",
  }),
];

export const HELDOUT_CASES = [...HELDOUT_PHISHING, ...HELDOUT_BENIGN];
