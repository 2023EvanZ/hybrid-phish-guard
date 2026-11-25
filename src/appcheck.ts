// App Check setup for development builds. Release builds (`vite build --mode release`)
// replace this module with appcheck.release.ts through an alias in vite.config.ts, so the
// App Check library never ends up in the zip: the only provider an MV3 extension can use
// without remote code is a debug token, and a debug token in a public zip is a leaked
// secret. scripts/package-release.ts fails the release if App Check code shows up anyway.
//
// Must run before getAI(): firebase/ai reads App Check once, when the AI instance is made.
import type { FirebaseApp } from "firebase/app";
import { CustomProvider, initializeAppCheck } from "firebase/app-check";

export function initAppCheck(app: FirebaseApp): void {
  // `true` makes the SDK generate a token and print it to the console; a string pins a
  // token you already registered in the Firebase console. Must be set before
  // initializeAppCheck().
  (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN =
    import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true;
  // reCAPTCHA providers inject a remote <script>, which MV3's CSP blocks. A CustomProvider
  // loads nothing remote; in debug mode the SDK exchanges the debug token instead of
  // calling getToken() below.
  initializeAppCheck(app, {
    provider: new CustomProvider({
      getToken: () =>
        Promise.reject(new Error("No production App Check provider configured; debug token only.")),
    }),
    isTokenAutoRefreshEnabled: true,
  });
}
