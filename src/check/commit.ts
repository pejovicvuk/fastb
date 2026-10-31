// Commit check: right before an allowed send / pay / book click, a Meta model compares
// (only when a person turned it on, see remoteCheckEnabled; private values are hidden first)
// the task with what the page really holds. Agents often say DONE when a value is wrong
// (in our REAL runs, most failures were confident DONEs); this catches it before the click.

import type { Page } from "playwright-core";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HOME } from "../paths.ts";
import { chatJson } from "../model/meta.ts";

export interface Field {
  label: string;
  value: string;
  kind: string; // input type, select, textarea, ...
  state?: string; // checked, disabled, min/max
}

export interface Evidence {
  title: string;
  url: string;
  fields: Field[];
  text: string; // visible page text, cut
  // Only compared on this machine, never sent: all visible text (up to WHOLE_MAX) without
  // short messages (alerts, status lines, toasts, banners), and those messages apart.
  whole?: string;
  transient?: { id: number; text: string }[];
}

export const TEXT_MAX = 4000; // characters of visible page text sent in one check
const WHOLE_MAX = 200000; // characters compared between two readings (never sent)
// Short messages that come and go by themselves (alerts, status lines, toasts): when one
// goes away during the check, the page did not change in a way that matters. Only small
// elements with no form fields count; a new message, or a message whose text changed, is a change.
const TRANSIENT = '[role="alert"], [role="status"], [role="log"], [role="marquee"], [role="timer"], [aria-live="polite"], [aria-live="assertive"], [class*="toast" i], [class*="snackbar" i]';
const MESSAGE_MAX = 500; // characters: a longer element is page content, not a message

// Read in the page. Plain JS text: a transpiled function may carry helpers the page lacks.
const READ_EVIDENCE = `(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const clean = (s) => (s || "").replace(/\\s+/g, " ").trim();
  const labelOf = (el) => {
    const byFor = el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]') : null;
    const byIds = (el.getAttribute("aria-labelledby") || "").split(/\\s+/).filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent || "").join(" ");
    return clean(el.getAttribute("aria-label") || byIds || byFor?.textContent || el.closest("label")?.textContent ||
      el.getAttribute("placeholder") || el.getAttribute("name") || "");
  };
  const fields = [];
  for (const el of document.querySelectorAll('input, select, textarea, [contenteditable="true"], [role="spinbutton"], [role="combobox"]')) {
    if (!visible(el) || el.type === "hidden" || el.type === "password") continue;
    let value = el.tagName === "SELECT" ? (el.selectedOptions[0]?.textContent || el.value) : el.isContentEditable ? el.innerText : (el.value ?? el.textContent);
    if (el.getAttribute("role") === "spinbutton") value = el.getAttribute("aria-valuenow") || clean(el.textContent);
    const state = [el.checked ? "checked" : "", el.disabled ? "disabled" : "", el.min ? "min=" + el.min : "", el.max ? "max=" + el.max : ""].filter(Boolean).join(" ");
    const kind = el.tagName === "INPUT" ? (el.type || "text") : el.tagName.toLowerCase();
    if ((kind === "checkbox" || kind === "radio") && !el.checked) continue;
    fields.push({ label: labelOf(el).slice(0, 80), value: clean(String(value)).slice(0, 200), kind, state: state || undefined });
    if (fields.length >= 60) break;
  }
  const all = clean(document.body.innerText);
  // Messages: outermost small elements with no fields. Each keeps one id for the page's life
  // (a WeakMap in the page, not an attribute: the page is not changed).
  const ids = (window.__fastbMessageIds ??= { map: new WeakMap(), next: 1 });
  const isMessage = (el) => el.matches(${JSON.stringify(TRANSIENT)}) && visible(el) &&
    !el.querySelector('input, select, textarea, [contenteditable="true"]') && clean(el.innerText).length <= ${MESSAGE_MAX};
  const messages = Array.from(document.querySelectorAll(${JSON.stringify(TRANSIENT)})).filter(isMessage)
    .filter((el) => { for (let a = el.parentElement; a; a = a.parentElement) if (isMessage(a)) return false; return true; });
  const inMessage = new Set(messages);
  const transient = messages.map((el) => {
    if (!ids.map.has(el)) ids.map.set(el, ids.next++);
    return { id: ids.map.get(el), text: clean(el.innerText) };
  });
  // All visible text outside the messages, node by node (the same words elsewhere stay).
  const parts = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  // A text node is visible when it has boxes on screen (also under display: contents,
  // where the parent element itself has none) and its parent is not visibility: hidden.
  const range = document.createRange();
  const shown = (n) => { range.selectNodeContents(n); return range.getClientRects().length > 0 && getComputedStyle(n.parentElement).visibility !== "hidden"; };
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const el = n.parentElement;
    if (!el || !n.textContent.trim() || !shown(n)) continue;
    let skip = false;
    for (let a = el; a && !skip; a = a.parentElement) skip = inMessage.has(a);
    if (!skip) parts.push(n.textContent);
  }
  return { title: document.title, url: location.href, fields, text: all.slice(0, ${TEXT_MAX}), whole: clean(parts.join(" ")).slice(0, ${WHOLE_MAX}), transient };
})()`;

export async function readEvidence(page: Page): Promise<Evidence> {
  return (await page.evaluate(READ_EVIDENCE)) as Evidence;
}

// Labels of fields whose values never leave the machine.
const SECRET_LABEL = /card|cvv|cvc|cvn|security code|expir|iban|account|routing|ssn|social security|passport|tax id|pin\b|password|token|secret/i;
const LONG_NUMBER = /\+?\d(?:[ -]?\d){5,}/g; // card, account and phone numbers: 6+ digits
const DATE = /^(\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4})$/; // dates stay: the check compares them
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

const TOKEN = /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{20,}\b/g; // keys, session ids
const URL_QUERY = /(https?:\/\/[^\s?#"]+)[?#][^\s"]*/g;

// Hides private values in free text: emails, 6+ digit numbers (not dates), token-like
// strings, URL queries, and any of the given secret values. Values the task names stay.
// Removes known secret values. Any length; short ones (a 3-digit CVV, a PIN) only as
// whole words, so they do not hit digits inside prices, dates or phone numbers.
export function removeSecrets(text: string, secrets: string[]): string {
  let out = text;
  for (const sec of [...new Set(secrets)].filter(Boolean).sort((a, b) => b.length - a.length)) {
    if (sec.length >= 6) out = out.split(sec).join("[hidden]");
    else out = out.replace(new RegExp(`(?<![\\w])${sec.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`, "g"), "[hidden]");
  }
  return out;
}

export function redactText(text: string, task: string, secrets: string[] = []): string {
  const known = task.toLowerCase();
  const out = removeSecrets(text, secrets);
  return out
    .replace(URL_QUERY, "$1")
    .replace(EMAIL, (m) => (known.includes(m.toLowerCase()) ? m : "[email]"))
    .replace(TOKEN, (m) => (known.includes(m.toLowerCase()) ? m : "[token]"))
    .replace(LONG_NUMBER, (m) => (DATE.test(m) || known.includes(m) || known.includes(m.replace(/\D/g, "")) ? m : "[number]"));
}

// Hides private values before evidence goes to the Meta API. A secret field's value
// is removed from every surface (text, title, labels), not only from the field.
// The URL keeps only origin and path.
export function secretValues(e: Evidence): string[] {
  return e.fields.filter((f) => SECRET_LABEL.test(f.label) && f.value).map((f) => f.value);
}

export function redactEvidence(e: Evidence, task: string, known: string[] = []): Evidence {
  const secrets = [...known, ...secretValues(e)];
  const hide = (text: string) => redactText(text, task, secrets);
  let url = e.url;
  try {
    const u = new URL(e.url);
    url = u.origin + u.pathname;
  } catch {
    url = e.url.split(/[?#]/)[0];
  }
  return {
    title: hide(e.title),
    url: hide(url),
    fields: e.fields.map((f) => ({ ...f, label: hide(f.label), value: SECRET_LABEL.test(f.label) ? (f.value ? "[hidden]" : "") : hide(f.value) })),
    text: hide(e.text),
  };
}

// The check sends page facts to the Meta API, so a person must turn it on, not the agent:
// a file the person writes (fastb has no command for it, and an agent limited to
// running fastb cannot write files). Read on every check, so removing it turns it off.
export const REMOTE_CHECK_FILE = join(HOME, "remote-check");
export function remoteCheckEnabled(): boolean {
  return existsSync(REMOTE_CHECK_FILE) && readFileSync(REMOTE_CHECK_FILE, "utf8").trim() === "on";
}

// Asked again right before each request: page reads take time, and the person may
// have turned the check off since the command started.
export function assertRemoteCheck(): void {
  if (!remoteCheckEnabled()) throw new Error("the remote check was turned off");
}

export function formatEvidence(e: Evidence): string {
  const fields = e.fields.map((f) => `- ${f.label || "(no label)"} [${f.kind}${f.state ? " " + f.state : ""}]: ${f.value || "(empty)"}`);
  return [`page: ${e.title} | ${e.url}`, "fields:", ...(fields.length ? fields : ["- (none)"]), "visible text:", e.text].join("\n");
}

export interface Verdict {
  ok: boolean;
  mismatches: { fact: string; expected: string; found: string }[];
}

const SYSTEM = `You check a browser agent's work right before an irreversible click (send, pay, book, order).
You get the user's task, the control about to be clicked, and evidence from the page: form fields with their values, and the visible text.
Report a mismatch only when the evidence clearly shows a value that differs from what the task asks, or a value the task requires is visibly missing or empty.
Values may be written differently and still match: 2024-07-20 = July 20, 2024 = 07/20/2024; 7 PM = 19:00 = 7:00 PM; "4 people" = 4.
If the task says "anything" or leaves a value open, any value matches. If the evidence does not show a fact at all, do not report it.
Some fields turn a typed value into a chip or tag (To, Cc, tags) and then look empty: if the visible text shows the value, it is not missing.
Be brief: fact names of 1 to 3 words.`;

const SCHEMA = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    mismatches: {
      type: "array",
      items: {
        type: "object",
        properties: { fact: { type: "string" }, expected: { type: "string" }, found: { type: "string" } },
        required: ["fact", "expected", "found"],
      },
    },
  },
  required: ["ok", "mismatches"],
};

// The whole text that leaves the machine for one check: every part goes through redaction.
// The task with secrets hidden, whether or not their fields are on the page now: known
// secrets, card-like numbers (13-19 digits), and the value after words like CVV, PIN,
// password. Other values stay (the check compares them).
const CARD = /\b\d(?:[ -]?\d){12,18}\b/g;
// The value after a secret word, also in quoted or JSON form: password: x, "password": "x", PIN=x.
const SECRET_WORD_VALUE = /\b(cvv|cvc|cvn|security code|pin|password|passcode|passphrase|api[ _-]?key|api token|token|secret)(["']?\s*(?:is|to|as|:|=)?\s*["']?)([^\s"',;}\]]+)/gi;
export function safeTask(task: string, secrets: string[] = []): string {
  return removeSecrets(task, secrets)
    .replace(CARD, "[number]")
    .replace(TOKEN, "[token]")
    .replace(SECRET_WORD_VALUE, (_m, word: string, gap: string) => `${word}${gap}[hidden]`);
}

export function commitPrompt(task: string, action: string, evidence: Evidence, known: string[] = []): string {
  const secrets = [...known, ...secretValues(evidence)];
  // A known secret stays hidden even when the task names it ("pay using CVV 123").
  const cleanTask = safeTask(task, secrets);
  const safeAction = redactText(action, cleanTask, secrets);
  return `Task: ${cleanTask}\nAbout to click: ${safeAction}\n\nEvidence:\n${formatEvidence(redactEvidence(evidence, cleanTask, secrets))}`;
}

export async function commitCheck(task: string, action: string, evidence: Evidence, known: string[] = []): Promise<Verdict & { ms: number }> {
  assertRemoteCheck();
  const r = await chatJson<Verdict>({
    system: SYSTEM,
    user: commitPrompt(task, action, evidence, known),
    name: "CommitCheck",
    schema: SCHEMA,
  });
  return { ...r.value, ms: r.ms };
}

// `seen`: the page reading the verdict is about (an early check is used only while the
// page still matches it). `changed`: the page moved during the check.
export type CheckOutcome =
  | { kind: "ok"; ms: number; seen?: Evidence } // verdict OK and the page did not move: click
  | { kind: "stop"; reason: string; model: boolean; ms?: number; seen?: Evidence; changed?: boolean } // do not click; model: the Meta model found a mismatch
  | { kind: "skipped"; error: string }; // the Meta API failed: the click goes on, the agent is told

// The whole check before one click. Page reads that fail stop the click (we cannot
// know what would be clicked); a negative verdict stops it at once; only an API
// failure lets it go on. `read` and `ask` are passed in so tests can make them fail.
export async function runCommitCheck(
  task: string,
  action: string,
  read: () => Promise<Evidence>,
  ask: (task: string, action: string, e: Evidence) => Promise<Verdict & { ms: number }> = (t, a, e) => commitCheck(t, a, e),
): Promise<CheckOutcome> {
  const error = (err: unknown) => (err instanceof Error ? err.message : String(err)).split("\n")[0];
  let before: Evidence;
  try {
    before = await read();
  } catch (err) {
    return { kind: "stop", reason: `could not read the page for the check (${error(err)}); run the step again`, model: false };
  }
  let v: Verdict & { ms: number };
  try {
    v = await ask(task, action, before);
  } catch (err) {
    return { kind: "skipped", error: error(err) };
  }
  const mismatch = mismatchReason(v);
  if (mismatch) return { kind: "stop", reason: mismatch, model: true, ms: v.ms, seen: before };
  // The verdict holds only for the state it saw: read again, and stop if anything moved.
  let after: Evidence;
  try {
    after = await read();
  } catch (err) {
    return { kind: "stop", reason: `could not read the page again after the check (${error(err)}); run the step again`, model: false, ms: v.ms };
  }
  const moved = changedFields(before, after);
  if (moved.length) return { kind: "stop", reason: `the page changed during the check (${moved.join(", ")}); run the step again`, model: false, ms: v.ms, changed: true };
  return { kind: "ok", ms: v.ms, seen: after };
}

// A page that moved during the check gets one more check before the click is stopped
// (a cart total or a list that was still loading). `ms`: the time of all checks.
export async function checkWithRetry(run: () => Promise<CheckOutcome>, tries = 2): Promise<CheckOutcome> {
  let ms = 0;
  for (let t = 1; ; t++) {
    const out = await run();
    if (out.kind !== "skipped") ms += out.ms ?? 0;
    if (out.kind === "skipped" || !(out.kind === "stop" && out.changed) || t >= tries) return out.kind === "skipped" ? out : { ...out, ms };
  }
}

// An early check (started while the steps before the click ran) counts only for the
// page it saw: its OK or its mismatch is used when a new reading at click time is the
// same; else, or when it could not finish, `again` checks the page as it is now.
export async function finishEarlyCheck(
  early: Promise<CheckOutcome>,
  read: () => Promise<Evidence>,
  again: () => Promise<CheckOutcome>,
): Promise<CheckOutcome & { reused?: boolean }> {
  const first = await early.catch(() => undefined);
  if (first && first.kind !== "skipped" && first.seen && (first.kind === "ok" || first.model)) {
    const now = await read().catch(() => undefined);
    if (now && !changedFields(first.seen, now).length) return { ...first, reused: true };
  }
  return again();
}

// What differs between two readings (the page may change during the check): each
// field by its position, the URL and the visible text. The verdict holds only for
// what it saw, so any difference means: do not click.
export function changedFields(before: Evidence, after: Evidence): string[] {
  const out: string[] = [];
  const n = Math.max(before.fields.length, after.fields.length);
  for (let i = 0; i < n; i++) {
    const a = before.fields[i];
    const b = after.fields[i];
    if (!a || !b || a.label !== b.label || a.kind !== b.kind || a.value !== b.value || a.state !== b.state) out.push((b ?? a).label || `field ${i + 1}`);
  }
  if (before.url !== after.url) out.push("url");
  if ((before.whole ?? before.text) !== (after.whole ?? after.text)) out.push("page text");
  else {
    // A message may go away; a new one, or one whose text changed, is a change.
    const was = new Map((before.transient ?? []).map((m) => [m.id, m.text]));
    if ((after.transient ?? []).some((m) => was.get(m.id) !== m.text)) out.push("page text");
  }
  return out;
}

// The short stop reason the agent reads, or null when the page matches the task.
export function mismatchReason(v: Verdict): string | null {
  if (v.ok && !v.mismatches.length) return null;
  if (!v.mismatches.length) return "the page does not match the task";
  return v.mismatches.map((m) => `${m.fact} is "${m.found}", task wants "${m.expected}"`).join("; ");
}
