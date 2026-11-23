// The in-page warning. Lives in a closed shadow root so the page's CSS can't restyle it
// and its scripts can't read or rewrite the text through the host element. A hostile
// page can still remove the host; the toolbar badge and side panel remain as backstops.

import type { VerdictView } from "../triage/present.ts";

export interface BannerActions {
  onLeave(): void;
}

const HOST_ID = "hybrid-phish-guard-banner";

const STYLE = `
  :host { all: initial; }
  .bar {
    position: fixed; inset: 0 0 auto 0; z-index: 2147483647;
    display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap;
    padding: 14px 20px; box-sizing: border-box;
    background: #b91c1c; color: #fff;
    font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
    box-shadow: 0 2px 12px rgba(0,0,0,.35);
  }
  .text { flex: 1 1 320px; min-width: 0; }
  h2 { margin: 0 0 4px; font-size: 17px; font-weight: 700; }
  ul { margin: 4px 0 6px; padding-left: 18px; }
  .meta { opacity: .85; font-size: 12px; }
  .actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  button {
    font: inherit; font-weight: 600; cursor: pointer; border-radius: 6px;
    padding: 8px 14px; border: 2px solid #fff;
  }
  .leave { background: #fff; color: #991b1b; }
  .dismiss { background: transparent; color: #fff; }
  button:focus-visible { outline: 3px solid #fde68a; outline-offset: 2px; }
`;

/** Shows the banner (replacing any existing one) and returns a function that removes it. */
export function showBanner(doc: Document, view: VerdictView, actions: BannerActions): () => void {
  doc.getElementById(HOST_ID)?.remove();

  const host = doc.createElement("div");
  host.id = HOST_ID;
  // Inline !important so page stylesheets can't hide the host itself.
  host.style.setProperty("display", "block", "important");
  const root = host.attachShadow({ mode: "closed" });

  const style = doc.createElement("style");
  style.textContent = STYLE;

  const bar = doc.createElement("div");
  bar.className = "bar";
  bar.setAttribute("role", "alert");

  const text = doc.createElement("div");
  text.className = "text";
  const h = doc.createElement("h2");
  h.textContent = `Warning: ${view.headline}`;
  const intro = doc.createElement("div");
  intro.textContent = "Don't enter passwords, card numbers or codes here.";
  const list = doc.createElement("ul");
  for (const r of view.reasons) {
    const li = doc.createElement("li");
    li.textContent = r; // textContent only: reasons can contain model output
    list.append(li);
  }
  const meta = doc.createElement("div");
  meta.className = "meta";
  meta.textContent = `Hybrid Phish Guard · ${view.detail}`;
  text.append(h, intro);
  if (view.reasons.length) text.append(list);
  text.append(meta);

  const buttons = doc.createElement("div");
  buttons.className = "actions";
  const leave = doc.createElement("button");
  leave.className = "leave";
  leave.textContent = "Leave this page";
  const dismiss = doc.createElement("button");
  dismiss.className = "dismiss";
  dismiss.textContent = "Dismiss";
  buttons.append(leave, dismiss);

  bar.append(text, buttons);
  root.append(style, bar);

  const remove = () => host.remove();
  leave.addEventListener("click", () => actions.onLeave());
  dismiss.addEventListener("click", remove);

  doc.documentElement.append(host);
  leave.focus({ preventScroll: true });
  return remove;
}
