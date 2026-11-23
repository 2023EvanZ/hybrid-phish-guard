import { BENIGN_CASES } from "./benign.ts";
import { PHISHING_CASES } from "./phishing.ts";

export const ALL_CASES = [...PHISHING_CASES, ...BENIGN_CASES];
