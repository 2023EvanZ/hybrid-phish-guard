import "./page.ts";

// The Firebase spike lives behind a dynamic import so a missing or broken Firebase config
// can't take down the page report above it.
const diag = document.getElementById("diagnostics") as HTMLDetailsElement;
diag.addEventListener(
  "toggle",
  () => {
    import("./diagnostics.ts").catch((err) => {
      document.getElementById("log")!.textContent = `Diagnostics failed to load: ${String(err)}`;
    });
  },
  { once: true },
);
