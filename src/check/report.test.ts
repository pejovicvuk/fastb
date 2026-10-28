import { test } from "node:test";
import assert from "node:assert/strict";
import { formatReport, reportInput, type LaneOutcome } from "./report.ts";
import type { FailCode } from "../chunk/run.ts";
import { parseStep } from "../chunk/parse.ts";

test("report lists ok lanes, then stop groups from biggest", () => {
  const text = formatReport(
    [
      { outcome: "stopped", cause: 'button "Pay" is disabled', lanes: ["eu"] },
      { outcome: "ok", cause: "", lanes: ["us", "uk"] },
      { outcome: "stopped", cause: "coupon field refuses lowercase codes", lanes: ["c1", "c2", "c3"] },
    ],
    2100,
  );
  assert.equal(
    text,
    [
      "report (2.1s): 2 ok, 4 stopped",
      "ok: us uk",
      "stopped (3), coupon field refuses lowercase codes: c1 c2 c3",
      'stopped (1), button "Pay" is disabled: eu',
    ].join("\n"),
  );
});

const stop = (source: string, code: FailCode, checkReason?: string, total = 3): LaneOutcome => ({
  ok: false, done: 1, total, stop: { index: 1, step: parseStep(source, 1), code, checkReason },
});

test("report input is built from outcomes: step kind and target, a fixed reason, never values", () => {
  const text = reportInput([
    { name: "a", outcome: stop('fill "Password" = syntheticPass9', "not-found") },
    { name: "b", outcome: stop("fill @e5 =syntheticPass8", "disabled") },
    { name: "c", outcome: stop("expect value @e5 = expectedPass1", "value-differs") },
    { name: "d", outcome: stop("goto https://x.com/reset?token=abc123", "timeout") },
    { name: "e", outcome: stop('expect text "Recovery phrase: amber birch cedar"', "text-missing") },
    { name: "f", outcome: stop('click "Pay"', "check-mismatch", 'date is "Jul 19", task wants "July 20"') },
    { name: "g", outcome: { ok: true, done: 2, total: 2 } },
  ]);
  for (const secret of ["syntheticPass9", "syntheticPass8", "expectedPass1", "abc123", "token", "amber", "Recovery"]) {
    assert.equal(text.includes(secret), false, `${secret} leaked:\n${text}`);
  }
  assert.equal(
    text,
    [
      "## lane a", 'STOP at step 2/3: fill "Password"', "reason: target not found", "",
      "## lane b", "STOP at step 2/3: fill @e5", "reason: target is disabled", "",
      "## lane c", "STOP at step 2/3: expect value @e5", "reason: field value differs from the expected one", "",
      "## lane d", "STOP at step 2/3: goto https://x.com", "reason: action timed out", "",
      "## lane e", "STOP at step 2/3: expect text", "reason: expected text not on the page", "",
      "## lane f", 'STOP at step 2/3: click "Pay"', 'reason: check: date is "Jul 19", task wants "July 20"', "",
      "## lane g", "OK 2/2",
    ].join("\n"),
  );
});
