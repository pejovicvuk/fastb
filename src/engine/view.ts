import type { Page } from "playwright-core";
import { pageHeader, pageLines } from "../snapshot/look.ts";
import { diffPage } from "../snapshot/diff.ts";
import type { RunResult } from "../chunk/run.ts";

// What the agent is shown of the page, and the page as it last saw it.

// Changes are sent only when they are clearly shorter than the full page.
const DIFF_MAX_SHARE = 0.7;

export interface View {
  text: string;
  full?: number; // chars of the full page, when only changes were sent
}

// Each page as the agent last saw it: the base for "only what changed".
// One entry per page, so every lane and tab keeps its own base.
const seen = new WeakMap<Page, string[]>();

export function forgetView(page: Page): void {
  seen.delete(page);
}

export async function showPage(page: Page): Promise<string> {
  const lines = await pageLines(page);
  seen.set(page, lines);
  return `${await pageHeader(page)}\n${lines.join("\n")}`;
}

// After a chunk: only what changed since the agent last saw this page, or the
// full page when there is no base or the changes are not much shorter.
export async function showChanges(page: Page): Promise<View> {
  const header = await pageHeader(page);
  const lines = await pageLines(page);
  const before = seen.get(page);
  seen.set(page, lines);
  const fullText = `${header}\n${lines.join("\n")}`;
  if (!before) return { text: fullText };
  const d = diffPage(before, lines);
  const changes = d.lines.length
    ? `changes since the last view (+${d.added} -${d.removed} ~${d.changed}):\n${d.lines.join("\n")}`
    : "no changes on the page";
  const text = `${header}\n${changes}`;
  if (text.length > fullText.length * DIFF_MAX_SHARE) return { text: fullText };
  return { text, full: fullText.length };
}

// The answer to a run: the step result first, then the page. The steps already
// ran, so a failed page read must not hide what was done.
export async function runReport(result: RunResult, view: () => Promise<View>): Promise<View> {
  const secs = (result.ms / 1000).toFixed(1);
  const lines: string[] = [];
  if (result.ok) lines.push(`OK ${result.done}/${result.total} steps ${secs}s`);
  else {
    const f = result.failure!;
    lines.push(`STOP at step ${f.index + 1}/${result.total}: ${f.source}`);
    lines.push(`reason: ${f.reason}`);
    if (f.choices) lines.push("choices (add #n to the target):", ...f.choices.map((c) => "  " + c));
    lines.push(result.done ? `done: steps 1-${result.done} in ${secs}s` : `done: none (${secs}s)`);
  }
  let page: View;
  try {
    page = await view();
  } catch (err) {
    page = { text: `page: could not read it (${(err instanceof Error ? err.message : String(err)).split("\n")[0]}). Run fastb look.` };
  }
  lines.push(page.text);
  return { text: lines.join("\n"), full: page.full };
}
