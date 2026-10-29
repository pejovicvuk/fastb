// A size limit for the full page view. Most outputs are small; a few home and result
// pages (18-22 KB: 50 listings, 40 restaurants, a full inbox) were half of all text the
// agent read in our bench runs. Idea from Lightpanda's ranked view budget (our own code):
// repeated controls fold to one line that keeps every ref, the biggest runs of similar
// items keep their first items, page chrome folds last, and every cut leaves a marker
// line. Steps can still target hidden elements by text; `fastb look` shows the whole page.

export const VIEW_BUDGET = 8000;

const MIN_BLOCKS = 5; // similar items with children that make a run
const MIN_LINES = 6; // similar one-line items that make a run
const KEEP_STEPS = [15, 10, 6, 3];
const CHROME = /^(navigation|contentinfo|complementary)( ".*")?:$/;
// What the agent must see: dialogs, alerts, invalid fields, the checked or selected choice.
const KEEP_WHOLE = /^(dialog|alertdialog)( ".*")?:$|^! |\[[^\]]*\b(invalid|checked|selected)\b[^\]]*\]/;
// Form fields are never cut: a long form is not a list of results.
const FIELD = /^@\w+ (textbox|searchbox|combobox|spinbutton|listbox|slider|switch)\b/;
const REF = /@\w+(?= |$)/;

interface Node {
  line: string; // with its indentation
  kids: Node[];
}

interface Run {
  start: number;
  items: Node[];
  sizes: number[];
  keep: number;
}

const indentOf = (line: string) => line.length - line.trimStart().length;
const size = (lines: string[]) => lines.reduce((n, l) => n + l.length + 1, 0);

function tree(lines: string[]): Node[] {
  const roots: Node[] = [];
  const stack: Node[] = [];
  for (const line of lines) {
    const node: Node = { line, kids: [] };
    while (stack.length && indentOf(stack[stack.length - 1].line) >= indentOf(line)) stack.pop();
    (stack.length ? stack[stack.length - 1].kids : roots).push(node);
    stack.push(node);
  }
  return roots;
}

function flat(nodes: Node[], out: string[] = []): string[] {
  for (const n of nodes) {
    out.push(n.line);
    flat(n.kids, out);
  }
  return out;
}

const count = (nodes: Node[]): number => nodes.reduce((n, k) => n + 1 + count(k.kids), 0);
const marker = (indent: number, text: string) => " ".repeat(indent) + `[${text}]`;

// Repeated named controls side by side (a carousel shows each item 3 times): one line
// that keeps every ref, so each one can still be clicked by its ref.
function dedupe(n: Node, protect: (n: Node) => boolean): Node {
  if (protect(n)) return n;
  const first = new Map<string, { node: Node; refs: string[] }>();
  const kids: Node[] = [];
  for (const k of n.kids) {
    const ref = REF.exec(k.line)?.[0];
    // Only named one-line controls: nameless ones (6 filter buttons) keep their own lines.
    const key = k.kids.length || !ref || !k.line.includes('"') || protect(k) ? "" : k.line.replace(REF, "@");
    const seen = key ? first.get(key) : undefined;
    if (seen) {
      seen.refs.push(ref!);
      continue;
    }
    const copy = dedupe(k, protect);
    if (key) first.set(key, { node: copy, refs: [] });
    kids.push(copy);
  }
  for (const { node, refs } of first.values()) if (refs.length) node.line += `  (same: ${refs.join(" ")})`;
  return { line: n.line, kids };
}

// Items look alike when they differ only in refs and quoted names.
const shape = (n: Node) =>
  n.line.trimStart().replace(/  \(same: [^)]*\)$/, "").replace(REF, "@").replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/^[^@"]*$/, "text") + (n.kids.length ? " +" : "");

function findRuns(n: Node, protect: (n: Node) => boolean, out = new Map<Node, Run[]>()): Map<Node, Run[]> {
  if (n.line && protect(n) && !n.kids.length) return out;
  if (KEEP_WHOLE.test(n.line.trimStart())) return out; // nothing inside a dialog is cut
  let i = 0;
  while (i < n.kids.length) {
    let j = i + 1;
    while (j < n.kids.length && shape(n.kids[j]) === shape(n.kids[i])) j++;
    const items = n.kids.slice(i, j);
    if (items.length >= (items[0].kids.length ? MIN_BLOCKS : MIN_LINES)) {
      out.set(n, [...(out.get(n) ?? []), { start: i, items, sizes: items.map((k) => size(flat([k]))), keep: items.length }]);
    }
    i = j;
  }
  for (const k of n.kids) findRuns(k, protect, out);
  return out;
}

// Which items of a run are hidden at its current `keep`: never a protected one.
const hiddenOf = (r: Run, protect: (n: Node) => boolean) => r.items.filter((k, i) => i >= r.keep && !protect(k));

function render(n: Node, runs: Map<Node, Run[]>, protect: (n: Node) => boolean): Node {
  const hidden = new Map<Node, { first: boolean; count: number }>();
  for (const r of runs.get(n) ?? []) {
    const gone = hiddenOf(r, protect);
    gone.forEach((k, i) => hidden.set(k, { first: i === 0, count: gone.length }));
  }
  const kids: Node[] = [];
  for (const k of n.kids) {
    const h = hidden.get(k);
    if (!h) kids.push(render(k, runs, protect));
    else if (h.first) kids.push({ line: marker(indentOf(k.line), `+${h.count} more like this; fastb look shows all`), kids: [] });
  }
  return { line: n.line, kids };
}

// `keep`: lines the agent must see in this view (the changes it is told about).
export function budgetView(lines: string[], max = VIEW_BUDGET, keep: ReadonlySet<string> = new Set()): string[] {
  if (size(lines) <= max) return lines;
  const memo = new Map<Node, boolean>();
  const protect = (n: Node): boolean => {
    let v = memo.get(n);
    if (v === undefined) {
      const line = n.line.trimStart();
      v = KEEP_WHOLE.test(line) || FIELD.test(line) || keep.has(n.line) || n.kids.some(protect);
      memo.set(n, v);
    }
    return v;
  };
  const page = dedupe({ line: "", kids: tree(lines) }, (n) => n.line !== "" && protect(n) && (KEEP_WHOLE.test(n.line.trimStart()) || !n.kids.length));
  let best = flat(page.kids);
  let total = size(best);
  if (total <= max) return best;
  // 1. The biggest run of similar items keeps fewer items, one step at a time.
  //    Sizes are counted, not rendered, so many runs stay cheap.
  const runs = findRuns(page, protect);
  const floor = KEEP_STEPS[KEEP_STEPS.length - 1];
  const shown = (r: Run) => r.sizes.reduce((a, s, i) => a + (i < r.keep || protect(r.items[i]) ? s : 0), 0);
  // The count is too low when a run sits inside an item another run hid: then the
  // real size is measured and cutting goes on.
  const open = [...runs.values()].flat();
  while (open.length) {
    while (total > max && open.length) {
      const big = open.reduce((a, b) => (shown(b) > shown(a) ? b : a));
      const before = shown(big);
      big.keep = KEEP_STEPS.find((k) => k < big.keep) ?? floor;
      total -= before - shown(big);
      if (big.keep <= floor) open.splice(open.indexOf(big), 1);
    }
    best = flat(render(page, runs, protect).kids);
    total = size(best);
    if (total <= max) return best;
  }
  // 2. Then page chrome (navigation, side bars, footer) folds to one line.
  const fold = (n: Node): Node => {
    if (KEEP_WHOLE.test(n.line.trimStart())) return n;
    if (CHROME.test(n.line.trimStart()) && count(n.kids) > 3 && !n.kids.some(protect)) {
      return { line: n.line, kids: [{ line: marker(indentOf(n.line) + 2, `${count(n.kids)} lines hidden; fastb look shows them`), kids: [] }] };
    }
    return { line: n.line, kids: n.kids.map(fold) };
  };
  return flat(tree(best).map(fold));
}
