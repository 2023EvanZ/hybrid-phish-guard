import type { PageFeatures } from "../shared/messages.ts";

export type Verdict = "phishing" | "suspicious" | "safe";

/** Where a verdict came from. "rules" = the deterministic fallback, no model involved. */
export type VerdictSource = "on-device" | "cloud" | "rules";

export interface TriageResult {
  verdict: Verdict;
  /** 0..1, the classifier's own confidence in `verdict`. */
  confidence: number;
  /** Short human-readable reasons, at most 3. */
  reasons: string[];
  source: VerdictSource;
  latencyMs: number;
}

/** Anything that can turn page features into a verdict: a model-backed or rule-based classifier. */
export interface Classifier {
  readonly source: VerdictSource;
  classify(features: PageFeatures): Promise<TriageResult>;
}
