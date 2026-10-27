import type { Locator, Page } from "playwright-core";
import { settle } from "../browser/settle.ts";
import { withScheme } from "../browser/url.ts";
import type { ParsedStep, Step, Target } from "./parse.ts";
import { riskyWord } from "./safety.ts";
import { resolveTarget, type Purpose } from "./target.ts";

const ACTION_MS = 5000;
const EXPECT_MS = 5000;
const WAIT_FOR_MS = 10000;

export interface StepFailure {
  index: number; // 0-based
  source: string;
  reason: string;
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
    readonly choices?: string[],
  ) {
    super(message);
  }
}

// `currentPage` is asked before every step: a click may open a new tab.
export async function runChunk(currentPage: () => Promise<Page>, steps: ParsedStep[]): Promise<RunResult> {
  const started = Date.now();
  const allow = steps.some((s) => s.step.op === "allow");
  for (let i = 0; i < steps.length; i++) {
    try {
      await runStep(await currentPage(), steps[i].step, allow);
    } catch (err) {
      const e = err as Error;
      return {
        ok: false,
        done: i,
        total: steps.length,
        ms: Date.now() - started,
        failure: { index: i, source: steps[i].source, reason: shortReason(e), choices: (e as StepError).choices },
      };
    }
  }
  return { ok: true, done: steps.length, total: steps.length, ms: Date.now() - started };
}

async function find(page: Page, step: Extract<Step, { target?: unknown }>, purpose: Purpose): Promise<Locator> {
  if (!("target" in step) || !step.target) throw new StepError("no target");
  const r = await resolveTarget(page, step.target, purpose, ACTION_MS);
  if (!r.ok) throw new StepError(r.reason, r.choices);
  return r.locator;
}

// After a step that may change the page, wait briefly for it to settle.
const afterAction = (page: Page) => settle(page, { quietMs: 200, maxMs: 3000 });

async function runStep(page: Page, step: Step, allow: boolean): Promise<void> {
  switch (step.op) {
    case "allow":
      return;
    case "goto":
      await page.goto(withScheme(step.url), { waitUntil: "domcontentloaded", timeout: 30000 });
      await settle(page);
      return;
    case "click": {
      const loc = await find(page, step, "click");
      if (!allow) await gate(loc, step.target);
      await loc.click({ timeout: ACTION_MS });
      await afterAction(page);
      return;
    }
    case "hover":
      await (await find(page, step, "click")).hover({ timeout: ACTION_MS });
      await afterAction(page);
      return;
    case "check":
    case "uncheck": {
      const loc = await find(page, step, "check");
      await (step.op === "check" ? loc.check({ timeout: ACTION_MS }) : loc.uncheck({ timeout: ACTION_MS }));
      await afterAction(page);
      return;
    }
    case "fill":
      await (await find(page, step, "input")).fill(step.value, { timeout: ACTION_MS });
      return;
    case "type":
      await (await find(page, step, "input")).pressSequentially(step.value, { delay: 15, timeout: ACTION_MS });
      await afterAction(page);
      return;
    case "select":
      await select(page, await find(page, step, "select"), step.value);
      await afterAction(page);
      return;
    case "press":
      if (step.target) await (await find(page, step, "input")).press(step.key, { timeout: ACTION_MS });
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
      await until(async () => (await visibleText(page, step.text).count()) === 0, WAIT_FOR_MS, `"${step.text}" still visible`);
      return;
    case "expect text":
      await visibleText(page, step.text)
        .first()
        .waitFor({ state: "visible", timeout: EXPECT_MS })
        .catch(() => {
          throw new StepError(`text "${step.text}" not on the page`);
        });
      return;
    case "expect no text":
      await until(async () => (await visibleText(page, step.text).count()) === 0, 2000, `text "${step.text}" is on the page`);
      return;
    case "expect url":
      await until(async () => page.url().includes(step.text), EXPECT_MS, `url is ${page.url()}`);
      return;
    case "expect value": {
      const loc = await find(page, step, "input");
      let seen = "";
      await until(
        async () => (seen = await loc.inputValue({ timeout: 1000 }).catch(() => "")) === step.value,
        EXPECT_MS,
        () => `value is "${seen}"`,
      );
      return;
    }
  }
}

// Stops a click on a delete / pay / send control unless the chunk says "allow".
async function gate(loc: Locator, target: Target): Promise<void> {
  const own = await loc
    .evaluate((node) => {
      const el = node as HTMLInputElement;
      const text = (el.innerText || "").replace(/\s+/g, " ").trim();
      // Long text is a card or a row, not a button label.
      return [el.getAttribute("aria-label"), el.getAttribute("title"), el.value, text.length <= 40 ? text : ""];
    })
    .catch(() => []);
  const parts = [target.kind === "text" ? target.text : "", ...own].map((p) => String(p ?? "").trim()).filter(Boolean);
  const label = [...new Set(parts)].join(" | ");
  const word = riskyWord(label);
  if (word) throw new StepError(`safety stop: "${label.slice(0, 60)}" looks like a ${word} action. Add the line allow to the chunk if the task needs it`);
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
  if (!fallback.ok) throw new StepError(`option "${value}": ${fallback.reason}`, fallback.choices);
  await fallback.locator.click({ timeout: ACTION_MS });
}

function visibleText(page: Page, text: string): Locator {
  return page.getByText(text).filter({ visible: true });
}

async function until(check: () => Promise<boolean>, ms: number, why: string | (() => string)): Promise<void> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await check()) return;
    if (Date.now() >= deadline) throw new StepError(typeof why === "string" ? why : why());
    await new Promise((r) => setTimeout(r, 100));
  }
}

// Playwright errors carry long call logs; the agent needs one line.
function shortReason(e: Error): string {
  if (e instanceof StepError) return e.message;
  const first = e.message.split("\n")[0].replace(/^[a-zA-Z]+\.[a-zA-Z]+: /, "");
  if (/Timeout \d+ms exceeded/.test(first)) {
    const log = e.message;
    if (/intercepts pointer events/.test(log)) return "another element covers it (a dialog or overlay?)";
    if (/not enabled|disabled/.test(log)) return "it is disabled";
    if (/not visible/.test(log)) return "it is not visible";
    return `timed out after ${ACTION_MS / 1000}s`;
  }
  return first;
}
