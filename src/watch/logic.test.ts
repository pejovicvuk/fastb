import assert from "node:assert/strict";
import { test } from "node:test";
import { diffLanePages, safeStep, shouldForwardFrame, sseMessage } from "./logic.ts";

test("throttle accepts the first frame and the 200 ms boundary", () => {
  assert.equal(shouldForwardFrame(undefined, 0), true);
  assert.equal(shouldForwardFrame(0, 0), false);
  assert.equal(shouldForwardFrame(0, 199.99), false);
  assert.equal(shouldForwardFrame(0, 200), true);
  assert.equal(shouldForwardFrame(200, 399), false);
  assert.equal(shouldForwardFrame(200, 400), true);
});

test("throttle drops extra frames instead of accumulating work", () => {
  let lastSent: number | undefined;
  const accepted: number[] = [];
  for (let now = 0; now < 1_000; now += 10) {
    if (shouldForwardFrame(lastSent, now)) {
      accepted.push(now);
      lastSent = now;
    }
  }
  assert.deepEqual(accepted, [0, 200, 400, 600, 800]);
});

test("SSE has a named event, one JSON data line, and a blank terminator", () => {
  const lanes = [{ name: 'lane\n"one"', state: "running", step: "click\r\nCheckout" }];
  const message = sseMessage("lanes", lanes);
  assert.equal(message, `event: lanes\ndata: ${JSON.stringify(lanes)}\n\n`);
  assert.equal(message.split("\n").length, 4);
  assert.deepEqual(JSON.parse(message.split("\n")[1].slice(6)), lanes);
  assert.equal(sseMessage("frame", { lane: "one", jpegBase64: "/9j/" }),
    'event: frame\ndata: {"lane":"one","jpegBase64":"/9j/"}\n\n');
});

test("lane diff starts new lanes, stops removed lanes, and leaves stable pages alone", () => {
  const first = {}, second = {}, third = {};
  const current = new Map([["first", first], ["second", second]]);
  const desired = new Map([["second", second], ["third", third]]);
  assert.deepEqual(diffLanePages(current, desired), { stop: ["first"], start: ["third"] });
  assert.deepEqual([...current.keys()], ["first", "second"]);
  assert.deepEqual(diffLanePages(desired, desired), { stop: [], start: [] });
});

test("a replaced page or renamed lane requires a new screencast", () => {
  const oldPage = {}, newPage = {};
  assert.deepEqual(diffLanePages(new Map([["lane", oldPage]]), new Map([["lane", newPage]])),
    { stop: ["lane"], start: ["lane"] });
  assert.deepEqual(diffLanePages(new Map([["old", oldPage]]), new Map([["new", oldPage]])),
    { stop: ["old"], start: ["new"] });
});

test("no desired pages stops all captures, including when the last viewer leaves", () => {
  assert.deepEqual(diffLanePages(new Map([["a", {}], ["b", {}]]), new Map()),
    { stop: ["a", "b"], start: [] });
});

test("the grid hides what is typed into fields", () => {
  assert.equal(safeStep('fill "Card number" = 4242 4242 4242 4242'), 'fill "Card number" = •••');
  assert.equal(safeStep("type @e41 = secret"), "type @e41 = •••");
  assert.equal(safeStep('select "Size" = Medium'), 'select "Size" = Medium');
  assert.equal(safeStep('click "Pay"'), 'click "Pay"');
  assert.equal(safeStep(undefined), undefined);
});
