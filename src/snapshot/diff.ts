// Compares two compact page views (from compact()) and returns only what changed.
// Refs stay the same while an element keeps its role and name, so a line that
// was removed and added with the same ref is one element that changed (a new
// value or state): it is shown once, as "~".

export interface PageDiff {
  added: number;
  removed: number;
  changed: number;
  lines: string[]; // "+ ", "- ", "~ " for changes, "  " for section headers kept as context
}

type Op = { kind: "same" | "add" | "del"; line: string };

const MAX_CELLS = 4_000_000;

const REF = /^\s*@(\w+) /;
const refOf = (line: string) => REF.exec(line)?.[1];
const indentOf = (line: string) => line.length - line.trimStart().length;
const isHeader = (line: string) => line.endsWith(":") && !line.trimStart().startsWith("@");

// Line diff by longest common subsequence. Common head and tail are cut first:
// most updates touch a small part of the page.
function ops(before: string[], after: string[]): Op[] {
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) tail++;
  const a = before.slice(head, before.length - tail);
  const b = after.slice(head, after.length - tail);
  if (a.length * b.length > MAX_CELLS) {
    // Too big to compare cheaply: call it all changed (the caller then sends the full page).
    return [
      ...before.map((line) => ({ kind: "del" as const, line })),
      ...after.map((line) => ({ kind: "add" as const, line })),
    ];
  }

  // lcs[i * w + j] = length of the LCS of a[i..] and b[j..]
  const w = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * w);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * w + j] = a[i] === b[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    }
  }
  const out: Op[] = before.slice(0, head).map((line) => ({ kind: "same", line }));
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push({ kind: "same", line: a[i] });
      i++;
      j++;
    } else if (j < b.length && (i >= a.length || lcs[i * w + j + 1] >= lcs[(i + 1) * w + j])) {
      out.push({ kind: "add", line: b[j++] });
    } else {
      out.push({ kind: "del", line: a[i++] });
    }
  }
  for (const line of before.slice(before.length - tail)) out.push({ kind: "same", line });
  return out;
}

// Section headers above a changed line, so the agent knows where it is.
function ancestors(list: Op[], at: number, side: "add" | "del"): number[] {
  const found: number[] = [];
  let indent = indentOf(list[at].line);
  for (let k = at - 1; k >= 0 && indent > 0; k--) {
    const op = list[k];
    if (op.kind !== "same" && op.kind !== side) continue;
    const ind = indentOf(op.line);
    if (ind < indent && isHeader(op.line)) {
      found.push(k);
      indent = ind;
    }
  }
  return found;
}

export function diffPage(before: string[], after: string[]): PageDiff {
  const list = ops(before, after);
  const addedRefs = new Set(list.filter((o) => o.kind === "add").map((o) => refOf(o.line)).filter(Boolean));
  const removedRefs = new Set(list.filter((o) => o.kind === "del").map((o) => refOf(o.line)).filter(Boolean));
  const isChange = (o: Op) => o.kind !== "same" && refOf(o.line) !== undefined && addedRefs.has(refOf(o.line)) && removedRefs.has(refOf(o.line));

  const show = new Set<number>();
  let added = 0;
  let removed = 0;
  let changed = 0;
  list.forEach((o, k) => {
    if (o.kind === "same") return;
    if (isChange(o)) {
      if (o.kind === "del") return; // shown once, from the new line
      changed++;
    } else if (o.kind === "add") added++;
    else removed++;
    show.add(k);
    for (const a of ancestors(list, k, o.kind)) show.add(a);
  });

  const lines = [...show]
    .sort((x, y) => x - y)
    .map((k) => {
      const o = list[k];
      const mark = o.kind === "same" ? " " : isChange(o) ? "~" : o.kind === "add" ? "+" : "-";
      return `${mark} ${o.line}`;
    });
  return { added, removed, changed, lines };
}
