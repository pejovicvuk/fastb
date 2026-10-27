// Turns Playwright's AI aria snapshot (YAML-like, one node per line) into short
// lines for the agent: refs only on things you can act on, plain text merged.

export interface SnapNode {
  role: string;
  name: string;
  attrs: Record<string, string>;
  ref?: string;
  text: string;
  children: SnapNode[];
}

const INTERACTIVE = new Set([
  "button", "link", "textbox", "searchbox", "checkbox", "radio", "combobox",
  "listbox", "option", "menuitem", "menuitemcheckbox", "menuitemradio", "tab",
  "switch", "slider", "spinbutton", "treeitem",
]);

// Roles worth a header line when they hold something actionable.
const SECTION = new Set([
  "dialog", "alertdialog", "form", "navigation", "banner", "main", "table",
  "tablist", "menu", "menubar", "toolbar", "search", "region", "complementary",
]);

// Attributes that tell the agent about state; the rest are dropped.
const STATE_ATTRS = ["checked", "disabled", "expanded", "selected", "pressed", "required", "invalid"];

const NOISE_TEXT = new Set(["•", "·", "|", "-", "/"]);

const LABEL_ROLES = new Set(["generic", "paragraph", "listitem", "text"]);

const LINE = /^(\s*)- (.*)$/;

function parseLine(content: string): Omit<SnapNode, "children"> | null {
  let rest = content;
  // YAML single-quotes the whole key when the name holds a colon: 'button "a: b" [ref=e1]': text
  if (rest.startsWith("'")) {
    const end = rest.indexOf("':", 1) >= 0 ? rest.indexOf("':", 1) : rest.lastIndexOf("'");
    if (end > 0) rest = rest.slice(1, end).replace(/''/g, "'") + rest.slice(end + 1);
  }
  if (rest.startsWith("/")) return null; // properties such as "/url: ..."
  const roleMatch = /^([a-zA-Z]+)/.exec(rest);
  if (!roleMatch) return { role: "text", name: "", attrs: {}, text: unquote(rest) };
  const role = roleMatch[1];
  rest = rest.slice(role.length).trimStart();

  let name = "";
  if (rest.startsWith('"')) {
    const end = closingQuote(rest);
    name = unquote(rest.slice(0, end + 1));
    rest = rest.slice(end + 1).trimStart();
  }

  const attrs: Record<string, string> = {};
  let ref: string | undefined;
  while (rest.startsWith("[")) {
    const end = rest.indexOf("]");
    if (end < 0) break;
    const [key, value = ""] = rest.slice(1, end).split("=", 2);
    if (key === "ref") ref = value;
    else attrs[key] = value;
    rest = rest.slice(end + 1).trimStart();
  }

  let text = "";
  if (rest.startsWith(":")) text = unquote(rest.slice(1).trim());
  return { role, name, attrs, ref, text };
}

function closingQuote(s: string): number {
  for (let i = 1; i < s.length; i++) {
    if (s[i] === "\\") i++;
    else if (s[i] === '"') return i;
  }
  return s.length - 1;
}

function unquote(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    try {
      return JSON.parse(s) as string;
    } catch {
      return s.slice(1, -1);
    }
  }
  return s;
}

export function parseSnapshot(yaml: string): SnapNode[] {
  const roots: SnapNode[] = [];
  const stack: { indent: number; node: SnapNode }[] = [];
  for (const raw of yaml.split("\n")) {
    const m = LINE.exec(raw);
    if (!m) continue;
    const indent = m[1].length;
    const parsed = parseLine(m[2]);
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    if (!parsed) {
      // A field with no label often has only its hint text: use it as the name.
      const ph = /^\/placeholder:\s*(.*)$/.exec(m[2]);
      const owner = stack[stack.length - 1]?.node;
      if (ph && owner && !owner.name) owner.name = unquote(ph[1].trim());
      continue;
    }
    const node: SnapNode = { ...parsed, children: [] };
    if (stack.length) stack[stack.length - 1].node.children.push(node);
    else roots.push(node);
    stack.push({ indent, node });
  }
  return roots;
}

function isInteractive(n: SnapNode): boolean {
  return n.ref !== undefined && (INTERACTIVE.has(n.role) || "cursor" in n.attrs);
}

// Image names are used only when a block has no other text: they mostly repeat it.
function collectText(n: SnapNode): string[] {
  const words = gather(n, false);
  return words.length ? words : gather(n, true);
}

function gather(n: SnapNode, withImages: boolean, out: string[] = []): string[] {
  if (n.role !== "img" || withImages) {
    for (const part of [n.name, n.text]) {
      const t = part.trim();
      if (t && !NOISE_TEXT.has(t) && out[out.length - 1] !== t) out.push(t);
    }
  }
  for (const c of n.children) gather(c, withImages, out);
  return out;
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function stateSuffix(n: SnapNode): string {
  const parts = STATE_ATTRS.filter((a) => a in n.attrs).map((a) =>
    n.attrs[a] && n.attrs[a] !== "true" ? `${a}=${n.attrs[a]}` : a,
  );
  return parts.length ? ` [${parts.join(" ")}]` : "";
}

export interface CompactOptions {
  maxText?: number;
}

export function compact(nodes: SnapNode[], opts: CompactOptions = {}): string[] {
  const maxText = opts.maxText ?? 160;
  const lines: string[] = [];
  const emit = (depth: number, s: string) => lines.push("  ".repeat(depth) + s);
  const hasInteractive = (n: SnapNode): boolean => n.children.some((c) => isInteractive(c) || hasInteractive(c));

  const visit = (n: SnapNode, depth: number) => {
    if (isInteractive(n)) {
      const role = INTERACTIVE.has(n.role) ? `${n.role} ` : "";
      const inner = hasInteractive(n);
      const label = n.name || (inner ? "" : collectText({ ...n, name: "" }).join(" · "));
      if (!role && !label && !inner) return; // a nameless clickable box tells the agent nothing
      const value = n.name && n.text && !inner ? ` = ${JSON.stringify(clip(n.text, maxText))}` : "";
      emit(depth, `@${n.ref} ${role}${JSON.stringify(clip(label, maxText))}${value}${stateSuffix(n)}`.replace(' ""', ""));
      if (inner) for (const c of n.children) visit(c, depth + 1);
      return;
    }
    if (!hasInteractive(n)) {
      const text = collectText(n);
      // A short standalone label keeps its ref: some apps make plain text clickable
      // without a role or pointer cursor (GoMail's "Compose").
      if (n.ref && !n.children.length && LABEL_ROLES.has(n.role) && text.length === 1 && text[0].length <= 40) {
        emit(depth, `@${n.ref} ${JSON.stringify(text[0])}`);
        return;
      }
      if (text.length) {
        const prefix = n.role === "heading" ? "# " : n.role === "alert" ? "! " : "";
        const merged = text.join(" · ");
        if (merged.length <= maxText) {
          emit(depth, prefix + merged);
        } else if (n.role === "row") {
          // A row keeps all its cells on one line; only a long cell is cut.
          emit(depth, prefix + text.map((t) => clip(t, maxText)).join(" · "));
        } else if (!n.children.length) {
          emit(depth, prefix + clip(merged, maxText));
        } else {
          // Split large blocks instead of hiding later rows or paragraphs.
          const own = collectText({ ...n, children: [] }).join(" · ");
          if (own) emit(depth, prefix + own);
          const firstChildLine = lines.length;
          for (const c of n.children) visit(c, depth + 1);
          if (prefix && !own && lines.length > firstChildLine) {
            lines[firstChildLine] = lines[firstChildLine].replace(/^(\s*)/, `$1${prefix}`);
          }
        }
      }
      return;
    }
    if (SECTION.has(n.role) || (n.name && n.role !== "generic")) {
      emit(depth, `${n.role}${n.name ? " " + JSON.stringify(clip(n.name, maxText)) : ""}:`);
      for (const c of n.children) visit(c, depth + 1);
      return;
    }
    for (const c of n.children) visit(c, depth);
  };

  for (const n of nodes) visit(n, 0);
  return lines;
}
