// npm run eval [-- --json out.json]
//
// Scores the rules classifier (the fallback the extension uses with no model) on the
// labeled cases. The Firebase models can't run under Node: Gemini Nano only exists
// inside Chrome. Model runs will go through the side panel and reuse eval/metrics.ts.

import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { rulesClassifier } from "../src/triage/rules.ts";
import { ALL_CASES } from "./cases/index.ts";
import { evaluateCases } from "./evaluate.ts";
import { summarize } from "./metrics.ts";
import type { Confusion } from "./metrics.ts";

const { values } = parseArgs({ options: { json: { type: "string" } } });

const pct = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`);
const line = (name: string, c: Confusion) =>
  `${name.padEnd(9)} precision ${pct(c.precision).padStart(6)}  recall ${pct(c.recall).padStart(6)}  ` +
  `F1 ${pct(c.f1).padStart(6)}  FPR ${pct(c.falsePositiveRate).padStart(6)}   (TP ${c.tp} FP ${c.fp} FN ${c.fn} TN ${c.tn})`;

const outcomes = await evaluateCases(ALL_CASES, rulesClassifier);
const s = summarize(outcomes);

console.log(`Classifier: ${rulesClassifier.source}   cases: ${s.n.phishing} phishing, ${s.n.benign} benign\n`);
console.log(`Gate      phishing pages checked ${pct(s.gate.phishingChecked)}   benign pages checked ${pct(s.gate.benignChecked)}`);
console.log(line("Strict", s.strict) + "   phishing verdict only");
console.log(line("Lenient", s.lenient) + "   phishing or suspicious\n");

console.log("By category (flagged / total, lenient):");
for (const r of s.byCategory) {
  console.log(`  ${r.label.padEnd(8)} ${r.category.padEnd(22)} ${String(r.flagged).padStart(2)} / ${r.n}`);
}

console.log("\nErrors (lenient):");
for (const e of s.errors) {
  const kind = e.label === "phishing" ? "MISSED " : "FALSE+ ";
  console.log(`  ${kind} ${e.id.padEnd(30)} predicted ${e.prediction.padEnd(10)} score ${e.score}`);
}

if (values.json) {
  writeFileSync(values.json, JSON.stringify({ classifier: rulesClassifier.source, summary: s, outcomes }, null, 2));
  console.log(`\nWrote ${values.json}`);
}
