import type { Locator, Page } from "playwright-core";
import type { Target } from "./parse.ts";
import { riskyWord } from "./safety.ts";

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
        // byLabel: icons named only by aria-label (no role, no text).
        ...[true, false].flatMap((exact) => [anyRole(page, CLICK_ROLES, name, exact), byText(exact), page.getByTitle(name, { exact }), byLabel(exact)]),
        page.locator(ROLE_CSS.button).filter({ hasText: name }),
      ];
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Resolves a target to exactly one visible element, retrying until `timeoutMs`
// because the element may still be rendering after the previous step.
// `refLine`: the page line the agent last saw for a ref, e.g. `@e165 textbox "Depart"`.
export async function resolveTarget(page: Page, t: Target, purpose: Purpose, timeoutMs = 5000, refLine?: (ref: string) => string | undefined): Promise<Resolved> {
  if (t.kind === "ref") {
    const loc = page.getByRef(t.ref);
    try {
      // A ref names an element from the latest snapshot: it is there or gone for good.
      await loc.waitFor({ state: "attached", timeout: Math.min(timeoutMs, 500) });
      return { ok: true, locator: loc };
    } catch {
      return refAgain(page, t.ref, refLine?.(t.ref));
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
      const one = await pickOne(visible, n, t.text, purpose);
      if (one >= 0) return { ok: true, locator: visible.nth(one) };
      return { ok: false, reason: `${n} elements match`, choices: await describeChoices(visible, n) };
    }
    if (Date.now() >= deadline) return { ok: false, reason: `not found within ${Math.round(timeoutMs / 1000)}s` };
    await page.waitForTimeout(100);
  }
}

// A page update (a React re-render) can replace an element with an equal one that has a
// new ref. The agent saw its role and name: when exactly one visible element has them
// now, that is the element.
async function refAgain(page: Page, ref: string, line: string | undefined): Promise<Resolved> {
  const gone: Resolved = { ok: false, reason: `ref @${ref} not found (refs change after the page updates: run look again)` };
  const m = line && /^@\w+ ([a-z]+) ("(?:[^"\\]|\\.)*")/.exec(line.trimStart());
  if (!m) return gone;
  let name: string;
  try {
    name = JSON.parse(m[2]) as string;
  } catch {
    return gone;
  }
  if (!name || name.endsWith("…")) return gone; // a cut name is not the whole name
  // A delete / send / pay control is never guessed: the one left may be another row's.
  if (riskyWord(name)) return gone;
  const again = page.getByRole(m[1] as AriaRole, { name, exact: true }).filter({ visible: true });
  const deadline = Date.now() + 1000;
  for (;;) {
    const n = await again.count().catch(() => 0);
    if (n === 1) return { ok: true, locator: again };
    if (n > 1 || Date.now() >= deadline) {
      const what = `${m[1]} "${name.slice(0, 60)}"`;
      return { ok: false, reason: `ref @${ref} not found: ${n ? `${n} elements are ${what} now` : `no ${what} is on the page now`} (refs change after the page updates: run look again)` };
    }
    await page.waitForTimeout(100);
  }
}

// Several matches where only one can be meant: the only real text field (a fill whose
// label also names its box), the only whole-word match ("Male", not "Female"), or the
// first of identical copies (a carousel shows each card again). -1: ask the agent.
async function pickOne(loc: Locator, n: number, name: string, purpose: Purpose): Promise<number> {
  if (n > 20) return -1;
  const items = await loc
    .evaluateAll((els) =>
      els.map((node) => {
        const el = node as HTMLElement;
        const own = (el.innerText || el.getAttribute("aria-label") || (el as HTMLInputElement).value || el.textContent || "").replace(/\s+/g, " ").trim();
        // Every name it may be known by: a whole-word match in any of them counts.
        const root = el.getRootNode() as Document | ShadowRoot;
        const labelled = (el.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean)
          .map((id) => root.getElementById?.(id))
          .map((n) => `${n?.getAttribute("aria-label") ?? ""} ${n?.textContent ?? ""}`.trim());
        const names = [own, el.getAttribute("aria-label"), el.getAttribute("title"), (el as HTMLInputElement).value, labelled.join(" ")].filter((x): x is string => Boolean(x));
        // Its card: the first box around it with some more words, but never one that
        // holds another match (then two rows of one list would look the same).
        let card = el;
        while (card.parentElement && (card.textContent ?? "").trim().length < own.length + 15 && !els.some((o) => o !== el && card.parentElement!.contains(o))) {
          card = card.parentElement;
        }
        const field = (el.matches("input, textarea, select") && !(el as HTMLInputElement).readOnly) || el.isContentEditable;
        const control = el.matches('button, a, input, select, textarea, summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="option"], [role="checkbox"], [role="radio"], [role="switch"]');
        return { field, own, names, control, href: el.closest("a[href]")?.getAttribute("href") ?? "", card: (card.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 300), role: el.getAttribute("role") || el.tagName };
      }),
    )
    .catch(() => null);
  if (!items) return -1;
  type Item = (typeof items)[number];
  const only = (ok: (i: Item) => boolean) => {
    const hits = items.flatMap((i, k) => (ok(i) ? [k] : []));
    return hits.length === 1 ? hits[0] : -1;
  };
  if (purpose === "input" || purpose === "select") {
    const k = only((i) => i.field);
    if (k >= 0) return k;
  }
  const word = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(name)}($|[^\\p{L}\\p{N}])`, "iu");
  const k = only((i) => i.names.some((x) => word.test(x)));
  if (k >= 0) return k;
  const same = (a: Item) => a.role === items[0].role && a.own === items[0].own && a.card === items[0].card;
  // Copies of one item: the matches are the item's name (a heading or text, not a
  // button: "Open" in two rows is two records), or all open the same link.
  const first = items[0];
  const copies = first.own && items.every(same) &&
    ((/^(\/|https?:)/.test(first.href) && items.every((i) => i.href === first.href)) || items.every((i) => !i.control && i.own.toLowerCase() === name.toLowerCase()));
  return copies ? 0 : -1;
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
