import type { Locator, Page } from "playwright-core";
import { settle } from "../browser/settle.ts";
import { withScheme } from "../browser/url.ts";
import type { Condition, ParsedStep, Step, Target } from "./parse.ts";
import { riskyWord } from "./safety.ts";
import { resolveTarget, type Purpose } from "./target.ts";
import { newTag, type Arm } from "../browser/dialogs.ts";

const FIND_MS = 5000; // the element may still be rendering
const ACTION_MS = 3000; // found and visible: only animations, cover or disabled state remain
const TYPE_DELAY_MS = 15;
const EXPECT_MS = 5000;
const WAIT_FOR_MS = 10000;
// An optional step waits at most this long for its element or text: it is there now or
// soon, or it is skipped (a missing cookie banner must not cost 5 s).
const OPTIONAL_MS = 2000;
// A gated click after its check: the control was ready just before, so it may wait only briefly.
const GATED_READY_MS = 1000;

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
  // The action started before the step failed (a click went out, then its navigation
  // stalled): it may have run. Kept in the done log, never skipped, and the agent is told.
  mayHaveRun?: boolean;
}

// A step that did not run: an "optional" step whose element or text was not there, or an
// "if" step whose condition did not hold. The done check's log leaves these out.
export interface Skip {
  index: number; // 0-based
  source: string;
  reason: string;
}

export interface RunResult {
  ok: boolean;
  done: number; // steps passed, skipped ones included
  total: number;
  ms: number;
  failure?: StepFailure;
  skipped?: Skip[];
}

// Steps that only read the page.
const READ_ONLY = new Set<Step["op"]>(["wait", "wait for text", "wait for gone", "expect text", "expect no text", "expect url", "expect value", "task", "allow"]);
// An early commit check may run while these do. Not "expect value": it may learn a
// secret value (onSecret) that the check request must hide.
const EARLY_SAFE = new Set<Step["op"]>([...READ_ONLY].filter((op) => op !== "expect value"));

// Failures an "optional" step may skip: fastb's own finding that the thing is not there,
// made before anything was done. An action step is skipped only when its element was not
// found or was covered before the click; a Playwright timeout or a disabled element is not
// proof that nothing happened (a click may have run and then waited on a navigation).
// Never a safety or check stop, a choice between matches, or an unknown error.
const ACTION_SKIP = new Set<FailCode>(["not-found", "ref-gone", "covered"]);
const READ_SKIP = new Set<FailCode>(["not-found", "ref-gone", "text-missing", "text-present", "still-visible", "url-mismatch", "value-differs"]);
const canSkip = (e: Error, step: Step) => e instanceof StepError && (READ_ONLY.has(step.op) ? READ_SKIP : ACTION_SKIP).has(e.code);
// Playwright's call log shows that the action itself went out (then something after it failed).
const ACTED_LOG = /performing \w+ action|\w+ action done|scheduled navigations/;
const isTimeout = (e: unknown) => e instanceof Error && (e.name === "TimeoutError" || /Timeout \d+ms exceeded/.test(e.message));

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
  // Starts the commit check for a risky click now, while the read-only steps before it
  // run; the function it returns gives the answer at click time (same shape as `check`),
  // from the early verdict only if the page still reads the same.
  startCheck?: (page: Page, label: string) => () => Promise<{ reason: string; model: boolean } | null>;
  // Which native dialog the step running now may accept on this page (see dialogs.ts):
  // a confirm with the tag of an allowed risky click (past the gate and its check), or a
  // leave-page warning during a goto. Undefined: none.
  arm?: (page: Page, what?: Arm) => void;
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
  const check = allowStep?.unchecked ? undefined : hooks.check;
  const policy: Policy = {
    allow: Boolean(allowStep), allowed: hooks.allowed, check, flash: hooks.flash, refLine: hooks.refLine,
    startCheck: check ? hooks.startCheck : undefined, arm: hooks.arm, index: 0,
  };
  const skipped: Skip[] = [];
  const withSkips = (r: RunResult): RunResult => (skipped.length ? { ...r, skipped } : r);
  for (let i = 0; i < steps.length; i++) {
    hooks.onStep?.(i, steps[i].source);
    policy.index = i;
    policy.maxWait = steps[i].optional ? OPTIONAL_MS : undefined;
    policy.acted = false;
    policy.onLabel = hooks.onClickLabel ? (label) => hooks.onClickLabel!(i, label) : undefined;
    policy.onSecret = hooks.onSecret ? (value) => hooks.onSecret!(value, i) : undefined;
    try {
      const page = await currentPage();
      if (steps[i].when && !(await holds(page, steps[i].when!))) {
        skipped.push({ index: i, source: steps[i].source, reason: "condition not met" });
        continue;
      }
      startEarlyCheck(page, steps, i, policy);
      await runStep(page, steps[i].step, policy);
    } catch (err) {
      const e = err as Error;
      const code = failCode(e, steps[i].step);
      const mayHaveRun = policy.acted || (!(e instanceof StepError) && ACTED_LOG.test(e.message));
      if (steps[i].optional && !mayHaveRun && canSkip(e, steps[i].step)) {
        skipped.push({ index: i, source: steps[i].source, reason: shortReason(e) });
        continue;
      }
      return withSkips({
        ok: false,
        done: i,
        total: steps.length,
        ms: Date.now() - started,
        failure: {
          index: i,
          source: steps[i].source,
          reason: shortReason(e) + (mayHaveRun ? " (the action may have run: look before you repeat it)" : ""),
          code,
          ...(mayHaveRun ? { mayHaveRun } : {}),
          checkReason: e instanceof StepError ? e.checkReason : undefined,
          choices: e instanceof StepError ? e.choices : undefined,
        },
      });
    }
  }
  return withSkips({ ok: true, done: steps.length, total: steps.length, ms: Date.now() - started });
}

// An "if" condition, read once on the page as it is now (no waiting).
async function holds(page: Page, c: Condition): Promise<boolean> {
  if (c.kind === "url") return page.url().includes(c.text);
  const n = await visibleText(page, c.text).count();
  return c.kind === "text" ? n > 0 : n === 0;
}

// When steps i.. up to a plain click are all read-only, the click's commit check starts
// now and runs while they do. Only for a run that may click risky controls and has a
// check. Nothing here clicks: the gate still decides at click time (see gate).
function startEarlyCheck(page: Page, steps: ParsedStep[], i: number, policy: Policy): void {
  if (!policy.startCheck || policy.early || !(policy.allow || policy.allowed?.())) return;
  let j = i;
  while (j < steps.length && EARLY_SAFE.has(steps[j].step.op)) j++;
  const click = steps[j];
  if (j === i || !click || click.step.op !== "click" || click.optional || click.when) return;
  const target = click.step.target;
  const start = policy.startCheck;
  const ready = (async (): Promise<Early | undefined> => {
    const r = await resolveTarget(page, target, "click", 1000, policy.refLine ? (ref) => policy.refLine!(page, ref) : undefined);
    if (!r.ok) return undefined;
    const own = await r.locator.evaluate(controlLabel).catch(() => null);
    if (!Array.isArray(own)) return undefined;
    const label = controlName(target, own);
    if (!riskyWord(label)) return undefined;
    return { page, label, finish: start(page, label.slice(0, 60)) }; // the whole label is compared at click time
  })().catch(() => undefined);
  policy.early = { index: j, ready };
}

async function find(page: Page, step: Extract<Step, { target?: unknown }>, purpose: Purpose, policy?: Policy): Promise<Locator> {
  if (!("target" in step) || !step.target) throw new StepError("no target", "no-target");
  const r = await resolveTarget(page, step.target, purpose, waitMs(FIND_MS, policy), policy?.refLine ? (ref) => policy.refLine!(page, ref) : undefined);
  if (!r.ok) throw new StepError(r.reason, r.choices ? "many-matches" : /^ref @/.test(r.reason) ? "ref-gone" : "not-found", r.choices);
  if (policy?.flash) await r.locator.evaluate(flashBox).catch(() => {});
  return r.locator;
}

const waitMs = (ms: number, policy?: Policy) => Math.min(ms, policy?.maxWait ?? ms);

// After a step that may change the page, wait briefly for it to settle.
const afterAction = (page: Page) => settle(page, { quietMs: 200, maxMs: 3000 });

// A commit check started before its click: for the click at step `index`, on `page`, with `label`.
interface Early {
  page: Page;
  label: string; // whole, not cut: two long labels may share their first 60 characters
  finish: () => Promise<{ reason: string; model: boolean } | null>;
}

// What a gated click needs: an "allow" line, and then the commit check (unless "allow unchecked").
interface Policy {
  allow: boolean;
  allowed?: () => boolean;
  check?: RunHooks["check"];
  flash?: boolean;
  onSecret?: (value: string) => void;
  onLabel?: (label: string) => void;
  refLine?: RunHooks["refLine"];
  startCheck?: RunHooks["startCheck"];
  arm?: RunHooks["arm"];
  index: number; // the step running now
  maxWait?: number; // ms: the longest wait of this step (optional steps)
  acted?: boolean; // the step's action went out (or may have): a later failure is not "nothing happened"
  early?: { index: number; ready: Promise<Early | undefined> };
}

async function runStep(page: Page, step: Step, policy: Policy): Promise<void> {
  switch (step.op) {
    case "allow":
    case "task":
      return;
    case "goto":
      policy.arm?.(page, { kind: "leave" });
      try {
        await page.goto(withScheme(step.url), { waitUntil: "domcontentloaded", timeout: 30000 });
      } finally {
        policy.arm?.(page, undefined);
      }
      await settle(page);
      return;
    case "click": {
      const loc = await find(page, step, "click", policy);
      // A confirm() may be accepted only when the page calls it inside this click's own
      // event: the page marks such a confirm with a new tag (a confirm from a timer while
      // the click waits or the page loads has none). The engine takes the arm after one accept.
      const { gated, covered: coveredAtGate } = await gate(page, loc, step.target, policy);
      let covered = coveredAtGate;
      if (gated) {
        const tag = newTag();
        const marked = await loc.evaluate(markConfirms, tag).catch(() => false);
        if (marked === true) policy.arm?.(page, { kind: "confirm", tag });
      }
      try {
        if (!covered) await loc.click({ timeout: gated ? GATED_READY_MS : ACTION_MS, noWaitAfter: gated }).catch((err: Error) => (covered = isCovered(err)));
        if (covered && !(await clickUnder(loc, policy))) {
          throw new StepError(`another element covers it${await coverText(loc)} (close it, or use press @ref Enter)`, "covered");
        }
        policy.acted = true;
      } finally {
        if (gated) policy.arm?.(page, undefined);
      }
      await afterAction(page);
      return;
    }
    case "hover":
      await (await find(page, step, "click", policy)).hover({ timeout: ACTION_MS });
      policy.acted = true;
      await afterAction(page);
      return;
    case "check":
    case "uncheck": {
      const loc = await find(page, step, "check", policy);
      await (step.op === "check" ? loc.check({ timeout: ACTION_MS }) : loc.uncheck({ timeout: ACTION_MS }));
      policy.acted = true;
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
      if (kind === "select") await select(page, loc, step.value, policy);
      else if (kind === "readonly") {
        // A secret field's value is never printed.
        const now = (await secretField(loc, true)) ? "" : await loc.inputValue({ timeout: 1000 }).catch(() => "");
        throw new StepError(`it is read-only${now ? ` and holds "${now.slice(0, 60)}"` : ""}: click it to choose a value, or go on if the value is right`, "not-text-field");
      }
      else if (kind !== "text") throw new StepError(`it is a ${kind}, not a text field: click it, or use type`, "not-text-field");
      else {
        await noteSecret(loc, step.value, policy);
        await loc.fill(step.value, { timeout: ACTION_MS });
        policy.acted = true;
      }
      return;
    }
    case "type":
      // Typing takes 15 ms per key: the limit grows with the text.
      const typed = await find(page, step, "input", policy);
      await noteSecret(typed, step.value, policy);
      policy.acted = true; // a timeout may come after some keys went in
      await typed.pressSequentially(step.value, { delay: TYPE_DELAY_MS, timeout: ACTION_MS + step.value.length * TYPE_DELAY_MS * 2 });
      await afterAction(page);
      return;
    case "select":
      await select(page, await find(page, step, "select", policy), step.value, policy);
      await afterAction(page);
      return;
    case "press":
      if (step.target) await (await find(page, step, "input", policy)).press(step.key, { timeout: ACTION_MS });
      else await page.keyboard.press(step.key);
      policy.acted = true;
      await afterAction(page);
      return;
    case "wait":
      await page.waitForTimeout(step.ms);
      return;
    case "wait for text":
      await visibleText(page, step.text)
        .first()
        .waitFor({ state: "visible", timeout: waitMs(WAIT_FOR_MS, policy) })
        .catch((err) => {
          if (!isTimeout(err)) throw err; // a closed page is an error, not missing text
          throw new StepError(`text "${step.text}" did not show within ${Math.round(waitMs(WAIT_FOR_MS, policy) / 1000)}s`, "text-missing");
        });
      return;
    case "wait for gone":
      await until(async () => (await visibleText(page, step.text).count()) === 0, waitMs(WAIT_FOR_MS, policy), `"${step.text}" still visible`, "still-visible");
      return;
    case "expect text":
      await visibleText(page, step.text)
        .first()
        .waitFor({ state: "visible", timeout: waitMs(EXPECT_MS, policy) })
        .catch((err) => {
          if (!isTimeout(err)) throw err;
          throw new StepError(`text "${step.text}" not on the page`, "text-missing");
        });
      return;
    case "expect no text":
      await until(async () => (await visibleText(page, step.text).count()) === 0, 2000, `text "${step.text}" is on the page`, "text-present");
      return;
    case "expect url":
      await until(async () => page.url().includes(step.text), waitMs(EXPECT_MS, policy), `url is ${page.url()}`, "url-mismatch");
      return;
    case "expect value": {
      const loc = await find(page, step, "input", policy);
      // A password field's value is never printed, not even in a failed check.
      const secret = await loc.evaluate((el) => (el as HTMLInputElement).type === "password").catch(() => false);
      await noteSecret(loc, step.value, policy);
      let seen = "";
      await until(
        async () => (seen = await loc.inputValue({ timeout: 1000 }).catch(() => "")) === step.value,
        waitMs(EXPECT_MS, policy),
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

// The label the gate judges: the agent's target text and the control's own words.
function controlName(target: Target, own: unknown[]): string {
  const parts = [target.kind === "text" ? target.text : "", ...own].map((p) => String(p ?? "").replace(/\s+/g, " ").trim()).filter(Boolean);
  return [...new Set(parts)].join(" | ");
}

// Marks the confirm() calls that happen inside a click event on `el` (also a click
// dispatched by clickUnder): their text starts with `tag`. Each gated click sets its own
// element and tag. Plain JS text, like CONTROL_LABEL.
// The flag ends with the event's task (setTimeout 0), after its handlers and microtasks.
const MARK_CONFIRMS = `(el, tag) => {
  const w = el.ownerDocument.defaultView;
  if (!w) return false;
  const s = w.__fastbConfirm || (w.__fastbConfirm = { el: null, tag: "", inside: false });
  // Set again on each call: document.open() (and a page script) can drop the listener or
  // replace confirm while the window stays.
  if (s.listener) w.removeEventListener("click", s.listener, true);
  s.listener = (e) => {
    if (!s.el || !e.composedPath().includes(s.el)) return;
    s.inside = true;
    setTimeout(() => { s.inside = false; }, 0);
  };
  w.addEventListener("click", s.listener, true);
  if (w.confirm !== s.patched) {
    const original = w.confirm;
    s.patched = function (m) { return original.call(this, s.inside ? s.tag + String(m === undefined ? "" : m) : m); };
    w.confirm = s.patched;
  }
  s.el = el;
  s.tag = tag;
  return true;
}`;
const markConfirms = new Function("el", "tag", `return (${MARK_CONFIRMS})(el, tag);`) as (el: Element, tag: string) => boolean;

// Playwright's "another element would get the click" (true), or the error itself again.
function isCovered(err: Error): true {
  if (!/intercepts pointer events/.test(err.message)) throw err;
  return true;
}

// Stops a click on a delete / pay / send control unless the chunk says "allow".
// With "allow", it first waits until the control is ready for a click (a trial click:
// nothing is clicked), so the commit check (if any) reads the page the click will meet.
// gated: a risky click that may go on (a confirm() it opens may be accepted).
// covered: the trial found another element on top (the click goes to clickUnder).
async function gate(page: Page, loc: Locator, target: Target, policy: Policy): Promise<{ gated: boolean; covered: boolean }> {
  const no = { gated: false, covered: false };
  // An early check counts only for this step's click, on the same page and label.
  const early = policy.early?.index === policy.index ? policy.early.ready : undefined;
  policy.early = undefined;
  const own = await loc.evaluate(controlLabel).catch(() => null);
  // Fail closed: a control we cannot read may be the one the gate exists for.
  if (!Array.isArray(own)) {
    if (policy.allow || policy.allowed?.()) return no; // allowed: as before, an unreadable label does not stop the click
    throw new StepError("safety stop: could not read this control's label. Add the line allow to the chunk if the task needs it", "safety-stop");
  }
  const label = controlName(target, own);
  policy.onLabel?.(label.slice(0, 60));
  const word = riskyWord(label);
  if (!word) return no;
  if (!policy.allow && !policy.allowed?.()) throw new StepError(`safety stop: "${label.slice(0, 60)}" looks like a ${word} action. Add the line allow to the chunk if the task needs it`, "safety-stop");
  // Ready for a click (a trial: nothing is clicked) and still the same control: a label
  // that changed while it got ready may name another payee, and the check (and its early
  // verdict) is for the label read above. Covered: another element lies on top.
  const readySame = async (ms: number): Promise<boolean> => {
    const cover = await loc.click({ trial: true, timeout: ms }).then(() => false, isCovered);
    const now = await loc.evaluate(controlLabel).catch(() => null);
    if (!Array.isArray(now) || controlName(target, now) !== label) {
      throw new StepError(`the control changed while it got ready (it was "${label.slice(0, 60)}"); run the step again`, "check-blocked");
    }
    return cover;
  };
  let covered = await readySame(ACTION_MS);
  if (!policy.check) return { gated: true, covered };
  const pre = early && (await early);
  const stop = pre && pre.page === page && pre.label === label ? await pre.finish() : await policy.check(page, label.slice(0, 60));
  if (stop) {
    throw new StepError(
      `CHECK before "${label.slice(0, 40)}" (not clicked): ${stop.reason}. Fix it, or add "allow unchecked"`,
      stop.model ? "check-mismatch" : "check-blocked",
      undefined,
      stop.model ? stop.reason : undefined,
    );
  }
  // The check took time: the control must still be ready and the same (a re-render can
  // turn "Pay $5" into "Pay $50"). The page itself was compared by the check.
  covered = await readySame(GATED_READY_MS);
  return { gated: true, covered };
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
async function clickUnder(loc: Locator, policy: Policy): Promise<boolean> {
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
  policy.acted = true; // the event may go out even when the call fails
  try {
    await loc.dispatchEvent("click", undefined, { timeout: ACTION_MS });
    return true;
  } catch (err) {
    // The event may have gone out before the failure: never "covered" (an optional step
    // would be skipped as if nothing happened).
    throw new StepError(`the click on the covered element failed (${(err as Error).message.split("\n")[0]}); run look to see if it went through`, "error");
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
async function select(page: Page, loc: Locator, value: string, policy: Policy): Promise<void> {
  const isNative = await loc.evaluate((el) => el.tagName === "SELECT").catch(() => false);
  if (isNative) {
    await loc.selectOption({ label: value }, { timeout: ACTION_MS }).catch(() => loc.selectOption(value, { timeout: ACTION_MS }));
    policy.acted = true;
    return;
  }
  await loc.click({ timeout: ACTION_MS });
  policy.acted = true; // the dropdown is open now: a missing option is not "nothing happened"
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
