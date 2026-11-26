import { BENIGN_CASES } from "./benign.ts";
import { HELDOUT_1_CASES } from "./heldout-1.ts";
import { PHISHING_CASES } from "./phishing.ts";

/** The dev set: everything tuned against, including held-out set 1 since it was retired
 *  (2026-11-26). Set 1's ids keep their h- prefix so earlier runs stay traceable. */
export const ALL_CASES = [...PHISHING_CASES, ...BENIGN_CASES, ...HELDOUT_1_CASES];
