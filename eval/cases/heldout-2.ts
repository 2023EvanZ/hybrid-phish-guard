// Held-out set 2: written on 2026-11-26, after model eval run 5 and BEFORE the no-form
// gate change was written, and committed before anything scored them (rules included).
// Kept out of ALL_CASES so the rules tests and tuning never touch them.
//
// RETIRED on 2026-11-27: its miss h-p-card-fraud-dept (a callback scam that names no
// brand) drives the next callback-scam change, so per the rules below these no longer
// count as held out. They join the dev set with that change. Set 3 (heldout.ts) replaces
// them.
//
// How they were written, so the result can be judged:
// - Narrow on purpose: they test the coming change, which is about scam pages with no
//   form (mostly "your account is locked / you were charged, call this number"). So the
//   set is all no-form pages, unlike set 1. It is not a general accuracy sample.
// - The author had a candidate fix in mind while writing: open the gate on an
//   account-threat + phone-call script, but only when the page names a brand it isn't
//   hosted by. Cases were added to break that fix on both sides: a fake-invoice scam
//   naming a brand the brand list may not know (h-p-geek-squad-renewal), a scam with no
//   brand at all (h-p-card-fraud-dept), and legitimate pages that tell you to call
//   (a credit union's lost-card page, an airline rebooking page, scam warnings that
//   quote the script).
// - The rules from set 1 still apply: no case is edited, dropped or relabeled after a
//   score is seen; a malformed case is fixed in a separate commit that says so; once these
//   inform a change they stop being held out.
//
// Hostnames are illustrative or real; paths, text and phone numbers (555 numbers) are
// written from scratch. None were visited.

import type { EvalCase } from "../case.ts";

const P = (c: Omit<EvalCase, "label">): EvalCase => ({ ...c, label: "phishing" });
const B = (c: Omit<EvalCase, "label">): EvalCase => ({ ...c, label: "benign" });

export const HELDOUT_2_PHISHING: EvalCase[] = [
  P({
    id: "h-p-amazon-order-callback", category: "callback-scam",
    note: "Fake order confirmation for an expensive purchase, pushing a 'cancel' phone line.",
    url: "https://order-cancellation-desk.com/confirm/114-8820",
    title: "Your Amazon.com order #114-8820193",
    text: "Amazon: Your order of Apple iPhone 15 Pro Max (256GB) for $1,249.00 has been placed and will ship today. If you did not authorize this purchase, call Amazon Support immediately at +1 (844) 555-0187 to cancel and receive a full refund.",
  }),
  P({
    id: "h-p-irs-refund-hold", category: "callback-scam",
    note: "Tax refund 'on hold' notice with a deadline and a verification phone line.",
    url: "https://refund-status-notice.org/case/IRS-2026-44817",
    title: "Notice CP-53: Refund on Hold",
    text: "Internal Revenue Service. Your 2025 federal tax refund of $3,482.00 is on hold pending identity verification. Call the IRS Verification Unit at 1-877-555-0102 within 48 hours to release your refund and avoid a penalty.",
  }),
  P({
    id: "h-p-card-fraud-dept", category: "callback-scam",
    note: "Card-blocked alert that names no brand at all; only the script gives it away.",
    url: "https://secure-card-alerts.net/notice",
    title: "Fraud Prevention Alert",
    text: "Fraud Prevention Department. A suspicious transaction of $980.00 at BESTBUY ONLINE was declined and your debit card has been temporarily suspended. Call 1-866-555-0119 now to verify your identity and reactivate your card.",
  }),
  P({
    id: "h-p-paypal-invoice-callback", category: "callback-scam",
    note: "Fake PayPal invoice for antivirus software with a 'dispute' phone number.",
    url: "https://billing-invoice-center.com/inv/77310",
    title: "Invoice from Norton LifeLock",
    text: "PayPal. You've been charged $499.99 USD for Norton LifeLock 360 Total Protection (3-year plan). If you didn't authorize this payment, call the PayPal billing department at 1-808-555-0166 within 24 hours to dispute the charge.",
  }),
  P({
    id: "h-p-microsoft-account-locked", category: "callback-scam",
    note: "Microsoft account 'locked' page with a support number; no form.",
    url: "https://account-protection-center.live/ms/locked",
    title: "Microsoft account locked",
    text: "Your Microsoft account has been locked due to unusual sign-in activity from Moscow, Russia. To protect your data, do not restart your computer. Call Microsoft Support at 1-855-555-0133 to unlock your account.",
  }),
  P({
    id: "h-p-geek-squad-renewal", category: "callback-scam",
    note: "Fake auto-renewal invoice for a brand that may not be on the brand list; no account-lock wording.",
    url: "https://gs-renewal-dept.com/invoice",
    title: "Geek Squad Subscription Renewal",
    text: "Thank you for renewing your Geek Squad Total Protection plan. $399.99 has been charged to your account and the renewal is non-refundable after 24 hours. To cancel and request a refund, call our billing team at 1-888-555-0177.",
  }),
];

export const HELDOUT_2_BENIGN: EvalCase[] = [
  B({
    id: "h-b-credit-union-lost-card", category: "support-phone",
    note: "A credit union's own lost/stolen card page: account-threat words plus a phone number, on its own domain.",
    url: "https://www.navyfederal.org/services/card-services/lost-stolen-cards.html",
    title: "Lost or Stolen Cards | Navy Federal Credit Union",
    text: "Report a lost or stolen card right away. If your card is lost, stolen or you notice unauthorized transactions, we'll lock your card and send a replacement. Call us 24/7 at 1-888-555-0110.",
  }),
  B({
    id: "h-b-airline-rebooking", category: "support-phone",
    note: "Airline page about cancelled flights that says to call to rebook.",
    url: "https://www.flyfrontier.com/travel/travel-info/flight-status/",
    title: "Flight Status | Frontier Airlines",
    text: "Check the status of your flight. If your flight has been cancelled or delayed more than 3 hours, you can rebook online or call our reservations team at 801-555-0123.",
  }),
  B({
    id: "h-b-news-callback-warning", category: "security-news",
    note: "Local news story quoting the callback-scam script, with a brand name and a sheriff's office number.",
    url: "https://www.wral.com/news/local/sheriff-warns-of-bank-impersonation-calls/",
    title: "Sheriff warns of bank impersonation scam",
    text: "The Wake County Sheriff's Office is warning residents about callers claiming to be from Wells Fargo who say your account has been locked and ask you to call a number to unlock it. Victims who called were asked for gift cards. Anyone targeted can report it to 919-555-0155.",
  }),
  B({
    id: "h-b-ftc-callback-advice", category: "government",
    note: "FTC consumer advice describing fake 'your account is suspended, call us' messages.",
    url: "https://consumer.ftc.gov/articles/how-spot-avoid-and-report-tech-support-scams",
    title: "How To Spot, Avoid, and Report Tech Support Scams",
    text: "Scammers may say your account has been suspended or that you were charged for a subscription, and tell you to call a phone number to fix it. Don't call the number. Contact the company using a number you know is real.",
  }),
  B({
    id: "h-b-coinbase-help-compromised", category: "support-phone",
    note: "The brand's own help article on compromised accounts, on its own domain.",
    url: "https://help.coinbase.com/en/coinbase/privacy-and-security/account-compromised/i-think-my-account-was-compromised",
    title: "I think my account was compromised | Coinbase Help",
    text: "If you think your Coinbase account was compromised, lock your account right away from the app. Coinbase will never call you or ask you to call a number to unlock your account. To reach us, use the support options in the app.",
  }),
  B({
    id: "h-b-shop-contact-page", category: "support-phone",
    note: "Small store's contact page with an order-problem phone line.",
    url: "https://www.bluebirdcandleco.com/pages/contact",
    title: "Contact Us - Bluebird Candle Co.",
    text: "Problem with an order or a charge you don't recognize? Call us at 828-555-0142, Monday to Friday 9 to 5, and we'll make it right.",
  }),
];

export const HELDOUT_2_CASES = [...HELDOUT_2_PHISHING, ...HELDOUT_2_BENIGN];
