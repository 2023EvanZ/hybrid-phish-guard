// Release builds use this in place of appcheck.ts (see vite.config.ts): no App Check.
import type { FirebaseApp } from "firebase/app";

export function initAppCheck(_app: FirebaseApp): void {}
