// Test-only stand-in for the chrome.* APIs the content script uses, so the built
// dist/content.js can run on a plain web page. Records every message it sends and
// answers reports the way the background's rules fallback would (score >= 8 is
// phishing, >= 4 suspicious), without running the real pipeline.
// ?route= picks where the fake verdict came from: rules (default), device, cloud, or
// cloud-failed (sent to the cloud, no answer, Nano's verdict kept).
window.__hpgSent = [];
const ROUTE = new URLSearchParams(location.search).get("route") || "rules";
const fakeVerdict = (report) => {
  if (!report.features) return null;
  const score = report.prefilter.score;
  const verdict = score >= 8 ? "phishing" : score >= 4 ? "suspicious" : "safe";
  const result = (source) => ({ verdict, confidence: 0.75, reasons: ["Web address imitates a known brand", "Sensitive form submits to a different site"], source, latencyMs: 0 });
  const base = { local: null, cloud: null, escalation: { escalate: true, reason: "no-local-result" }, errors: [], sentToCloud: null };
  if (ROUTE === "device") return { ...base, final: result("on-device"), local: result("on-device"), escalation: { escalate: false, reason: "confident" } };
  if (ROUTE === "cloud") return { ...base, final: result("cloud"), local: result("on-device"), cloud: result("cloud"), escalation: { escalate: true, reason: "low-confidence" }, sentToCloud: report.features };
  if (ROUTE === "cloud-failed") return { ...base, final: result("on-device"), local: result("on-device"), escalation: { escalate: true, reason: "low-confidence" }, errors: ["cloud model timed out after 20000 ms"], sentToCloud: report.features };
  return { ...base, final: result("rules") };
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
