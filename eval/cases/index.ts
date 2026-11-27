import { BENIGN_CASES } from "./benign.ts";
import { HELDOUT_1_CASES } from "./heldout-1.ts";
import { HELDOUT_2_CASES } from "./heldout-2.ts";
import { PHISHING_CASES } from "./phishing.ts";

/** The dev set: everything tuned against, including held-out sets 1 and 2 since they were
 *  retired (2026-11-26, 2026-11-27). Their ids keep the h- prefix so earlier runs stay
 *  traceable. */
export const ALL_CASES = [...PHISHING_CASES, ...BENIGN_CASES, ...HELDOUT_1_CASES, ...HELDOUT_2_CASES];
