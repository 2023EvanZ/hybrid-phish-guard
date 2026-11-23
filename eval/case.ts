// Labeled evaluation cases, written compactly and turned into PageFeatures with the same
// pure prefilter functions the content script uses. No DOM, no network: an eval case is
// a description of a page, not a live page.

import type { FieldDescriptor, FormDescriptor } from "../src/prefilter/signals.ts";
import type { LinkStats, PageFeatures } from "../src/shared/messages.ts";
import { field, makeFeatures } from "../test/helpers.ts";

export type Label = "phishing" | "benign";

/**
 * Field shorthand, so cases stay readable:
 *   email, user, password, card, cvv, exp, ssn, routing, account, otp, phone, name, address
 *   text:<name>  any other text input, identified only by its name attribute
 */
export type FieldSpec = string;

export interface FormSpec {
  /** Raw action attribute; omit for a form that submits to the page itself. */
  action?: string;
  method?: string;
  fields: FieldSpec[];
  /** Inputs outside any <form>, as single-page apps render them. */
  synthetic?: boolean;
}

export interface EvalCase {
  id: string;
  label: Label;
  /** Scenario family, for the per-category breakdown (e.g. "brand-lookalike"). */
  category: string;
  /** Why the case exists and what makes it easy or hard. */
  note: string;
  url: string;
  title?: string;
  text?: string;
  forms?: FormSpec[];
  links?: LinkStats;
}

const SHORTHAND: Record<string, Partial<FieldDescriptor>> = {
  email: { type: "email", name: "email" },
  user: { name: "username", autocomplete: "username" },
  password: { type: "password", name: "password" },
  card: { name: "cardnumber", autocomplete: "cc-number" },
  cvv: { name: "cvv" },
  exp: { name: "expiry", autocomplete: "cc-exp" },
  ssn: { name: "ssn" },
  routing: { name: "routing_number" },
  account: { name: "account_number" },
  otp: { name: "code", autocomplete: "one-time-code" },
  phone: { type: "tel", name: "phone" },
  name: { name: "full_name" },
  address: { name: "address" },
};

export function expandField(spec: FieldSpec): FieldDescriptor {
  if (spec.startsWith("text:")) return field({ name: spec.slice(5) });
  const over = SHORTHAND[spec];
  if (!over) throw new Error(`unknown field shorthand "${spec}"`);
  return field(over);
}

export function expandForm(spec: FormSpec): FormDescriptor {
  return {
    action: spec.action ?? null,
    method: spec.method ?? "post",
    fields: spec.fields.map(expandField),
    synthetic: spec.synthetic ?? false,
  };
}

export function caseFeatures(c: EvalCase): PageFeatures {
  return makeFeatures({
    url: c.url,
    title: c.title,
    text: c.text,
    forms: (c.forms ?? []).map(expandForm),
    links: c.links,
  });
}
