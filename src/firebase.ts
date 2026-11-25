import { initializeApp } from "firebase/app";
import { getAI, GoogleAIBackend } from "firebase/ai";
import { initAppCheck } from "./appcheck.ts";

const env = import.meta.env;

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

export const configMissing = Object.entries(firebaseConfig)
  .filter(([, v]) => !v)
  .map(([k]) => k);

export const app = initializeApp(firebaseConfig);

// App Check runs with a debug token in development builds only; release builds swap
// appcheck.ts for a no-op (see vite.config.ts), so App Check is NOT enforced on the
// Firebase project, and the release says so. Must come before getAI().
initAppCheck(app);

export const ai = getAI(app, { backend: new GoogleAIBackend() });
