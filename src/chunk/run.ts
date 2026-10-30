import type { Locator, Page } from "playwright-core";
import { settle } from "../browser/settle.ts";
import { withScheme } from "../browser/url.ts";
import type { ParsedStep, Step, Target } from "./parse.ts";
import { riskyWord } from "./safety.ts";
import { resolveTarget, type Purpose } from "./target.ts";

const FIND_MS = 5000; // the element may still be rendering
const ACTION_MS = 3000; // found and visible: only animations, cover or disabled state remain
const TYPE_DELAY_MS = 15;
const EXPECT_MS = 5000;
const WAIT_FOR_MS = 10000;

// Why a step failed, as a fixed code. Remote reports (lane report) send only this, never
// the reason text, which may hold page text or values. `checkReason` is the commit
// check's own mismatch, made from already-redacted evidence.
export type FailCode =
  | "not-found" | "ref-gone" | "many-matches" | "no-target" | "covered" | "disabled" | "not-visible" | "timeout"
  | "not-text-field" | "option-missing" | "text-missing" | "text-present" | "still-visible" | "url-mismatch"
  | "value-differs" | "safety-stop" | "check-mismatch" | "check-blocked" | "error";

export interface StepFailure {
  index: number; // 0-based
  source: string;
  reason: string; // full text, for the agent on this machine only
  code: FailCode;
  checkReason?: string;
  choices?: string[];
}

export interface RunResult {
  ok: boolean;
  done: number;
  total: number;
  ms: number;
  failure?: StepFailure;
}

class StepError extends Error {
  constructor(
    message: string,
    readonly code: FailCode = "error",
    readonly choices?: string[],
    readonly checkReason?: string,
  ) {
    super(message);
  }
}

export interface RunHooks {
  onStep?: (index: number, source: string) => void; // called before each step (the live grid shows it)
  // Commit check before an allowed send / pay / book click: a mismatch reason, or null to go on.
  // `model: true` only for a mismatch found by the Meta model (made from redacted evidence);
  // page changes and failed reads are `model: false` and never leave as free text.
  check?: (page: Page, label: string) => Promise<{ reason: string; model: boolean } | null>;
  // A value typed into a secret field (password, card, CVV...): kept locally, so it is
  // hidden from every later request even when the field is gone. `index`: the step.
  onSecret?: (value: string, index: number) => void;
  flash?: boolean; // show a short box on each element fastb acts on (only while the live grid is watched)
  // The words of the control a click step is about to click (step index, label): the done
  // check's log names what was clicked, also when the step used a ref.
  onClickLabel?: (index: number, label: string) => void;
  // An earlier run of this task had the line "allow": it lasts until the task changes.
  // Asked at each risky click, so a task that ended during the run takes it away.
  allowed?: () => boolean;
  // The page line the agent last saw for a ref: finds the element again after a re-render.
  refLine?: (page: Page, ref: string) => string | undefined;
}

// A box over the element for 0.6 s, in its own layer (id __fastb_flash, ignored by settle).
const FLASH = `(el) => {
  const r = el.getBoundingClientRect();
  const d = el.ownerDocument;
  let box = d.getElementById("__fastb_flash");
  if (!box) { box = d.createElement("div"); box.id = "__fastb_flash"; d.documentElement.appendChild(box); }
  box.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;border:3px solid #ff7a00;border-radius:4px;" +
    "box-shadow:0 0 12px #ff7a00;left:" + (r.left - 4) + "px;top:" + (r.top - 4) + "px;width:" + (r.width + 2) + "px;height:" + (r.height + 2) + "px";
  clearTimeout(box.__t);
  box.__t = setTimeout(() => box.remove(), 600);
}`;
const flashBox = new Function("el", `return (${FLASH})(el);`) as (el: Element) => void;

// `currentPage` is asked before every step: a click may open a new tab.
export async function runChunk(currentPage: () => Promise<Page>, steps: ParsedStep[], hooks: RunHooks = {}): Promise<RunResult> {
  const started = Date.now();
  const allowStep = steps.find((s) => s.step.op === "allow")?.step as { unchecked?: boolean } | undefined;
  const policy: Policy = { allow: Boolean(allowStep), allowed: hooks.allowed, check: allowStep?.unchecked ? undefined : hooks.check, flash: hooks.flash, refLine: hooks.refLine };
  for (let i = 0; i < steps.length; i++) {
    hooks.onStep?.(i, steps[i].source);
    policy.onLabel = hooks.onClickLabel ? (label) => hooks.onClickLabel!(i, label) : undefined;
    policy.onSecret = hooks.onSecret ? (value) => hooks.onSecret!(value, i) : undefined;
    try {
      await runStep(await currentPage(), steps[i].step, policy);
    } catch (err) {
      const e = err as Error;
      return {
        ok: false,
        done: i,
        total: steps.length,
        ms: Date.now() - started,
        failure: {
          index: i,
          source: steps[i].source,
          reason: shortReason(e),
          code: failCode(e, steps[i].step),
          checkReason: e instanceof StepError ? e.checkReason : undefined,
          choices: e instanceof StepError ? e.choices : undefined,
        },
      };
    }
  }
  return { ok: true, done: steps.length, total: steps.length, ms: Date.now() - started };
}

async function find(page: Page, step: Extract<Step, { target?: unknown }>, purpose: Purpose, policy?: Policy): Promise<Locator> {
  if (!("target" in step) || !step.target) throw new StepError("no target", "no-target");
  const r = await resolveTarget(page, step.target, purpose, FIND_MS, policy?.refLine ? (ref) => policy.refLine!(page, ref) : undefined);
  if (!r.ok) throw new StepError(r.reason, r.choices ? "many-matches" : /^ref @/.test(r.reason) ? "ref-gone" : "not-found", r.choices);
  if (policy?.flash) await r.locator.evaluate(flashBox).catch(() => {});
  return r.locator;
}

// After a step that may change the page, wait briefly for it to settle.
const afterAction = (page: Page) => settle(page, { quietMs: 200, maxMs: 3000 });

// What a gated click needs: an "allow" line, and then the commit check (unless "allow unchecked").
interface Policy {
  allow: boolean;
  allowed?: () => boolean;
  check?: RunHooks["check"];
  flash?: boolean;
  onSecret?: (value: string) => void;
  onLabel?: (label: string) => void;
  refLine?: RunHooks["refLine"];
}

async function runStep(page: Page, step: Step, policy: Policy): Promise<void> {
  switch (step.op) {
    case "allow":
    case "task":
      return;
    case "goto":
      await page.goto(withScheme(step.url), { waitUntil: "domcontentloaded", timeout: 30000 });
      await settle(page);
      return;
    case "click": {
      const loc = await find(page, step, "click", policy);
      await gate(page, loc, step.target, policy);
      await loc.click({ timeout: ACTION_MS }).catch(async (err: Error) => {
        if (!/intercepts pointer events/.test(err.message)) throw err;
        if (await clickUnder(loc)) return;
        throw new StepError(`another element covers it${await coverText(loc)} (close it, or use press @ref Enter)`, "covered");
      });
      await afterAction(page);
      return;
    }
    case "hover":
      await (await find(page, step, "click", policy)).hover({ timeout: ACTION_MS });
      await afterAction(page);
      return;
    case "check":
    case "uncheck": {
      const loc = await find(page, step, "check", policy);
      await (step.op === "check" ? loc.check({ timeout: ACTION_MS }) : loc.uncheck({ timeout: ACTION_MS }));
      await afterAction(page);
      return;
    }
    case "fill": {
      const loc = await find(page, step, "input", policy);
      // Only real text fields can be filled; a <select> is chosen instead.
      const kind = await loc
        .evaluate((el) =>
          el.tagName === "SELECT" ? "select"
          : el.matches("input, textarea") ? ((el as HTMLInputElement).readOnly ? "readonly" : "text")
          : (el as HTMLElement).isContentEditable ? "text" : el.tagName.toLowerCase(),
        )
        .catch(() => "text");
      if (kind === "select") await select(page, loc, step.value);
      else if (kind === "readonly") {
        // A secret field's value is never printed.
        const now = (await secretField(loc, true)) ? "" : await loc.inputValue({ timeout: 1000 }).catch(() => "");
        throw new StepError(`it is read-only${now ? ` and holds "${now.slice(0, 60)}"` : ""}: click it to choose a value, or go on if the value is right`, "not-text-field");
      }
      else if (kind !== "text") throw new StepError(`it is a ${kind}, not a text field: click it, or use type`, "not-text-field");
      else {
        await noteSecret(loc, step.value, policy);
        await loc.fill(step.value, { timeout: ACTION_MS });
      }
      return;
    }
    case "type":
      // Typing takes 15 ms per key: the limit grows with the text.
      const typed = await find(page, step, "input", policy);
      await noteSecret(typed, step.value, policy);
      await typed.pressSequentially(step.value, { delay: TYPE_DELAY_MS, timeout: ACTION_MS + step.value.length * TYPE_DELAY_MS * 2 });
      await afterAction(page);
      return;
    case "select":
      await select(page, await find(page, step, "select", policy), step.value);
      await afterAction(page);
      return;
    case "press":
      if (step.target) await (await find(page, step, "input", policy)).press(step.key, { timeout: ACTION_MS });
      else await page.keyboard.press(step.key);
      await afterAction(page);
      return;
    case "wait":
      await page.waitForTimeout(step.ms);
      return;
    case "wait for text":
      await visibleText(page, step.text).first().waitFor({ state: "visible", timeout: WAIT_FOR_MS });
      return;
    case "wait for gone":
      await until(async () => (await visibleText(page, step.text).count()) === 0, WAIT_FOR_MS, `"${step.text}" still visible`, "still-visible");
      return;
    case "expect text":
      await visibleText(page, step.text)
        .first()
        .waitFor({ state: "visible", timeout: EXPECT_MS })
        .catch(() => {
          throw new StepError(`text "${step.text}" not on the page`, "text-missing");
        });
      return;
    case "expect no text":
      await until(async () => (await visibleText(page, step.text).count()) === 0, 2000, `text "${step.text}" is on the page`, "text-present");
      return;
    case "expect url":
      await until(async () => page.url().includes(step.text), EXPECT_MS, `url is ${page.url()}`, "url-mismatch");
      return;
    case "expect value": {
      const loc = await find(page, step, "input", policy);
      // A password field's value is never printed, not even in a failed check.
      const secret = await loc.evaluate((el) => (el as HTMLInputElement).type === "password").catch(() => false);
      await noteSecret(loc, step.value, policy);
      let seen = "";
      await until(
        async () => (seen = await loc.inputValue({ timeout: 1000 }).catch(() => "")) === step.value,
        EXPECT_MS,
        () => (secret ? "the password field holds a different value" : `value is "${seen}"`),
        "value-differs",
      );
      return;
    }
  }
}

// The words a control is known by, read in the page. Plain JS text: a transpiled
// function may carry helpers (__name) that the page does not have.
const CONTROL_LABEL = `(el) => {
  const icons = (e) => Array.from(e.querySelectorAll("img[alt], svg title, [aria-label]")).slice(0, 5)
    .map((c) => c.getAttribute("aria-label") || c.getAttribute("alt") || c.textContent || "").join(" ");
  // An element that names another (aria-labelledby, looked up in the control's own
  // document or shadow root): all its words, so none can hide behind another.
  const nameOf = (e) => !e ? "" :
    [e.getAttribute("aria-label"), e.getAttribute("alt"), e.getAttribute("title"), e.textContent, icons(e)].filter(Boolean).join(" ");
  const labelledBy = (el.getAttribute("aria-labelledby") || "").split(/\\s+/).filter(Boolean)
    .map((id) => nameOf((el.getRootNode().getElementById ? el.getRootNode() : el.ownerDocument).getElementById(id))).join(" ");
  const text = (el.innerText || "").replace(/\\s+/g, " ").trim();
  // Long text is a card or a row, not a button: its text and inner icons are not the label.
  const small = text.length <= 40;
  // A value names only a button-like input; a text or password field's value is what someone typed.
  const value = el.tagName === "INPUT" && /^(button|submit|reset)$/i.test(el.type) ? el.value : "";
  return [el.getAttribute("aria-label"), el.getAttribute("alt"), labelledBy, el.getAttribute("title"), value, small ? icons(el) : "", small ? text : ""];
}`;
// Locator.evaluate does not call a function given as a string; a Function built
// from the text is sent as that text.
const controlLabel = new Function("el", `return (${CONTROL_LABEL})(el);`) as (el: Element) => unknown;

// Stops a click on a delete / pay / send control unless the chunk says "allow".
// With "allow", the commit check (if any) compares the page with the task first.
async function gate(page: Page, loc: Locator, target: Target, policy: Policy): Promise<void> {
  const own = await loc.evaluate(controlLabel).catch(() => null);
  // Fail closed: a control we cannot read may be the one the gate exists for.
  if (!Array.isArray(own)) {
    if (policy.allow || policy.allowed?.()) return; // allowed: as before, an unreadable label does not stop the click
    throw new StepError("safety stop: could not read this control's label. Add the line allow to the chunk if the task needs it", "safety-stop");
  }
  const parts = [target.kind === "text" ? target.text : "", ...own].map((p) => String(p ?? "").replace(/\s+/g, " ").trim()).filter(Boolean);
  const label = [...new Set(parts)].join(" | ");
  policy.onLabel?.(label.slice(0, 60));
  const word = riskyWord(label);
  if (!word) return;
  if (!policy.allow && !policy.allowed?.()) throw new StepError(`safety stop: "${label.slice(0, 60)}" looks like a ${word} action. Add the line allow to the chunk if the task needs it`, "safety-stop");
  if (!policy.check) return;
  const stop = await policy.check(page, label.slice(0, 60));
  if (stop) {
    throw new StepError(
      `CHECK before "${label.slice(0, 40)}" (not clicked): ${stop.reason}. Fix it, or add "allow unchecked"`,
      stop.model ? "check-mismatch" : "check-blocked",
      undefined,
      stop.model ? stop.reason : undefined,
    );
  }
}

// Words that mark a field whose value must never leave the machine (same list as the check).
const SECRET_FIELD = /card|cvv|cvc|cvn|security code|expir|iban|account|routing|ssn|social security|passport|tax id|pin\b|password|passcode|token|secret/i;

async function noteSecret(loc: Locator, value: string, policy: Policy): Promise<void> {
  if (!policy.onSecret || !value) return;
  if (await secretField(loc)) policy.onSecret(value);
}

// `failSecret`: a field that cannot be read counts as secret (before printing its value).
async function secretField(loc: Locator, failSecret = false): Promise<boolean> {
  const secret = await loc
    .evaluate((node) => {
      const el = node as HTMLInputElement;
      if (el.type === "password") return "password";
      const labels = Array.from(el.labels ?? []).map((l) => l.textContent || "");
      const root = el.getRootNode() as Document | ShadowRoot;
      const named = (el.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean).map((id) => {
        const n = root.getElementById?.(id);
        return `${n?.getAttribute("aria-label") ?? ""} ${n?.textContent ?? ""}`;
      });
      return [el.getAttribute("aria-label"), el.getAttribute("name"), el.id, el.getAttribute("placeholder"), el.getAttribute("autocomplete"), el.title, ...labels, ...named].filter(Boolean).join(" ");
    })
    .catch(() => (failSecret ? "password" : ""));
  return secret === "password" || SECRET_FIELD.test(secret);
}

// A covered control gets the click event on itself (a banner or an open panel lies on
// top). No key press: the focus could move to another control, past the safety gate.
// Never while a dialog is open (the agent must answer it first; shadow roots included),
// never on a disabled or inert element. False: the click did not go through.
async function clickUnder(loc: Locator): Promise<boolean> {
  const go = await loc
    .evaluate((node) => {
      // No named helpers in here: a transpiled one carries a helper the page does not have.
      const el = node as HTMLElement;
      if (el.matches(":disabled")) return false;
      for (let up: Node | null = el; up; up = up.parentNode ?? (up as ShadowRoot).host ?? null) {
        if (up instanceof Element && up.hasAttribute("inert")) return false; // also above a shadow host
      }
      const roots: (Document | ShadowRoot)[] = [el.ownerDocument];
      for (let i = 0; i < roots.length; i++) {
        for (const m of Array.from(roots[i].querySelectorAll('dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]'))) {
          // Shown: it has a box, or its children do (a wrapper with display: contents).
          const boxed = m.getClientRects().length > 0 || Array.from(m.querySelectorAll("*")).some((c) => c.getClientRects().length > 0);
          if (!boxed || getComputedStyle(m).visibility === "hidden") continue;
          let up: Node | null = el; // does the dialog hold the element (across shadow roots)?
          while (up && up !== m) up = up.parentNode ?? (up as ShadowRoot).host ?? null;
          if (!up) return false;
        }
        for (const e of Array.from(roots[i].querySelectorAll("*"))) if (e.shadowRoot) roots.push(e.shadowRoot);
      }
      return true;
    })
    .catch(() => false);
  if (!go) return false;
  try {
    await loc.dispatchEvent("click", undefined, { timeout: ACTION_MS });
    return true;
  } catch {
    return false;
  }
}

// What lies on top of the element's center, as text the agent can match to the page.
async function coverText(loc: Locator): Promise<string> {
  const text = await loc
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = el.ownerDocument.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) as HTMLElement | null;
      if (!top || el.contains(top)) return "";
      let box: HTMLElement | null = top;
      // Climb to a box with some text: the panel or dialog, not an empty layer.
      while (box && !(box.innerText || "").trim() && box.parentElement) box = box.parentElement;
      const role = box?.getAttribute("role");
      return `${role ? role + " " : ""}"${(box?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 80)}"`;
    })
    .catch(() => "");
  return text && text !== '""' ? `: ${text}` : "";
}

// Native <select> first; otherwise a custom dropdown: open it and click the option.
async function select(page: Page, loc: Locator, value: string): Promise<void> {
  const isNative = await loc.evaluate((el) => el.tagName === "SELECT").catch(() => false);
  if (isNative) {
    await loc.selectOption({ label: value }, { timeout: ACTION_MS }).catch(() => loc.selectOption(value, { timeout: ACTION_MS }));
    return;
  }
  await loc.click({ timeout: ACTION_MS });
  const option = await resolveTarget(page, { kind: "text", role: "option", text: value }, "click", 2000);
  const fallback = option.ok ? option : await resolveTarget(page, { kind: "text", text: value }, "click", 2000);
  if (!fallback.ok) throw new StepError(`option "${value}": ${fallback.reason}`, fallback.choices ? "many-matches" : "option-missing", fallback.choices);
  await fallback.locator.click({ timeout: ACTION_MS });
}

function visibleText(page: Page, text: string): Locator {
  return page.getByText(text).filter({ visible: true });
}

async function until(check: () => Promise<boolean>, ms: number, why: string | (() => string), code: FailCode): Promise<void> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await check()) return;
    if (Date.now() >= deadline) throw new StepError(typeof why === "string" ? why : why(), code);
    await new Promise((r) => setTimeout(r, 100));
  }
}

function failCode(e: Error, step: Step): FailCode {
  if (e instanceof StepError) return e.code;
  if (step.op === "wait for text") return "text-missing";
  if (/intercepts pointer events/.test(e.message)) return "covered";
  if (/not enabled|disabled/.test(e.message)) return "disabled";
  if (/not visible/.test(e.message)) return "not-visible";
  return /Timeout \d+ms exceeded/.test(e.message) ? "timeout" : "error";
}

// Playwright errors carry long call logs; the agent needs one line.
function shortReason(e: Error): string {
  if (e instanceof StepError) return e.message;
  const first = e.message.split("\n")[0].replace(/^[a-zA-Z]+\.[a-zA-Z]+: /, "");
  if (/Timeout \d+ms exceeded/.test(first)) {
    const log = e.message;
    if (/intercepts pointer events/.test(log)) {
      const cover = [...log.matchAll(/(<[^>]{1,200}>)[^\n]*? intercepts pointer events/g)].pop()?.[1];
      return `another element covers it${cover ? `: ${cover.slice(0, 120)}` : ""} (close it, or use press @ref Enter)`;
    }
    if (/not enabled|disabled/.test(log)) return "it is disabled";
    if (/not visible/.test(log)) return "it is not visible";
    return `timed out after ${ACTION_MS / 1000}s`;
  }
  return first;
}
