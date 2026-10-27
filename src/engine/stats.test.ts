import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize, type StatRow } from "./stats.ts";

test("empty log", () => {
  assert.equal(summarize([]), "stats: nothing recorded yet");
});

test("sums runs, steps and chars saved by diffs", () => {
  const t = "2026-10-27T10:00:00.000Z";
  const rows: StatRow[] = [
    { t, cmd: "open", ok: true, ms: 900, out: 1000 },
    { t, cmd: "run", ok: true, ms: 800, out: 200, steps: 6, done: 6, full: 1000 },
    { t, cmd: "run", ok: false, ms: 1200, out: 300, steps: 4, done: 2, full: 1000 },
    { t, cmd: "run", ok: true, ms: 1000, out: 900, steps: 2, done: 2 },
  ];
  assert.equal(
    summarize(rows),
    [
      "stats: 4 commands since 2026-10-27",
      "runs: 3, 12 steps (4.0 per run), ok 2/3, median 1.0s",
      "open: 1, look: 0",
      "sent to the agent: 2,400 chars",
      "changes only: 2 runs sent 25% of the full page (75% saved)",
    ].join("\n"),
  );
});
