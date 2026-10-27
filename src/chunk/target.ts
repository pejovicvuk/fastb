import type { Locator, Page } from "playwright-core";
import type { Target } from "./parse.ts";

export type Purpose = "click" | "input" | "select" | "check";

export type Resolved = { ok: true; locator: Locator } | { ok: false; reason: string; choices?: string[] };

const CLICK_ROLES = [
  "button", "link", "menuitem", "menuitemcheckbox", "menuitemradio", "tab",
  "option", "treeitem", "checkbox", "radio", "switch", "combobox",
] as const;
const INPUT_ROLES = ["textbox", "searchbox", "combobox", "spinbutton"] as const;
const SELECT_ROLES = ["combobox", "listbox"] as const;
const CHECK_ROLES = ["checkbox", "radio", "switch"] as const;

type AriaRole = Parameters<Page["getByRole"]>[0];

// HTML fallbacks for when the role engine misses an element the snapshot shows
// (seen on REAL sites that strip aria labels).
const ROLE_CSS: Record<string, string> = {
  button: 'button, [role="button"], input[type="button"], input[type="submit"]',
  link: 'a[href], [role="link"]',
  textbox: 'input:not([type]), input[type="text"], input[type="email"], input[type="search"], input[type="tel"], input[type="url"], input[type="password"], input[type="number"], textarea, [role="textbox"], [contenteditable="true"]',
  checkbox: 'input[type="checkbox"], [role="checkbox"]',
  radio: 'input[type="radio"], [role="radio"]',
  combobox: 'select, [role="combobox"]',
  option: 'option, [role="option"]',
  tab: '[role="tab"]',
  menuitem: '[role="menuitem"]',
};

function anyRole(page: Page, roles: readonly string[], name: string, exact: boolean): Locator {
  return roles
    .map((r) => page.getByRole(r as AriaRole, { name, exact }))
    .reduce((a, b) => a.or(b));
}

// Candidate locators from most to least precise. The first tier with a visible match wins.
function tiers(page: Page, t: Extract<Target, { kind: "text" }>, purpose: Purpose): Locator[] {
  const name = t.text;
  if (t.role) {
    const role = t.role as AriaRole;
    // Later tiers: the element has the role but its text is not its accessible name.
    const css = ROLE_CSS[t.role];
    return [
      page.getByRole(role, { name, exact: true }),
      page.getByRole(role, { name }),
      page.getByRole(role).filter({ hasText: name }),
      ...(css ? [page.locator(css).filter({ hasText: new RegExp(`^\\s*${escapeRegExp(name)}\\s*$`) }), page.locator(css).filter({ hasText: name })] : []),
    ];
  }
  const byLabel = (exact: boolean) => page.getByLabel(name, { exact });
  const byPlaceholder = (exact: boolean) => page.getByPlaceholder(name, { exact });
  const byText = (exact: boolean) => page.getByText(name, { exact });
  switch (purpose) {
    case "input":
      return [true, false].flatMap((exact) => [byLabel(exact), byPlaceholder(exact), anyRole(page, INPUT_ROLES, name, exact)]);
    case "select":
      return [true, false].flatMap((exact) => [byLabel(exact), anyRole(page, SELECT_ROLES, name, exact)]);
    case "check":
      return [true, false].flatMap((exact) => [anyRole(page, CHECK_ROLES, name, exact), byLabel(exact)]);
    case "click":
      return [
        ...[true, false].flatMap((exact) => [anyRole(page, CLICK_ROLES, name, exact), byText(exact), page.getByTitle(name, { exact })]),
        page.locator(ROLE_CSS.button).filter({ hasText: name }),
      ];
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Resolves a target to exactly one visible element, retrying until `timeoutMs`
// because the element may still be rendering after the previous step.
export async function resolveTarget(page: Page, t: Target, purpose: Purpose, timeoutMs = 5000): Promise<Resolved> {
  if (t.kind === "ref") {
    const loc = page.getByRef(t.ref);
    try {
      await loc.waitFor({ state: "attached", timeout: timeoutMs });
      return { ok: true, locator: loc };
    } catch {
      return { ok: false, reason: `ref @${t.ref} not found (refs change after the page updates: run look again)` };
    }
  }
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    for (const tier of tiers(page, t, purpose)) {
      const visible = tier.filter({ visible: true });
      const n = await visible.count().catch(() => 0);
      if (n === 0) continue;
      if (t.nth) {
        if (n >= t.nth) return { ok: true, locator: visible.nth(t.nth - 1) };
        continue;
      }
      if (n === 1) return { ok: true, locator: visible };
      return { ok: false, reason: `${n} elements match`, choices: await describeChoices(visible, n) };
    }
    if (Date.now() >= deadline) return { ok: false, reason: `not found within ${Math.round(timeoutMs / 1000)}s` };
    await page.waitForTimeout(100);
  }
}

// One line per match with its role, name and nearby text, so the agent can pick
// one with #n. No refs here: an element-level AI snapshot numbers refs on its own
// and would make the page's refs point at the wrong elements.
async function describeChoices(loc: Locator, n: number): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < Math.min(n, 6); i++) {
    const info = await loc
      .nth(i)
      .evaluate((node) => {
        const el = node as HTMLElement;
        const own = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
        let p = el.parentElement;
        while (p && (p.textContent ?? "").trim().length < own.length + 15) p = p.parentElement;
        const around = ((p?.textContent ?? "").replace(/\s+/g, " ").trim()).slice(0, 90);
        const role = el.getAttribute("role") || el.tagName.toLowerCase();
        return { role, own: own.slice(0, 60), around };
      })
      .catch(() => ({ role: "?", own: "", around: "" }));
    out.push(`#${i + 1} ${info.role} "${info.own}"${info.around && info.around !== info.own ? ` | ${info.around}` : ""}`);
  }
  if (n > 6) out.push(`... ${n - 6} more`);
  return out;
}
