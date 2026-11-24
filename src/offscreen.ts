// Offscreen document: hosts the Firebase AI Logic models for the background service
// worker. Chrome's Prompt API (Gemini Nano) isn't exposed in workers, and an offscreen
// document lives independently of the side panel, so pages are checked on-device whether
// or not the panel is open.
//
// This is a dumb text generator on purpose. Prompt building, redaction, parsing and the
// escalation policy all stay in the background's triage pipeline, so the privacy
// boundary lives in one tested place.
//
// PRIVACY: "on-device" is ONLY_ON_DEVICE, never PREFER_ON_DEVICE, which would silently
// send the unredacted prompt to the cloud when Nano is unavailable.
import { getGenerativeModel, InferenceMode } from "firebase/ai";
import { ai, configMissing } from "./firebase.ts";
import type { GenerateReply, ModelMode, OffscreenRequest, ProbeReply } from "./shared/messages.ts";

const models: Record<ModelMode, ReturnType<typeof getGenerativeModel>> = {
  "on-device": getGenerativeModel(ai, { mode: InferenceMode.ONLY_ON_DEVICE }),
  cloud: getGenerativeModel(ai, { mode: InferenceMode.ONLY_IN_CLOUD }),
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function generate(mode: ModelMode, prompt: string): Promise<string> {
  if (mode === "cloud" && configMissing.length) {
    throw new Error(`Firebase config missing: ${configMissing.join(", ")}`);
  }
  const result = await models[mode].generateContent(prompt);
  return result.response.text();
}

async function timed(mode: ModelMode, prompt: string) {
  const t0 = performance.now();
  const text = await generate(mode, prompt);
  return { ms: Math.round(performance.now() - t0), text: text.trim() };
}

// The first on-device call after Chrome loads Nano took ~16 s in the spike, warm calls
// ~1 s. Pay that cost now, not on the first real page (whose triage gives the local model
// 10 s before escalating).
const WARMUP_PROMPT = "Reply with the single word OK.";
let warmup: ProbeReply["warmup"] = "pending";
timed("on-device", WARMUP_PROMPT).then(
  ({ ms }) => {
    warmup = { ms };
    console.info(`on-device warm-up took ${ms} ms`);
  },
  (e) => {
    warmup = { error: message(e) };
    console.warn("on-device warm-up failed", e);
  },
);

type LM = { availability(): Promise<string> };

async function probe(): Promise<ProbeReply> {
  const lm = (self as unknown as { LanguageModel?: LM }).LanguageModel;
  let availability: string | null = null;
  if (lm) {
    try {
      availability = await lm.availability();
    } catch (e) {
      availability = `threw: ${message(e)}`;
    }
  }
  let probeResult: ProbeReply["probe"];
  try {
    probeResult = await timed("on-device", WARMUP_PROMPT);
  } catch (e) {
    probeResult = { error: message(e) };
  }
  return { languageModelGlobal: Boolean(lm), availability, warmup, probe: probeResult };
}

chrome.runtime.onMessage.addListener((msg: OffscreenRequest, sender, sendResponse) => {
  // Only our own background (no tab) may drive the models.
  if (msg?.target !== "offscreen" || sender.id !== chrome.runtime.id || sender.tab) return;
  if (msg.type === "generate") {
    generate(msg.mode, msg.prompt).then(
      (text) => sendResponse({ ok: true, text } satisfies GenerateReply),
      (e) => sendResponse({ ok: false, error: message(e) } satisfies GenerateReply),
    );
    return true;
  }
  if (msg.type === "probe") {
    void probe().then(sendResponse);
    return true;
  }
});
