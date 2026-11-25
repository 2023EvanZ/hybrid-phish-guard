// The in-page notice: a small icon in the top-right corner that expands into a card with
// the verdict, its reasons and how the page was checked. "Phishing" opens expanded (see
// noticeMode in triage/present.ts); "suspicious" starts as the icon alone.
//
// It lives in a closed shadow root so the page's CSS can't restyle it and its scripts
// can't read or rewrite the text through the host element. A hostile page can still
// remove the host; the toolbar badge and side panel remain as backstops.

import type { NoticeMode, Tone, VerdictView } from "../triage/present.ts";

export interface NoticeContent {
  view: VerdictView;
  advice: string;
  /** How the verdict was reached, when there's something to add (provenanceNote). */
  note: string | null;
  mode: NoticeMode;
}

export interface NoticeActions {
  onLeave(): void;
  /** Resolves true if the side panel opened. */
  onFullReport(): Promise<boolean>;
}

const HOST_ID = "hybrid-phish-guard-notice";

const STYLE = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .wrap {
    --accent: #b91c1c; --accent-soft: #fef2f2; --on-accent: #fff;
    --bg: #fff; --fg: #1f2937; --muted: #4b5563; --line: #e5e7eb;
    position: fixed; top: 16px; right: 16px; z-index: 2147483647;
    display: flex; flex-direction: column; align-items: flex-end;
    font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--fg);
  }
  .wrap[data-tone="warning"] { --accent: #b45309; --accent-soft: #fffbeb; }
  @media (prefers-color-scheme: dark) {
    .wrap { --bg: #1f2937; --fg: #f3f4f6; --muted: #cbd5e1; --line: #374151; }
    .wrap[data-tone="danger"] { --accent-soft: #3b1515; }
    .wrap[data-tone="warning"] { --accent-soft: #3a2a10; }
  }

  button { font: inherit; cursor: pointer; }
  button:focus-visible { outline: 3px solid #2563eb; outline-offset: 2px; }

  .icon {
    width: 44px; height: 44px; border-radius: 50%; border: 0; padding: 0;
    display: grid; place-items: center;
    background: var(--accent); color: var(--on-accent);
    box-shadow: 0 4px 14px rgba(0,0,0,.28);
  }
  .icon svg { width: 22px; height: 22px; }
  .wrap[data-open="true"] .icon { display: none; }

  .card {
    display: none; width: min(360px, calc(100vw - 32px));
    max-height: calc(100vh - 32px); overflow: auto;
    background: var(--bg); border-radius: 12px; overflow-wrap: anywhere;
    box-shadow: 0 10px 32px rgba(0,0,0,.30); border: 1px solid var(--line);
  }
  .wrap[data-open="true"] .card { display: block; animation: pop .14s ease-out; }
  @keyframes pop { from { opacity: 0; transform: translateY(-6px) scale(.98); } }
  @media (prefers-reduced-motion: reduce) { .wrap[data-open="true"] .card { animation: none; } }

  .head {
    display: flex; gap: 10px; align-items: flex-start;
    padding: 12px 12px 12px 14px; border-radius: 12px 12px 0 0;
    background: var(--accent); color: var(--on-accent);
  }
  .head svg { flex: none; width: 20px; height: 20px; margin-top: 2px; }
  h2 { flex: 1; margin: 0; font-size: 15px; font-weight: 700; line-height: 1.35; }
  .head button {
    flex: none; width: 28px; height: 28px; border-radius: 6px; border: 0; padding: 0;
    display: grid; place-items: center; background: transparent; color: inherit;
  }
  .head button:hover { background: rgba(255,255,255,.18); }
  .head button svg { width: 16px; height: 16px; margin: 0; }

  .body { padding: 12px 14px 14px; }
  .advice { margin: 0 0 8px; font-weight: 600; }
  ul { margin: 0 0 10px; padding-left: 18px; }
  li + li { margin-top: 2px; }
  .how {
    margin: 0 0 12px; padding: 8px 10px; border-radius: 8px;
    background: var(--accent-soft); color: var(--muted); font-size: 12.5px;
  }
  .how p { margin: 0; }
  .how p + p { margin-top: 4px; }

  .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .actions button {
    flex: 1 1 auto; padding: 8px 12px; border-radius: 8px; font-weight: 600;
    border: 1px solid var(--line); background: transparent; color: var(--fg);
  }
  .actions .primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
  .hint { margin: 8px 0 0; font-size: 12px; color: var(--muted); }
  .brand { margin: 10px 0 0; font-size: 11.5px; color: var(--muted); }
`;

const SVG_NS = "http://www.w3.org/2000/svg";
// Paths drawn on a 24x24 grid, stroked with currentColor.
const ICONS = {
  shield: "M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z M12 8v5 M12 16.5v.01",
  minimize: "M6 12h12",
  close: "M6 6l12 12 M18 6L6 18",
} as const;

function icon(doc: Document, name: keyof typeof ICONS): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const path = doc.createElementNS(SVG_NS, "path");
  path.setAttribute("d", ICONS[name]);
  svg.append(path);
  return svg;
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls?: string, text?: string) {
  const node = doc.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text; // textContent only: text can contain model output
  return node;
}

/** Shows the notice (replacing any existing one) and returns a function that removes it. */
export function showNotice(doc: Document, content: NoticeContent, actions: NoticeActions): () => void {
  doc.getElementById(HOST_ID)?.remove();
  const { view, advice, note, mode } = content;
  const tone: Tone = view.tone;

  const host = doc.createElement("div");
  host.id = HOST_ID;
  // Inline !important so page stylesheets can't hide the host itself.
  host.style.setProperty("display", "block", "important");
  const root = host.attachShadow({ mode: "closed" });

  const wrap = el(doc, "div", "wrap");
  wrap.dataset.tone = tone;

  // Collapsed state: the icon alone.
  const iconBtn = el(doc, "button", "icon");
  iconBtn.setAttribute("aria-label", `Hybrid Phish Guard: ${view.headline}. Show details`);
  iconBtn.setAttribute("aria-expanded", "false");
  iconBtn.title = view.headline;
  iconBtn.append(icon(doc, "shield"));

  // Expanded state: the card.
  const card = el(doc, "section", "card");
  card.setAttribute("role", tone === "danger" ? "alertdialog" : "dialog");
  card.setAttribute("aria-label", `Hybrid Phish Guard: ${view.headline}`);

  const head = el(doc, "div", "head");
  const h = el(doc, "h2", undefined, view.headline);
  const minimize = el(doc, "button");
  minimize.setAttribute("aria-label", "Minimize");
  minimize.title = "Minimize";
  minimize.append(icon(doc, "minimize"));
  const close = el(doc, "button");
  close.setAttribute("aria-label", "Close");
  close.title = "Close";
  close.append(icon(doc, "close"));
  head.append(icon(doc, "shield"), h, minimize, close);

  const body = el(doc, "div", "body");
  body.append(el(doc, "p", "advice", advice));
  if (view.reasons.length) {
    const list = el(doc, "ul");
    for (const r of view.reasons) list.append(el(doc, "li", undefined, r));
    body.append(list);
  }
  const how = el(doc, "div", "how");
  how.append(el(doc, "p", undefined, view.detail));
  if (note) how.append(el(doc, "p", undefined, note));
  body.append(how);

  const buttons = el(doc, "div", "actions");
  const report = el(doc, "button", undefined, "Full report");
  if (tone === "danger") {
    const leave = el(doc, "button", "primary", "Leave this page");
    leave.addEventListener("click", () => actions.onLeave());
    buttons.append(leave, report);
  } else {
    report.classList.add("primary");
    buttons.append(report);
  }
  const hint = el(doc, "p", "hint");
  hint.hidden = true;
  body.append(buttons, hint, el(doc, "p", "brand", "Hybrid Phish Guard"));

  card.append(head, body);
  wrap.append(iconBtn, card);
  const style = doc.createElement("style");
  style.textContent = STYLE;
  root.append(style, wrap);

  const setOpen = (open: boolean, focus: boolean) => {
    wrap.dataset.open = String(open);
    iconBtn.setAttribute("aria-expanded", String(open));
    if (!focus) return;
    const target = open ? (buttons.querySelector("button") as HTMLButtonElement) : iconBtn;
    target.focus({ preventScroll: true });
  };
  const remove = () => host.remove();

  iconBtn.addEventListener("click", () => setOpen(true, true));
  minimize.addEventListener("click", () => setOpen(false, true));
  close.addEventListener("click", remove);
  card.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setOpen(false, true);
  });
  report.addEventListener("click", () => {
    void actions.onFullReport().then((opened) => {
      hint.hidden = opened;
      if (!opened) hint.textContent = "Click the Hybrid Phish Guard icon in the toolbar to see the full report.";
    });
  });

  doc.documentElement.append(host);
  // Phishing opens expanded with focus on "Leave this page", as the banner did.
  setOpen(mode === "expanded", mode === "expanded");
  return remove;
}
