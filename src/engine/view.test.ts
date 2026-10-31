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

test("skipped steps are named after the step result", async () => {
  const skipped = [
    { index: 0, source: 'optional click "Accept cookies"', reason: "not found within 5s" },
    { index: 2, source: 'if text "Sold out": click "Notify me"', reason: "condition not met" },
  ];
  const r = await runReport({ ok: true, done: 3, total: 3, ms: 500, skipped }, async () => ({ text: "page: x" }));
  assert.deepEqual(r.text.split("\n"), [
    "OK 3/3 steps 0.5s",
    'skipped step 1: optional click "Accept cookies" (not found within 5s)',
    'skipped step 3: if text "Sold out": click "Notify me" (condition not met)',
    "page: x",
  ]);
});

test("a page read that never answers does not hold the step result", async () => {
  const r = await runReport({ ok: true, done: 1, total: 1, ms: 100 }, () => new Promise(() => {}), 50);
  assert.equal(r.text, "OK 1/1 steps 0.1s\npage: could not read it (no answer in 0s, the page may still be loading). Run fastb look.");
});
