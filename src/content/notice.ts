// The in-page notice: a small icon in the top-right corner that expands into a card with
// the verdict, its reasons and how the page was checked. It always starts as the icon
// (see showsNotice in triage/present.ts). "Phishing" gets a red icon with a pulsing ring
// and is announced to screen readers; "suspicious" gets a plain amber icon.
//
// It lives in a closed shadow root so the page's CSS can't restyle it and its scripts
// can't read or rewrite the text through the host element. A hostile page can still
// remove the host; the toolbar badge and side panel remain as backstops.

import type { Tone, VerdictView, WhereView } from "../triage/present.ts";

export interface NoticeContent {
  view: VerdictView;
  advice: string;
  /** How the verdict was reached, when there's something to add (provenanceNote). */
  note: string | null;
  /** True while this is the instant rules verdict and the models haven't answered yet. */
  pending?: boolean;
  /** Offer Gemini Nano's explanation when the card is opened (on-device verdicts only:
   *  they come without reasons, to keep Nano fast). */
  explainable?: boolean;
  /** Offer "Trust this site" (suspicious verdicts only; the background enforces it too). */
  trustable?: boolean;
  /** Whether anything about the page left the device (whereView). Omitted while the
   *  verdict is pending or unknown, since the AI check may still send it. */
  where?: WhereView | null;
}

export interface NoticeActions {
  onLeave(): void;
  /** Resolves true if the side panel opened. */
  onFullReport(): Promise<boolean>;
  /** Gemini Nano's reasons for its verdict, or null if it couldn't give them. */
  onExplain(): Promise<string[] | null>;
  /** Trusts this site. Resolves to the trusted hostname, or null if it was refused. */
  onTrust(): Promise<string | null>;
}

export interface NoticeHandle {
  /** Replaces the content, keeping the open or minimized state. */
  update(content: NoticeContent): void;
  remove(): void;
  /** False once the notice is closed, or removed by the page. */
  readonly connected: boolean;
  /** True if the user closed it with the × button. */
  readonly closedByUser: boolean;
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
  /* Phishing: a ring that pulses a few times to draw the eye, then stays as a halo. */
  .wrap[data-tone="danger"] .icon { animation: ring 1.6s ease-out 4; box-shadow: 0 0 0 4px rgba(185,28,28,.35), 0 4px 14px rgba(0,0,0,.28); }
  @keyframes ring {
    0% { box-shadow: 0 0 0 0 rgba(185,28,28,.6), 0 4px 14px rgba(0,0,0,.28); }
    100% { box-shadow: 0 0 0 14px rgba(185,28,28,0), 0 4px 14px rgba(0,0,0,.28); }
  }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

  .card {
    display: none; width: min(360px, calc(100vw - 32px));
    max-height: calc(100vh - 32px); overflow: auto;
    background: var(--bg); border-radius: 12px; overflow-wrap: anywhere;
    box-shadow: 0 10px 32px rgba(0,0,0,.30); border: 1px solid var(--line);
  }
  .wrap[data-open="true"] .card { display: block; animation: pop .14s ease-out; }
  @keyframes pop { from { opacity: 0; transform: translateY(-6px) scale(.98); } }
  @media (prefers-reduced-motion: reduce) {
    .wrap[data-open="true"] .card, .wrap[data-tone="danger"] .icon { animation: none; }
  }

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
  .actions button[aria-disabled="true"] { opacity: .6; cursor: progress; }
  .hint { margin: 8px 0 0; font-size: 12px; color: var(--muted); }
  .ai { margin: 0 0 10px; }
  .ai h3 { margin: 0 0 2px; font-size: 12.5px; font-weight: 600; color: var(--muted); }
  .ai p { margin: 0; font-size: 12.5px; color: var(--muted); }
  .brand { margin: 10px 0 0; font-size: 11.5px; color: var(--muted); }
  .where {
    display: flex; gap: 6px; align-items: flex-start; flex-wrap: wrap;
    margin: -4px 0 12px; font-size: 12.5px; color: var(--muted);
  }
  .where svg { flex: none; width: 16px; height: 16px; margin-top: 1px; }
  .where span { flex: 1 1 200px; }
  .where button {
    border: 0; padding: 0; background: none; color: inherit; font-weight: 600;
    text-decoration: underline; text-underline-offset: 2px; margin-left: 22px;
  }
`;

const SVG_NS = "http://www.w3.org/2000/svg";
// Paths drawn on a 24x24 grid, stroked with currentColor.
const ICONS = {
  shield: "M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z M12 8v5 M12 16.5v.01",
  minimize: "M6 12h12",
  close: "M6 6l12 12 M18 6L6 18",
  device: "M5 5h14v10H5z M3 19h18",
  cloud: "M7 18h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.2 9.6 4.2 4.2 0 0 0 7 18z",
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

/** Shows the notice (replacing any existing one). It always starts minimized to the icon. */
export function showNotice(doc: Document, initial: NoticeContent, actions: NoticeActions): NoticeHandle {
  doc.getElementById(HOST_ID)?.remove();

  const host = doc.createElement("div");
  host.id = HOST_ID;
  // Inline !important so page stylesheets can't hide the host itself.
  host.style.setProperty("display", "block", "important");
  const root = host.attachShadow({ mode: "closed" });
  const wrap = el(doc, "div", "wrap");

  // Collapsed state: the icon alone.
  const iconBtn = el(doc, "button", "icon");
  iconBtn.setAttribute("aria-expanded", "false");
  iconBtn.append(icon(doc, "shield"));

  // Expanded state: the card. Its body is rebuilt by render() on every update.
  const card = el(doc, "section", "card");
  const head = el(doc, "div", "head");
  const h = el(doc, "h2");
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
  card.append(head, body);

  // Screen readers hear phishing warnings without the card opening or focus moving.
  const live = el(doc, "div", "sr");
  live.setAttribute("role", "alert");
  wrap.append(iconBtn, card, live);
  const style = doc.createElement("style");
  style.textContent = STYLE;
  root.append(style, wrap);

  let content = initial;
  type Explanation = { state: "idle" } | { state: "loading" } | { state: "failed" } | { state: "done"; reasons: string[] };
  let explanation: Explanation = { state: "idle" };
  let hintText = "";
  let announced = false;
  type Trust = { state: "idle" } | { state: "saving" } | { state: "done"; host: string };
  let trust: Trust = { state: "idle" };

  // render() rebuilds the body, which would drop keyboard focus on <body> whenever the
  // verdict updates (pending -> final), a hint appears or Trust/Explain finish. Buttons
  // carry a stable key so focus can be put back on the same one, or a sensible neighbour.
  const keyed = <T extends HTMLElement>(node: T, key: string): T => {
    node.dataset.k = key;
    return node;
  };
  function render() {
    const active = root.activeElement as HTMLElement | null;
    const prevKey = active && body.contains(active) ? (active.dataset.k ?? "") : null;
    draw();
    if (prevKey === null || body.contains(root.activeElement)) return;
    const target = (prevKey && body.querySelector<HTMLElement>(`[data-k="${prevKey}"]`)) || body.querySelector<HTMLElement>(".actions button") || minimize;
    target.focus({ preventScroll: true });
  }

  function draw() {
    const { view, advice, note, pending, explainable, trustable, where } = content;
    const tone: Tone = view.tone;
    wrap.dataset.tone = tone;
    iconBtn.setAttribute("aria-label", `Hybrid Phish Guard: ${view.headline}. Show details`);
    iconBtn.title = view.headline;
    card.setAttribute("role", tone === "danger" ? "alertdialog" : "dialog");
    card.setAttribute("aria-label", `Hybrid Phish Guard: ${view.headline}`);
    h.textContent = view.headline;

    if (trust.state === "done") {
      h.textContent = "Site trusted";
      body.replaceChildren(
        el(doc, "p", "advice", `${trust.host} won't be checked automatically from now on.`),
        el(doc, "p", "hint", "To undo this, open the side panel and remove it under Trusted sites."),
        el(doc, "p", "brand", "Hybrid Phish Guard"),
      );
      return;
    }
    const parts: HTMLElement[] = [el(doc, "p", "advice", advice)];
    if (view.reasons.length) {
      const list = el(doc, "ul");
      for (const r of view.reasons) list.append(el(doc, "li", undefined, r));
      parts.push(list);
    }
    if (explainable && explanation.state !== "idle") {
      const ai = el(doc, "div", "ai");
      ai.append(el(doc, "h3", undefined, "Gemini Nano's explanation"));
      if (explanation.state === "loading") ai.append(el(doc, "p", undefined, "Asking the on-device model…"));
      else if (explanation.state === "failed") ai.append(el(doc, "p", undefined, "The on-device model couldn't explain this one."));
      else {
        const list = el(doc, "ul");
        for (const r of explanation.reasons) list.append(el(doc, "li", undefined, r));
        ai.append(list);
      }
      parts.push(ai);
    }
    const how = el(doc, "div", "how");
    how.append(el(doc, "p", undefined, view.detail));
    if (pending) how.append(el(doc, "p", undefined, "Checking with the AI model…"));
    else if (note) how.append(el(doc, "p", undefined, note));
    parts.push(how);

    const openReport = () => {
      void actions.onFullReport().then((opened) => {
        hintText = opened ? "" : "Click the Hybrid Phish Guard icon in the toolbar to see the full report.";
        render();
      });
    };
    if (where && !pending) {
      const row = el(doc, "p", "where");
      row.append(icon(doc, where.leftDevice ? "cloud" : "device"), el(doc, "span", undefined, where.text));
      if (where.leftDevice) {
        const what = keyed(el(doc, "button", undefined, "See what was sent"), "sent");
        what.addEventListener("click", openReport);
        row.append(what);
      }
      parts.push(row);
    }

    const buttons = el(doc, "div", "actions");
    const report = keyed(el(doc, "button", undefined, "Full report"), "report");
    report.addEventListener("click", openReport);
    if (tone === "danger") {
      const leave = keyed(el(doc, "button", "primary", "Leave this page"), "leave");
      leave.addEventListener("click", () => actions.onLeave());
      buttons.append(leave, report);
    } else {
      report.classList.add("primary");
      buttons.append(report);
      if (trustable && !pending) {
        const trustBtn = keyed(el(doc, "button", undefined, trust.state === "saving" ? "Trusting…" : "Trust this site"), "trust");
        // aria-disabled rather than disabled: a disabled button can't hold focus.
        if (trust.state === "saving") trustBtn.setAttribute("aria-disabled", "true");
        trustBtn.addEventListener("click", () => {
          if (trust.state === "saving") return;
          trust = { state: "saving" };
          render();
          void actions.onTrust().then((host) => {
            trust = host ? { state: "done", host } : { state: "idle" };
            if (!host) hintText = "Couldn't trust this site. Try again from the side panel.";
            render();
          });
        });
        buttons.append(trustBtn);
      }
    }
    parts.push(buttons);
    if (hintText) parts.push(el(doc, "p", "hint", hintText));
    parts.push(el(doc, "p", "brand", "Hybrid Phish Guard"));
    body.replaceChildren(...parts);

    if (tone === "danger" && !announced) {
      announced = true;
      // Filled after insertion so the live region announces it.
      setTimeout(() => (live.textContent = `Hybrid Phish Guard: ${view.headline}.`), 100);
    }
  }

  function explain() {
    if (!content.explainable || explanation.state !== "idle") return;
    explanation = { state: "loading" };
    render();
    void actions.onExplain().then((reasons) => {
      explanation = reasons?.length ? { state: "done", reasons } : { state: "failed" };
      render();
    });
  }

  const setOpen = (open: boolean, focus: boolean) => {
    wrap.dataset.open = String(open);
    iconBtn.setAttribute("aria-expanded", String(open));
    if (open) explain();
    if (!focus) return;
    const target = open ? (body.querySelector(".actions button") as HTMLButtonElement) : iconBtn;
    target.focus({ preventScroll: true });
  };
  const remove = () => host.remove();
  let closedByUser = false;

  iconBtn.addEventListener("click", () => setOpen(true, true));
  minimize.addEventListener("click", () => setOpen(false, true));
  close.addEventListener("click", () => {
    closedByUser = true;
    remove();
  });
  card.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setOpen(false, true);
  });

  render();
  doc.documentElement.append(host);
  setOpen(false, false);

  return {
    update(next) {
      // A different verdict (or source) needs its own explanation.
      if (next.view.detail !== content.view.detail || next.view.headline !== content.view.headline) explanation = { state: "idle" };
      content = next;
      render();
      if (wrap.dataset.open === "true") explain();
    },
    remove,
    get connected() {
      return host.isConnected;
    },
    get closedByUser() {
      return closedByUser;
    },
  };
}
