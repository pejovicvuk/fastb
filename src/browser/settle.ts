import type { Page } from "playwright-core";

export interface SettleOptions {
  quietMs?: number;
  maxMs?: number;
}

// Runs inside the page. Kept as plain JS text: a transpiled function can carry
// helper calls (for example esbuild's __name) that do not exist in the page.
const QUIET_WINDOW = `({ quietMs, maxMs }) => new Promise((resolve) => {
  const loading = () =>
    // Only a spinner-type progressbar (no value) means loading; a bar with a value
    // may be a static chart (Staynb rating bars).
    Array.from(document.querySelectorAll('[role="progressbar"]:not([aria-valuenow]), [aria-busy="true"]')).some((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  let last = performance.now();
  const obs = new MutationObserver(() => (last = performance.now()));
  obs.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  const end = performance.now() + maxMs;
  const tick = () => {
    const now = performance.now();
    if ((now - last >= quietMs && !loading()) || now >= end) {
      obs.disconnect();
      resolve();
    } else setTimeout(tick, 50);
  };
  tick();
})`;

// Waits until the page stops changing: no DOM mutations for `quietMs` and no
// visible loading indicator. Never waits for "network idle" or "document idle",
// which single-page apps may never reach. Returns how long it waited.
export async function settle(page: Page, opts: SettleOptions = {}): Promise<number> {
  const quietMs = opts.quietMs ?? 300;
  const maxMs = opts.maxMs ?? 8000;
  const started = Date.now();
  await page.waitForLoadState("domcontentloaded", { timeout: maxMs }).catch(() => {});
  // A navigation during the wait destroys the page context: start over until time runs out.
  for (;;) {
    const left = maxMs - (Date.now() - started);
    if (left <= 0) break;
    try {
      await page.evaluate(`(${QUIET_WINDOW})(${JSON.stringify({ quietMs, maxMs: left })})`);
      break;
    } catch (err) {
      if (page.isClosed()) break;
      if (!/context was destroyed|navigation/i.test(String(err))) {
        console.error(`settle: ${String(err).split("\n")[0]}`);
        break;
      }
      await page.waitForLoadState("domcontentloaded", { timeout: Math.max(1, left) }).catch(() => {});
    }
  }
  return Date.now() - started;
}
