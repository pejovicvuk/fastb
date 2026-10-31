// Parses a chunk: one step per line. Examples:
//   goto https://example.com
//   fill "Email" = test@x.com
//   click button "Create account"
//   click @e23
//   select "Size" = Medium
//   press Enter
//   wait for text "Saved"
//   expect url /dashboard
//   allow            (lets this chunk click delete / pay / send controls)
//   allow unchecked  (the same, and skips the Meta model's commit check)
//   task Book a table for 4 on July 20 at 7 PM   (what the commit check compares the page with)
//   optional click "Accept cookies"   (if it is not there, skip it and go on)
//   if text "Sold out": click "Notify me"   (run the step only when the page shows the text now)
// Blank lines and lines starting with # are ignored.

export type Target =
  | { kind: "ref"; ref: string }
  | { kind: "text"; text: string; role?: string; nth?: number };

export type Step =
  | { op: "goto"; url: string }
  | { op: "click" | "hover" | "check" | "uncheck"; target: Target }
  | { op: "fill" | "type" | "select"; target: Target; value: string }
  | { op: "press"; key: string; target?: Target }
  | { op: "wait"; ms: number }
  | { op: "wait for text" | "wait for gone"; text: string }
  | { op: "expect text" | "expect no text"; text: string }
  | { op: "expect url"; text: string }
  | { op: "expect value"; target: Target; value: string }
  | { op: "allow"; unchecked?: boolean }
  | { op: "task"; text: string };

// When an "if" step runs: the page shows the text now, does not show it, or the URL holds it.
export type Condition = { kind: "text" | "no text" | "url"; text: string };

export interface ParsedStep {
  line: number; // 1-based line in the chunk
  source: string;
  step: Step;
  optional?: boolean; // a step whose element or text is not there is skipped, not a STOP
  when?: Condition; // "if <condition>: <step>": the step runs only when the condition holds
}

export class ParseError extends Error {
  constructor(
    readonly line: number,
    message: string,
  ) {
    super(`line ${line}: ${message}`);
  }
}

// Splits on spaces, keeping "quoted strings" (with \" escapes) as one token.
export function tokenize(s: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === " " || s[i] === "\t") {
      i++;
      continue;
    }
    if (s[i] === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') j += s[j] === "\\" ? 2 : 1;
      out.push(s.slice(i, j + 1));
      i = j + 1;
      continue;
    }
    let j = i;
    while (j < s.length && s[j] !== " " && s[j] !== "\t") j++;
    out.push(s.slice(i, j));
    i = j;
  }
  return out;
}

const isQuoted = (t: string) => t.length >= 2 && t.startsWith('"') && t.endsWith('"');

function unquote(t: string): string {
  if (!isQuoted(t)) return t;
  try {
    return JSON.parse(t) as string;
  } catch {
    return t.slice(1, -1);
  }
}

// Finds " = " outside quotes; returns [left, right] or null.
function splitAssign(s: string): [string, string] | null {
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && inQuote) i++;
    else if (s[i] === '"') inQuote = !inQuote;
    else if (!inQuote && s[i] === "=" && s[i - 1] === " ") return [s.slice(0, i).trim(), s.slice(i + 1).trim()];
  }
  return null;
}

export function parseTarget(src: string, line: number): Target {
  const tokens = tokenize(src);
  if (tokens.length === 1 && /^@[a-z0-9]+$/i.test(tokens[0])) {
    return { kind: "ref", ref: tokens[0].slice(1) };
  }
  let nth: number | undefined;
  const last = tokens[tokens.length - 1];
  if (tokens.length > 1 && /^#\d+$/.test(last)) {
    nth = Number(last.slice(1));
    tokens.pop();
  }
  if (tokens.length === 1 && isQuoted(tokens[0])) return { kind: "text", text: unquote(tokens[0]), nth };
  if (tokens.length === 2 && /^[a-z]+$/.test(tokens[0]) && isQuoted(tokens[1])) {
    return { kind: "text", role: tokens[0], text: unquote(tokens[1]), nth };
  }
  throw new ParseError(line, `bad target "${src}": use @e12, "Label", or role "Name" (add #2 for the 2nd match)`);
}

function valueOf(src: string): string {
  return isQuoted(src) ? unquote(src) : src;
}

export function parseStep(source: string, line: number): Step {
  const m = /^(\S+)\s*(.*)$/.exec(source.trim());
  if (!m) throw new ParseError(line, "empty step");
  const verb = m[1].toLowerCase();
  const rest = m[2].trim();
  const need = (what: string) => {
    if (!rest) throw new ParseError(line, `${verb} needs ${what}`);
  };

  switch (verb) {
    case "goto":
    case "open":
      need("a url");
      return { op: "goto", url: valueOf(rest) };
    case "click":
    case "hover":
    case "check":
    case "uncheck":
      need("a target");
      return { op: verb, target: parseTarget(rest, line) };
    case "fill":
    case "type":
    case "select": {
      const parts = splitAssign(rest);
      if (!parts) throw new ParseError(line, `${verb} needs: ${verb} "Label" = value`);
      return { op: verb, target: parseTarget(parts[0], line), value: valueOf(parts[1]) };
    }
    case "press": {
      need("a key");
      const tokens = tokenize(rest);
      const key = tokens.pop()!;
      return tokens.length ? { op: "press", key, target: parseTarget(tokens.join(" "), line) } : { op: "press", key };
    }
    case "wait": {
      const ms = /^(\d+)\s*(ms|s)?$/.exec(rest);
      if (ms) return { op: "wait", ms: Number(ms[1]) * (ms[2] === "s" ? 1000 : 1) };
      const w = /^for\s+(text|gone)\s+(.+)$/.exec(rest);
      if (!w) throw new ParseError(line, 'wait needs: wait 500ms | wait for text "X" | wait for gone "X"');
      return { op: w[1] === "text" ? "wait for text" : "wait for gone", text: valueOf(w[2].trim()) };
    }
    case "expect": {
      const e = /^(no\s+text|text|url|value)\s+(.+)$/.exec(rest);
      if (!e) throw new ParseError(line, 'expect needs: text "X" | no text "X" | url /path | value "Label" = v');
      const kind = e[1].replace(/\s+/, " ");
      if (kind === "value") {
        const parts = splitAssign(e[2]);
        if (!parts) throw new ParseError(line, 'expect value needs: expect value "Label" = v');
        return { op: "expect value", target: parseTarget(parts[0], line), value: valueOf(parts[1]) };
      }
      const op = kind === "no text" ? "expect no text" : kind === "url" ? "expect url" : "expect text";
      return { op, text: valueOf(e[2].trim()) };
    }
    case "allow":
      if (rest && rest.toLowerCase() !== "unchecked") throw new ParseError(line, 'allow takes nothing after it, or "unchecked"');
      return rest ? { op: "allow", unchecked: true } : { op: "allow" };
    case "task":
      need("the task text");
      return { op: "task", text: valueOf(rest) };
    default:
      throw new ParseError(line, `unknown step "${verb}"`);
  }
}

// The first ":" outside quotes that ends the condition (a space or the line end after
// it, so "https://" in a URL condition does not count): [condition, step] or null.
function splitCondition(s: string): [string, string] | null {
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && inQuote) i++;
    else if (s[i] === '"') inQuote = !inQuote;
    else if (!inQuote && s[i] === ":" && (i + 1 === s.length || /\s/.test(s[i + 1]))) return [s.slice(0, i).trim(), s.slice(i + 1).trim()];
  }
  return null;
}

const IF_USAGE = 'if needs: if text "X": <step> | if no text "X": <step> | if url /path: <step>';

// One line: an optional "if <condition>:", then an optional "optional", then the step.
// Settings (allow, task) always apply to the whole run: they take neither.
export function parseLine(source: string, line: number): Omit<ParsedStep, "line" | "source"> {
  let rest = source.trim();
  let when: Condition | undefined;
  const cond = /^if\s+(.*)$/i.exec(rest);
  if (cond || /^if$/i.test(rest)) {
    const parts = cond && splitCondition(cond[1]);
    if (!parts || !parts[1]) throw new ParseError(line, IF_USAGE);
    const c = /^(no\s+text|text|url)\s+(.+)$/i.exec(parts[0]);
    if (!c) throw new ParseError(line, IF_USAGE);
    const kind = c[1].toLowerCase().replace(/\s+/, " ") as Condition["kind"];
    when = { kind, text: valueOf(c[2].trim()) };
    if (!when.text) throw new ParseError(line, IF_USAGE);
    rest = parts[1];
  }
  const opt = /^optional(?:\s+(.*))?$/i.exec(rest);
  if (opt && !opt[1]) throw new ParseError(line, "optional needs a step: optional click \"X\"");
  if (opt) rest = opt[1].trim();
  if (/^(if|optional)(\s|$)/i.test(rest)) throw new ParseError(line, 'use at most one "if ...:" and one "optional", in that order');
  const step = parseStep(rest, line);
  if ((when || opt) && (step.op === "allow" || step.op === "task")) {
    throw new ParseError(line, `${step.op} is for the whole run: it takes no "if" or "optional"`);
  }
  return { step, ...(opt ? { optional: true } : {}), ...(when ? { when } : {}) };
}

export function parseChunk(text: string): ParsedStep[] {
  const steps: ParsedStep[] = [];
  text.split("\n").forEach((raw, i) => {
    const source = raw.trim();
    if (!source || source.startsWith("#")) return;
    steps.push({ line: i + 1, source, ...parseLine(source, i + 1) });
  });
  return steps;
}
