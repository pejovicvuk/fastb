import type { Page } from "playwright-core";
import { compact, parseSnapshot } from "./compact.ts";

export async function pageHeader(page: Page): Promise<string> {
  const title = await page.title().catch(() => "");
  return `page: ${title || "(no title)"} | ${page.url()}`;
}

// Rich-text editors (contenteditable) often have no role, so the aria snapshot
// shows them as empty boxes. Give them the standard textbox role (and their
// placeholder as a label) so they appear, with a ref, in the page snapshot.
// Plain JS text: a transpiled function may carry helpers the page does not have.
const MARK_EDITORS = `(() => {
  for (const el of document.querySelectorAll('[contenteditable=""], [contenteditable="true"]')) {
    if (el.getAttribute("tabindex") === "-1" || el.hasAttribute("role")) continue;
    el.setAttribute("role", "textbox");
    el.setAttribute("aria-multiline", "true");
    if (!el.hasAttribute("aria-label") && !el.hasAttribute("aria-labelledby")) {
      const ph = el.getAttribute("aria-placeholder") || el.getAttribute("data-placeholder") ||
        el.querySelector("[data-placeholder]")?.getAttribute("data-placeholder");
      if (ph) el.setAttribute("aria-label", ph);
    }
  }
})()`;

async function snapshot(page: Page): Promise<string> {
  await page.evaluate(MARK_EDITORS).catch(() => {});
  return page.ariaSnapshot({ mode: "ai", timeout: 10000 });
}

// The page as compact lines (no header): what the agent sees, and what diffs compare.
export async function pageLines(page: Page): Promise<string[]> {
  return compact(parseSnapshot(await snapshot(page)));
}

export async function look(page: Page, opts: { full?: boolean } = {}): Promise<string> {
  const body = opts.full ? await snapshot(page) : (await pageLines(page)).join("\n");
  return `${await pageHeader(page)}\n${body}`;
}
