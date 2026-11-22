// Test-only stand-in for the chrome.* APIs the content script uses, so the built
// dist/content.js can run on a plain web page. Records every message it sends.
window.__hpgSent = [];
Object.defineProperty(window, "chrome", {
  configurable: true,
  value: {
    runtime: {
      id: "test-harness",
      sendMessage(msg) { window.__hpgSent.push(msg); return Promise.resolve(); },
      onMessage: { addListener(fn) { window.__hpgListener = fn; } },
    },
  },
});
// Simulates the side panel's "Inspect this page now" request.
window.__hpgInspect = () => new Promise((resolve) => window.__hpgListener({ type: "hpg/inspect" }, {}, resolve));
