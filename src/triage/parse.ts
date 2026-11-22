// Defensive parser for model output. Small on-device models drift from the requested
// format (code fences, prose around the JSON, synonyms, 0-100 confidence), so we accept
// what is unambiguous and reject the rest, which the pipeline treats as a local failure
// and escalates.

import type { Verdict } from "./types.ts";

export interface ParsedVerdict {
  verdict: Verdict;
  confidence: number;
  reasons: string[];
}

export type ParseResult = { ok: true; value: ParsedVerdict } | { ok: false; error: string };

/** Used when the model omits confidence: low enough that the policy escalates. */
export const DEFAULT_CONFIDENCE = 0.5;
const MAX_REASONS = 3;
const MAX_REASON_CHARS = 140;

const VERDICT_SYNONYMS: Record<string, Verdict> = {
  phishing: "phishing", phish: "phishing", malicious: "phishing", scam: "phishing", fraud: "phishing", fraudulent: "phishing",
  suspicious: "suspicious", unsure: "suspicious", uncertain: "suspicious", unknown: "suspicious",
  safe: "safe", benign: "safe", legitimate: "safe", legit: "safe",
};

function extractJsonObject(text: string): string | null {
  const unfenced = text.replace(/```(?:json)?/gi, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  return start !== -1 && end > start ? unfenced.slice(start, end + 1) : null;
}

function normalizeConfidence(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number.parseFloat(raw) : raw;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  // Some models answer on a 0-100 scale.
  const scaled = n > 1 && n <= 100 ? n / 100 : n;
  return scaled <= 1 ? scaled : null;
}

function normalizeReasons(raw: unknown): string[] {
  const items = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  return items
    .filter((r): r is string => typeof r === "string")
    .map((r) => r.replace(/\s+/g, " ").trim().slice(0, MAX_REASON_CHARS))
    .filter(Boolean)
    .slice(0, MAX_REASONS);
}

export function parseVerdict(text: string): ParseResult {
  const json = extractJsonObject(text);
  if (!json) return { ok: false, error: "no JSON object in model output" };

  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    return { ok: false, error: "model output is not valid JSON" };
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    return { ok: false, error: "model output is not a JSON object" };
  }

  const rec = obj as Record<string, unknown>;
  const label = typeof rec.verdict === "string" ? rec.verdict.trim().toLowerCase() : "";
  const verdict = VERDICT_SYNONYMS[label];
  if (!verdict) return { ok: false, error: `unrecognised verdict: ${JSON.stringify(rec.verdict)}` };

  const confidence = rec.confidence === undefined ? DEFAULT_CONFIDENCE : normalizeConfidence(rec.confidence);
  if (confidence === null) return { ok: false, error: `invalid confidence: ${JSON.stringify(rec.confidence)}` };

  return { ok: true, value: { verdict, confidence, reasons: normalizeReasons(rec.reasons) } };
}
