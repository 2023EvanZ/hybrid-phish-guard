import { getGenerativeModel, InferenceMode } from "firebase/ai";
import { ai, configMissing } from "./firebase";
import type { HpgMessage } from "./shared/messages.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const logEl = $<HTMLPreElement>("log");
const log = (msg: string) => {
  logEl.textContent += `${new Date().toLocaleTimeString()}  ${msg}\n`;
  logEl.scrollTop = logEl.scrollHeight;
};

const PROMPT_PREFIX =
  "You are a phishing and scam detector. Classify the message below. " +
  'Answer with one line: "PHISHING" or "SAFE", then one short reason.\n\nMessage:\n';

if (configMissing.length) {
  log(`Firebase config missing: ${configMissing.join(", ")}. Copy .env.example to .env, fill it in, rebuild.`);
}

const models = {
  device: getGenerativeModel(ai, { mode: InferenceMode.ONLY_ON_DEVICE }),
  prefer: getGenerativeModel(ai, { mode: InferenceMode.PREFER_ON_DEVICE }),
  cloud: getGenerativeModel(ai, { mode: InferenceMode.ONLY_IN_CLOUD }),
};

async function run(label: keyof typeof models) {
  const text = $<HTMLTextAreaElement>("input").value;
  log(`[${label}] running...`);
  const t0 = performance.now();
  try {
    const result = await models[label].generateContent(PROMPT_PREFIX + text);
    const ms = Math.round(performance.now() - t0);
    log(`[${label}] ${ms} ms -> ${result.response.text().trim()}`);
  } catch (err) {
    log(`[${label}] FAILED after ${Math.round(performance.now() - t0)} ms: ${String(err)}`);
    console.error(err);
  }
}

$("avail").onclick = async () => {
  // Raw Chrome Prompt API, bypassing Firebase, to separate "Chrome can't" from "Firebase can't".
  const LM = (self as unknown as { LanguageModel?: { availability(): Promise<string> } }).LanguageModel;
  if (!LM) return log("LanguageModel global is undefined in this context (Prompt API not exposed here).");
  try {
    log(`LanguageModel.availability() = ${await LM.availability()}`);
  } catch (err) {
    log(`LanguageModel.availability() threw: ${String(err)}`);
  }
};

$("init").onclick = async () => {
  // Must be triggered by a user gesture, per the Firebase docs.
  log("initializeDeviceModel: starting (first download can take minutes)...");
  try {
    await models.device.initializeDeviceModel((p: number) =>
      log(`download progress: ${Math.round(p * 10000) / 100}%`),
    );
    log("initializeDeviceModel: done");
  } catch (err) {
    log(`initializeDeviceModel FAILED: ${String(err)}`);
    console.error(err);
  }
};

$("device").onclick = () => run("device");
$("prefer").onclick = () => run("prefer");
$("cloud").onclick = () => run("cloud");

$("offscreen").onclick = async () => {
  log("[offscreen] probing (creates the document if needed)...");
  try {
    const reply = await chrome.runtime.sendMessage({ type: "hpg/probe-offscreen" } satisfies HpgMessage);
    log(`[offscreen] ${JSON.stringify(reply)}`);
  } catch (err) {
    log(`[offscreen] FAILED: ${String(err)}`);
  }
};
