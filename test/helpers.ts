// Builds realistic PageFeatures from plain inputs using the real (pure) prefilter
// functions, so triage tests don't need a DOM.
import { decide, formSignals, textSignals, urlSignals } from "../src/prefilter/signals.ts";
import type { FieldDescriptor, FormDescriptor } from "../src/prefilter/signals.ts";
import type { PageFeatures } from "../src/shared/messages.ts";

export const field = (over: Partial<FieldDescriptor>): FieldDescriptor => ({
  type: "text", name: "", id: "", autocomplete: "", placeholder: "", label: "", ...over,
});

export function makeFeatures(opts: {
  url: string;
  title?: string;
  text?: string;
  forms?: FormDescriptor[];
}): PageFeatures {
  const url = new URL(opts.url);
  const title = opts.title ?? "";
  const text = opts.text ?? "";
  const u = urlSignals(url);
  const f = formSignals(opts.forms ?? [], url);
  const t = textSignals(title, text, u.hostname);
  return {
    url: url.href,
    title,
    urlSignals: u,
    forms: f.forms,
    text: t,
    links: { total: 0, external: 0, mismatchedText: 0 },
    textSnippet: text.slice(0, 1500),
    prefilter: decide(u, f, t),
    capturedAt: 0,
  };
}

export const phishFeatures = () =>
  makeFeatures({
    url: "https://wellsfarg0-secure-login.example.ru/verify?user=jane.doe@gmail.com#c2Vzc2lvbg",
    title: "Wells Fargo Sign On",
    text: "Dear Jane, your account has been locked. Verify your identity within 24 hours. Call 704-555-0199 or reply to jane.doe@gmail.com. Card 4111 1111 1111 1111.",
    forms: [
      {
        action: "https://collect.evil.example/p.php?id=8f3a9c2b7d1e4f60a1b2",
        method: "post",
        synthetic: false,
        fields: [field({ type: "email" }), field({ type: "password" })],
      },
    ],
  });

export const benignFeatures = () =>
  makeFeatures({
    url: "https://shop.example.com/login",
    title: "Sign in | Example Shop",
    text: "Sign in to track your orders.",
    forms: [{ action: "/session", method: "post", synthetic: false, fields: [field({ type: "email" }), field({ type: "password" })] }],
  });
