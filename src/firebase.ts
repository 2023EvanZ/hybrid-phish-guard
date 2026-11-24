import { initializeApp } from "firebase/app";
import { initializeAppCheck, CustomProvider } from "firebase/app-check";
import { getAI, GoogleAIBackend } from "firebase/ai";

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

// App Check runs in debug mode in development builds only. Release builds (`npm run
// build:release`) skip it: the only provider an MV3 extension can use without remote
// code is a debug token, and a debug token shipped in a public zip is a leaked secret.
// So App Check is NOT enforced on the Firebase project, and the release says so.
const RELEASE = import.meta.env.MODE === "release"; // direct form, so release builds drop the branch
if (!RELEASE) {
  // `true` makes the SDK generate a token and print it to the console; a string pins a
  // token you already registered in the Firebase console. Must be set before
  // initializeAppCheck().
  (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN =
    env.VITE_APPCHECK_DEBUG_TOKEN || true;
  initDebugAppCheck();
}

// ASSUMPTION UNDER TEST: reCAPTCHA providers inject a remote <script>, which MV3's CSP
// blocks. A CustomProvider loads nothing remote; in debug mode the SDK should exchange
// the debug token instead of calling getToken() below. If App Check calls fail, this is
// the first place to look.
function initDebugAppCheck() {
  initializeAppCheck(app, {
    provider: new CustomProvider({
      getToken: () =>
        Promise.reject(new Error("No production App Check provider configured; debug token only.")),
    }),
    isTokenAutoRefreshEnabled: true,
  });
}

export const ai = getAI(app, { backend: new GoogleAIBackend() });
