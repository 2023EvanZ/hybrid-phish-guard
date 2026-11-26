// Test-only stand-in for the chrome.* APIs the content script uses, so the built
// dist/content.js can run on a plain web page. Records every message it sends and
// answers reports the way the background's rules fallback would (score >= 8 is
// phishing, >= 4 suspicious), without running the real pipeline.
window.__hpgSent = [];
const fakeVerdict = (report) => {
  if (!report.features) return null;
  const score = report.prefilter.score;
  const verdict = score >= 8 ? "phishing" : score >= 4 ? "suspicious" : "safe";
  return {
    final: { verdict, confidence: 0.75, reasons: ["Web address imitates a known brand", "Sensitive form submits to a different site"], source: "rules", latencyMs: 0 },
    local: null, cloud: null, escalation: { escalate: true, reason: "no-local-result" }, errors: [],
  };
};
Object.defineProperty(window, "chrome", {
  configurable: true,
  value: {
    runtime: {
      id: "test-harness",
      sendMessage(msg) {
        window.__hpgSent.push(msg);
        if (msg.type === "hpg/report") return Promise.resolve({ verdict: fakeVerdict(msg.report) });
        // The real background also checks the stored verdict is "suspicious" (hostToTrust).
        if (msg.type === "hpg/trust") return Promise.resolve({ host: location.hostname });
        return Promise.resolve(undefined);
      },
      onMessage: { addListener(fn) { window.__hpgListener = fn; } },
    },
  },
});
// Simulates the side panel's "Inspect this page now" request.
window.__hpgInspect = () => new Promise((resolve) => window.__hpgListener({ type: "hpg/inspect" }, {}, resolve));
