import { test } from "node:test";
import assert from "node:assert/strict";
import { runReport } from "./view.ts";

const broken = async () => {
  throw new Error("Timeout 10000ms exceeded\ncall log ...");
};

test("a failed page read keeps the step result", async () => {
  const r = await runReport({ ok: true, done: 2, total: 2, ms: 900 }, broken);
  assert.equal(r.text, "OK 2/2 steps 0.9s\npage: could not read it (Timeout 10000ms exceeded). Run fastb look.");
});

test("a failed page read after a stop keeps the steps done", async () => {
  const failure = { index: 2, source: 'click "Pay"', reason: "it is disabled" };
  const r = await runReport({ ok: false, done: 2, total: 4, ms: 1200, failure }, broken);
  assert.deepEqual(r.text.split("\n").slice(0, 3), ['STOP at step 3/4: click "Pay"', "reason: it is disabled", "done: steps 1-2 in 1.2s"]);
  assert.match(r.text, /could not read it/);
});
