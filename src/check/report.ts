// Lane report: with many lanes, a Meta model groups their latest results by cause,
// so the agent reads a few lines instead of every lane's output.

import { chatJson } from "../model/meta.ts";
import { redactText } from "./commit.ts";
import type { Step } from "../chunk/parse.ts";
import type { FailCode } from "../chunk/run.ts";

// A lane's latest result as data, never page text: the report is built only from this.
export interface LaneOutcome {
  ok: boolean;
  done: number;
  total: number;
  stop?: { index: number; step: Step; code: FailCode; checkReason?: string };
}

export interface LaneItem {
  name: string;
  outcome: LaneOutcome; // the task is never sent: it may hold the user's private values
}

// A step's kind and target, never its value (a typed text, an expected value, a URL query).
export function stepShape(step: Step): string {
  const target = "target" in step && step.target
    ? step.target.kind === "ref"
      ? `@${step.target.ref}`
      : `${step.target.role ? step.target.role + " " : ""}"${step.target.text}"${step.target.nth ? " #" + step.target.nth : ""}`
    : "";
  if (step.op === "goto") {
    try {
      return `goto ${new URL(step.url.includes("://") ? step.url : `https://${step.url}`).origin}`;
    } catch {
      return "goto";
    }
  }
  if (step.op === "wait for text" || step.op === "wait for gone" || step.op === "expect text" || step.op === "expect no text" || step.op === "expect url") return step.op;
  if (step.op === "press") return `press${target ? " " + target : ""} ${step.key}`;
  if (step.op === "task" || step.op === "allow" || step.op === "wait") return step.op;
  return `${step.op} ${target}`.trim();
}

// Plain words for each failure code: the only reason text that leaves the machine.
const CODE_TEXT: Record<FailCode, string> = {
  "not-found": "target not found",
  "ref-gone": "ref no longer on the page",
  "many-matches": "several elements match the target",
  "no-target": "step has no target",
  covered: "another element covers the target",
  disabled: "target is disabled",
  "not-visible": "target is not visible",
  timeout: "action timed out",
  "not-text-field": "target is not a text field",
  "option-missing": "option not in the list",
  "text-missing": "expected text not on the page",
  "text-present": "text that must be absent is on the page",
  "still-visible": "element still visible",
  "url-mismatch": "url differs from the expected one",
  "value-differs": "field value differs from the expected one",
  "safety-stop": "safety stop: risky click without allow",
  "check-mismatch": "the commit check found a mismatch",
  "check-blocked": "the commit check could not verify the page",
  error: "step failed",
};

function reasonOf(stop: NonNullable<LaneOutcome["stop"]>): string {
  // The commit check's own mismatch was made from already-redacted evidence.
  return stop.code === "check-mismatch" && stop.checkReason ? `check: ${stop.checkReason}` : CODE_TEXT[stop.code];
}

export interface Group {
  outcome: "ok" | "stopped";
  cause: string; // empty for ok
  lanes: string[];
}

const SYSTEM = `You summarize the results of browser test lanes for a coding agent.
Each lane has a name and its latest result: OK, or STOP with the step (kind and target only) and the reason. Some values are hidden as [hidden], [number], [email] or [token].
Group the lanes: one group for all lanes that finished OK, and one group per shared cause for lanes that stopped.
Group by the kind of problem, not by the exact value: lanes where the same field is wrong, the same button is missing, or the same error appears go in ONE group, even when the wrong values differ.
Put the differing values in the cause, for example: "date is not July 20 (Jul 19, Jul 21)".
A cause is one short sentence in plain words, specific enough to act on. Never invent causes that the results do not show.
Use as few groups as the results allow.`;

const SCHEMA = {
  type: "object",
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        properties: {
          outcome: { type: "string", enum: ["ok", "stopped"] },
          cause: { type: "string" },
          lanes: { type: "array", items: { type: "string" } },
        },
        required: ["outcome", "cause", "lanes"],
      },
    },
  },
  required: ["groups"],
};

// Each lane's outcome as a few lines, private values hidden, cut so many lanes fit.
export function reportInput(items: LaneItem[], maxChars = 400): string {
  return items
    .map((i) => {
      const o = i.outcome;
      const lines = o.ok
        ? [`OK ${o.done}/${o.total}`]
        : o.stop
          ? [`STOP at step ${o.stop.index + 1}/${o.total}: ${stepShape(o.stop.step)}`, `reason: ${reasonOf(o.stop)}`]
          : [`STOP (${o.done}/${o.total} done)`];
      // Redact first, then cut: a cut must not split a secret into a part the rules miss.
      const body = redactText(lines.join("\n"), "").slice(0, maxChars);
      return [`## lane ${i.name}`, body].join("\n");
    })
    .join("\n\n");
}

export function formatReport(groups: Group[], ms: number): string {
  const ok = groups.filter((g) => g.outcome === "ok").flatMap((g) => g.lanes);
  const stopped = groups.filter((g) => g.outcome === "stopped");
  const nStopped = stopped.reduce((n, g) => n + g.lanes.length, 0);
  const lines = [`report (${(ms / 1000).toFixed(1)}s): ${ok.length} ok, ${nStopped} stopped`];
  if (ok.length) lines.push(`ok: ${ok.join(" ")}`);
  for (const g of stopped.sort((a, b) => b.lanes.length - a.lanes.length)) lines.push(`stopped (${g.lanes.length}), ${g.cause}: ${g.lanes.join(" ")}`);
  return lines.join("\n");
}

export async function laneReport(items: LaneItem[]): Promise<string> {
  const r = await chatJson<{ groups: Group[] }>({ system: SYSTEM, user: reportInput(items), name: "LaneReport", schema: SCHEMA });
  // Keep only lanes that exist, each once: the model must not invent or repeat lanes.
  const known = new Set(items.map((i) => i.name));
  const seen = new Set<string>();
  const groups = r.value.groups
    .map((g) => ({ ...g, lanes: g.lanes.filter((l) => known.has(l) && !seen.has(l) && seen.add(l)) }))
    .filter((g) => g.lanes.length);
  const missing = [...known].filter((l) => !seen.has(l));
  if (missing.length) groups.push({ outcome: "stopped", cause: "not grouped by the model: read with fastb look --lane", lanes: missing });
  return formatReport(groups, r.ms);
}
