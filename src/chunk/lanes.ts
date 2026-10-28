// Lanes: several chunks in one input, each run in its own isolated browser at the same time.
//   lane checkout-us
//   goto https://shop.example/cart
//   click "Checkout"
//   lane checkout-eu
//   goto https://shop.example/cart?country=de
// Blank lines and "#" comments are ignored. A lane name: letters, digits, "-" and "_".

import { ParseError } from "./parse.ts";

export interface LaneBlock {
  name: string;
  text: string; // the lane's chunk, with blank lines kept so step line numbers stay right
  line: number; // 1-based line of the "lane" header
}

const HEADER = /^lane\s+(\S+)\s*$/i;
const NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/i;

export function parseLanes(input: string): LaneBlock[] {
  const blocks: LaneBlock[] = [];
  const lines = input.split("\n");
  lines.forEach((raw, i) => {
    const line = raw.trim();
    const m = HEADER.exec(line);
    if (m) {
      if (!NAME.test(m[1])) throw new ParseError(i + 1, `bad lane name "${m[1]}": use letters, digits, - and _`);
      if (blocks.some((b) => b.name === m[1])) throw new ParseError(i + 1, `lane "${m[1]}" appears twice`);
      blocks.push({ name: m[1], text: "", line: i + 1 });
      return;
    }
    if (!line || line.startsWith("#")) {
      if (blocks.length) blocks[blocks.length - 1].text += "\n";
      return;
    }
    if (!blocks.length) throw new ParseError(i + 1, 'steps before the first "lane <name>" line');
    blocks[blocks.length - 1].text += raw + "\n";
  });
  return blocks;
}

export interface LaneResult {
  name: string;
  ok: boolean;
  text: string; // the lane's own report (OK/STOP line, then its page or changes)
}

// One line for all lanes, then each lane's report with its name in front.
// A lane's report is cut at `maxLines` so many lanes stay readable.
export function combineLanes(results: LaneResult[], ms: number, maxLines = 40): string {
  const stopped = results.filter((r) => !r.ok).length;
  const head = `lanes: ${results.length - stopped} ok, ${stopped} stopped, ${(ms / 1000).toFixed(1)}s`;
  const parts = results.map((r) => {
    const lines = r.text.split("\n");
    const shown = lines.slice(0, maxLines);
    if (lines.length > maxLines) shown.push(`... ${lines.length - maxLines} more lines: fastb look --lane ${r.name}`);
    return `[${r.name}] ${shown.join("\n")}`;
  });
  return [head, ...parts].join("\n");
}
