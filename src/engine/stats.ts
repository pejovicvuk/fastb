import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { STATS } from "../paths.ts";

// One line per command in ~/.fastb/stats.jsonl. Local only: no page text, no urls.
export interface StatRow {
  t: string; // ISO time
  cmd: string;
  ok: boolean;
  ms: number;
  out: number; // characters sent back to the agent
  steps?: number; // run: steps in the chunk
  done?: number; // run: steps that passed
  full?: number; // run: characters the full page would have been (when only changes were sent)
}

export function appendStat(row: StatRow): void {
  try {
    appendFileSync(STATS, JSON.stringify(row) + "\n");
  } catch (err) {
    console.error(`stats: ${String(err)}`);
  }
}

export function readStats(): StatRow[] {
  if (!existsSync(STATS)) return [];
  return readFileSync(STATS, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as StatRow];
      } catch {
        return [];
      }
    });
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const pct = (part: number, whole: number) => (whole ? `${Math.round((100 * part) / whole)}%` : "-");

export function summarize(rows: StatRow[]): string {
  if (!rows.length) return "stats: nothing recorded yet";
  const runs = rows.filter((r) => r.cmd === "run");
  const steps = runs.reduce((n, r) => n + (r.steps ?? 0), 0);
  const count = (cmd: string) => rows.filter((r) => r.cmd === cmd).length;
  const lines = [
    `stats: ${rows.length} commands since ${rows[0].t.slice(0, 10)}`,
    `runs: ${runs.length}, ${steps} steps (${runs.length ? (steps / runs.length).toFixed(1) : 0} per run), ` +
      `ok ${runs.filter((r) => r.ok).length}/${runs.length}, median ${secs(median(runs.map((r) => r.ms)))}`,
    `open: ${count("open")}, look: ${count("look")}`,
    `sent to the agent: ${rows.reduce((n, r) => n + r.out, 0).toLocaleString("en-US")} chars`,
  ];
  const diffed = runs.filter((r) => r.full !== undefined);
  if (diffed.length) {
    const full = diffed.reduce((n, r) => n + (r.full ?? 0), 0);
    const sent = diffed.reduce((n, r) => n + r.out, 0);
    lines.push(`changes only: ${diffed.length} runs sent ${pct(sent, full)} of the full page (${pct(full - sent, full)} saved)`);
  }
  return lines.join("\n");
}
