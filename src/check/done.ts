// Proof of done: before the agent answers DONE, a Meta model compares the task with
// what really happened: the steps fastb ran (not the agent's own story) and the page now.
// In our REAL runs about half the failures were a confident DONE (gomail-3: the mail was
// written, Send was never clicked). The commit check cannot catch that: no click, no check.
// Same privacy rules as the commit check: off unless a person turns it on, values hidden first.

import { chatJson } from "../model/meta.ts";
import { assertRemoteCheck, formatEvidence, redactEvidence, redactText, safeTask, secretValues, type Evidence } from "./commit.ts";
import { riskyWord } from "../chunk/safety.ts";
import type { Step, Target } from "../chunk/parse.ts";

export type DoneStatus = "done" | "not_done" | "no_proof";
// What the agent is told. "likely_done": no proof on this page, but the final click ran.
export type DoneOutcome = DoneStatus | "likely_done";

export interface DoneVerdict {
  status: DoneStatus;
  reason: string;
  items?: { need: string; proof: string; met: boolean }[];
  strict?: boolean; // the model's own list has an unmet item: never upgraded to "likely done"
}

// One log line per step that ran, built from the parsed step (never the raw chunk text:
// it may hold a secret in another spelling). Values in secret fields become [hidden].
// Settings (task, allow) are not browser actions: null.
const SECRET_FIELD = /card|cvv|cvc|cvn|security code|expir|iban|account|routing|ssn|social security|passport|tax id|pin\b|password|passcode|token|secret/i;
export const MAX_ACTIONS = 40;

const targetText = (t: Target) => (t.kind === "ref" ? `@${t.ref}` : `${t.role ? t.role + " " : ""}"${t.text}"${t.nth ? " #" + t.nth : ""}`);

export function logLine(step: Step, clicked?: string, secret = false): string | null {
  switch (step.op) {
    case "task":
    case "allow":
      return null;
    case "goto":
      return `goto ${step.url}`;
    case "click":
    case "hover":
    case "check":
    case "uncheck":
      return `${step.op} ${targetText(step.target)}${clicked ? `  [clicked: ${clicked}]` : ""}`;
    case "fill":
    case "type":
    case "select":
    case "expect value": {
      const hide = secret || (step.target.kind === "text" && SECRET_FIELD.test(step.target.text));
      return `${step.op} ${targetText(step.target)} = ${hide ? "[hidden]" : step.value}`;
    }
    case "press":
      return `press${step.target ? " " + targetText(step.target) : ""} ${step.key}`;
    case "wait":
      return `wait ${step.ms}ms`;
    default:
      return `${step.op} "${step.text}"`;
  }
}

export function keepActions(history: string[], lines: (string | null)[]): string[] {
  return [...history, ...lines.filter((l): l is string => Boolean(l))].slice(-MAX_ACTIONS);
}

const SYSTEM = `You check whether a browser agent really finished the user's task, before it tells the user "done".
You get the task, the steps the browser really ran (in order, all of them succeeded, except a last line marked "it may have run"; this is a log, not the agent's claim; "[clicked: X]" names the control a click step clicked), and evidence from the page the browser shows now: form fields with values, and the visible text.
First list every thing the task needs to be true at the end, one per item: each final action (mail sent, table booked, item ordered, form submitted, setting saved) and each value the task names (recipient, subject, date, party size...).
For each item, give the proof: a step number from the log, or words from the page. met is true only with such proof.
Rules:
- Typing or filling a form does not send, save, book or submit it. Such an action is met only when a step clicked the control that does it (Send, Save, Book, Reserve, Submit, Place order, Pay...), or when the page shows its result (a "sent" or "confirmed" message, the item in a list of sent or booked things).
- A value is met when the log typed it into the right field before the final click, or the page shows it. Values may be written differently and still match: 2024-07-20 = July 20, 2024; 7 PM = 19:00; "4 people" = 4. If the task leaves a value open, any value is fine.
- Some values are hidden as [hidden], [number], [email] or [token]: never count a hidden value as wrong.
- Do not add items the task does not ask for.
status: "done" when every item is met; "not_done" when an item is clearly not met (its final click never ran, a value differs, the page shows an error); "no_proof" when an item cannot be shown either way from the log and this page.
reason: at most 15 words. For "not_done", what is missing, so the agent can fix it. For "no_proof", the page that would show it.`;

const SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: { need: { type: "string" }, proof: { type: "string" }, met: { type: "boolean" } },
        required: ["need", "proof", "met"],
      },
    },
    status: { type: "string", enum: ["done", "not_done", "no_proof"] },
    reason: { type: "string" },
  },
  required: ["items", "status", "reason"],
};

// The whole text that leaves the machine for one check: task, steps and page, all redacted.
export function donePrompt(task: string, actions: string[], evidence: Evidence, known: string[] = []): string {
  const secrets = [...known, ...secretValues(evidence)];
  const cleanTask = safeTask(task, secrets);
  const steps = actions.length ? actions.map((a, i) => `${i + 1}. ${redactText(a, cleanTask, secrets)}`) : ["(no steps ran)"];
  return `Task: ${cleanTask}\n\nSteps the browser ran:\n${steps.join("\n")}\n\nPage now:\n${formatEvidence(redactEvidence(evidence, cleanTask, secrets))}`;
}

export async function doneCheck(task: string, actions: string[], evidence: Evidence, known: string[] = []): Promise<DoneVerdict & { ms: number }> {
  assertRemoteCheck();
  const r = await chatJson<DoneVerdict>({
    system: SYSTEM,
    user: donePrompt(task, actions, evidence, known),
    name: "DoneCheck",
    schema: SCHEMA,
    effort: "minimal",
  });
  const status: DoneStatus = ["done", "not_done", "no_proof"].includes(r.value.status) ? r.value.status : "no_proof";
  // "done" needs every listed item met; the model's own list overrules a hasty verdict.
  const unmet = (r.value.items ?? []).filter((i) => !i.met);
  if (status === "done" && unmet.length) return { status: "no_proof", reason: oneLine(`no proof of: ${unmet.map((i) => i.need).join("; ")}`), strict: true, ms: r.ms };
  return { status, reason: oneLine(r.value.reason), ms: r.ms };
}

// The final action word of the last click on a final control (send, pay, place order...)
// in the log, or null. Only click lines count, and only the label fastb read from the page
// (the last "[clicked: X]"). Words that also name a step on the way (checkout, book, post,
// remove) do not count. A form step after the click means the click opened a form: no final.
const NOT_FINAL = new Set(["checkout", "check out", "book", "post", "remove"]);
const FORM_STEP = /^(fill|type|select|check|uncheck) /;

export function finalClick(actions: string[]): string | null {
  for (const a of [...actions].reverse()) {
    if (FORM_STEP.test(a)) return null;
    const at = a.lastIndexOf("  [clicked: ");
    if (!a.startsWith("click ") || at < 0 || !a.endsWith("]")) continue;
    const word = riskyWord(a.slice(at + 12, -1));
    if (word && !NOT_FINAL.has(word)) return word;
  }
  return null;
}

// NO PROOF after the final click sent agents to look for proof pages that many sites do not
// have (bench 2026-10-29: 2 to 5 extra calls per task). The model saw no error (that is
// "not_done"), so after a final click the answer is "likely done", not a search order.
// The line names only the action word (from a fixed list), never the page label: it may hold a value.
export function doneOutcome(v: DoneVerdict, actions: string[]): { status: DoneOutcome; line: string } {
  const final = v.status === "no_proof" && !v.strict ? finalClick(actions) : null;
  if (!final) return { status: v.status, line: doneLine(v) };
  const missing = v.reason ? `; this page does not show: ${v.reason}` : "";
  return { status: "likely_done", line: `LIKELY DONE: a "${final}" click ran and no error shows${missing}. Answer DONE unless you see a problem. Do not search other pages for proof` };
}

const oneLine = (s: string) => (s || "").replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "").slice(0, 200);

// The line the agent reads.
export function doneLine(v: DoneVerdict): string {
  if (v.status === "done") return `DONE: ${v.reason || "the page shows the task is done"}`;
  if (v.status === "not_done") return `NOT DONE: ${v.reason || "the task is not finished"}. Fix it, then run fastb done again`;
  return `NO PROOF: ${v.reason || "this page does not show the result"}. If a link on this page opens the result (Sent, Orders, Bookings), open it once and run fastb done again. If not, decide yourself`;
}

// One line per lane, after a first line with the counts.
export function lanesDoneText(rows: { name: string; line: string; status?: DoneOutcome }[], ms: number): string {
  const count = (s: DoneOutcome) => rows.filter((r) => r.status === s).length;
  const other = rows.filter((r) => !r.status).length;
  const likely = count("likely_done");
  const head = `done check (${(ms / 1000).toFixed(1)}s): ${count("done")} done${likely ? `, ${likely} likely done` : ""}, ${count("not_done")} not done, ${count("no_proof")} no proof${other ? `, ${other} not checked` : ""}`;
  return [head, ...rows.map((r) => `[${r.name}] ${r.line}`)].join("\n");
}
