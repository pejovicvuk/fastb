import type { Page } from "playwright-core";
import { pageHeader, pageLines } from "../snapshot/look.ts";
import { diffPage } from "../snapshot/diff.ts";
import { budgetView } from "../snapshot/budget.ts";
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

// The line the agent last saw for a ref on this page. Undefined when the agent saw
// more than one element with the same role and name: then a re-rendered element
// cannot be told from the others (two rows, each with a "Delete").
export function seenLine(page: Page, ref: string): string | undefined {
  const lines = seen.get(page) ?? [];
  const head = `@${ref} `;
  const line = lines.find((l) => l.trimStart().startsWith(head));
  const what = line && /^@\w+ ([a-z]+ "(?:[^"\\]|\\.)*")/.exec(line.trimStart())?.[1];
  if (!what) return undefined;
  const same = lines.filter((l) => {
    const rest = l.trimStart().replace(/^@\w+ /, "");
    return rest === what || rest.startsWith(what + " ");
  });
  return same.length === 1 ? line : undefined;
}

// A big page is cut to a size budget (see budget.ts); `all` shows every line.
// The base for later diffs is always the whole page.
export async function showPage(page: Page, opts: { all?: boolean } = {}): Promise<string> {
  const lines = await pageLines(page);
  seen.set(page, lines);
  return `${await pageHeader(page)}\n${(opts.all ? lines : budgetView(lines)).join("\n")}`;
}

// After a chunk: only what changed since the agent last saw this page, or the
// full page when there is no base or the changes are not much shorter.
export async function showChanges(page: Page): Promise<View> {
  const header = await pageHeader(page);
  const lines = await pageLines(page);
  const before = seen.get(page);
  seen.set(page, lines);
  if (!before) return { text: `${header}\n${budgetView(lines).join("\n")}` };
  const d = diffPage(before, lines);
  // When the full page is sent instead of the changes, the budget must not hide the
  // changes. On a new page (most lines new) there is nothing to keep apart.
  const news = d.lines.filter((l) => l.startsWith("+ ") || l.startsWith("~ ")).map((l) => l.slice(2));
  const fullText = `${header}\n${budgetView(lines, undefined, news.length < lines.length / 2 ? new Set(news) : undefined).join("\n")}`;
  const changes = d.lines.length
    ? `changes since the last view (+${d.added} -${d.removed} ~${d.changed}):\n${d.lines.join("\n")}`
    : "no changes on the page";
  const text = `${header}\n${changes}`;
  if (text.length > fullText.length * DIFF_MAX_SHARE) return { text: fullText };
  return { text, full: fullText.length };
}

const VIEW_MS = 15000;

// The answer to a run: the step result first, then the page. The steps already
// ran, so a failed page read must not hide what was done.
export async function runReport(result: RunResult, view: () => Promise<View>, viewMs = VIEW_MS): Promise<View> {
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
  // Steps that did not run ("optional" found nothing, an "if" did not hold), one line each.
  for (const s of result.skipped ?? []) {
    const src = s.source.length > 80 ? s.source.slice(0, 79) + "…" : s.source;
    lines.push(`skipped step ${s.index + 1}: ${src} (${s.reason})`);
  }
  let page: View;
  try {
    // A page whose navigation never commits holds every read: the result must still come back.
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<never>((_, no) => (timer = setTimeout(() => no(new Error(`no answer in ${Math.round(viewMs / 1000)}s, the page may still be loading`)), viewMs)));
    const read = view();
    read.catch(() => {});
    page = await Promise.race([read, late]).finally(() => clearTimeout(timer));
  } catch (err) {
    page = { text: `page: could not read it (${(err instanceof Error ? err.message : String(err)).split("\n")[0]}). Run fastb look.` };
  }
  lines.push(page.text);
  return { text: lines.join("\n"), full: page.full };
}
