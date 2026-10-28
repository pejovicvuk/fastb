import { test } from "node:test";
import assert from "node:assert/strict";
import { combineLanes, parseLanes } from "./lanes.ts";
import { parseChunk, ParseError } from "./parse.ts";

test("splits lanes and keeps their steps", () => {
  const lanes = parseLanes('# two carts\nlane us\ngoto shop.com\nclick "Buy"\n\nlane eu\ngoto shop.com/de\n');
  assert.deepEqual(lanes.map((l) => l.name), ["us", "eu"]);
  assert.deepEqual(parseChunk(lanes[0].text).map((s) => s.source), ["goto shop.com", 'click "Buy"']);
  assert.deepEqual(parseChunk(lanes[1].text).map((s) => s.source), ["goto shop.com/de"]);
});

test("rejects steps before a lane, bad and repeated names", () => {
  assert.throws(() => parseLanes("goto x.com\nlane a\n"), (e: unknown) => e instanceof ParseError && e.line === 1);
  assert.throws(() => parseLanes("lane a b\n"), ParseError);
  assert.throws(() => parseLanes("lane a/b\ngoto x\n"), /bad lane name/);
  assert.throws(() => parseLanes("lane a\ngoto x\nlane a\ngoto y\n"), /appears twice/);
});

test("combines lane reports and cuts long ones", () => {
  const text = combineLanes(
    [
      { name: "a", ok: true, text: "OK 2/2 steps 1.0s\npage: A | a.com" },
      { name: "b", ok: false, text: ["STOP at step 1/1: click \"Pay\"", "x", "y", "z"].join("\n") },
    ],
    2300,
    2,
  );
  assert.equal(
    text,
    [
      "lanes: 1 ok, 1 stopped, 2.3s",
      "[a] OK 2/2 steps 1.0s",
      "page: A | a.com",
      '[b] STOP at step 1/1: click "Pay"',
      "x",
      "... 2 more lines: fastb look --lane b",
    ].join("\n"),
  );
});
