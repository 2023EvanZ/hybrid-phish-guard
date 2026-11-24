// TextModel backed by the offscreen document. The transport is injected so this is
// unit-testable without Chrome; the background passes a chrome.runtime.sendMessage
// wrapper that first makes sure the offscreen document exists.

import type { GenerateReply, ModelMode, OffscreenRequest } from "../shared/messages.ts";
import type { TextModel } from "./model.ts";

export type OffscreenSend = (req: OffscreenRequest) => Promise<unknown>;

function isGenerateReply(x: unknown): x is GenerateReply {
  if (typeof x !== "object" || x === null) return false;
  const r = x as Record<string, unknown>;
  return (r.ok === true && typeof r.text === "string") || (r.ok === false && typeof r.error === "string");
}

export function offscreenTextModel(mode: ModelMode, send: OffscreenSend): TextModel {
  return {
    async generate(prompt) {
      const reply = await send({ target: "offscreen", type: "generate", mode, prompt });
      // undefined = no listener answered (document missing or still loading).
      if (!isGenerateReply(reply)) throw new Error(`${mode} model: no reply from the offscreen document`);
      if (!reply.ok) throw new Error(`${mode} model: ${reply.error}`);
      return reply.text;
    },
  };
}
