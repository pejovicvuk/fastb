import { test } from "node:test";
import assert from "node:assert/strict";
import { parseChunk, parseStep, ParseError, tokenize } from "./parse.ts";

test("tokenize keeps quoted strings with escapes together", () => {
  assert.deepEqual(tokenize('click button "Say \\"hi\\" now" #2'), ["click", "button", '"Say \\"hi\\" now"', "#2"]);
});

test("parses the main step kinds", () => {
  assert.deepEqual(parseStep("goto https://x.com/a", 1), { op: "goto", url: "https://x.com/a" });
  assert.deepEqual(parseStep("click @e23", 1), { op: "click", target: { kind: "ref", ref: "e23" } });
  assert.deepEqual(parseStep("click @f1e133", 1), { op: "click", target: { kind: "ref", ref: "f1e133" } });
  assert.deepEqual(parseStep('click button "Create account"', 1), {
    op: "click",
    target: { kind: "text", role: "button", text: "Create account", nth: undefined },
  });
  assert.deepEqual(parseStep('click "Add" #3', 1), { op: "click", target: { kind: "text", text: "Add", nth: 3 } });
  assert.deepEqual(parseStep('fill "Email" = test@x.com', 1), {
    op: "fill",
    target: { kind: "text", text: "Email", nth: undefined },
    value: "test@x.com",
  });
  assert.deepEqual(parseStep('select "Size" = "Medium (12 in)"', 1), {
    op: "select",
    target: { kind: "text", text: "Size", nth: undefined },
    value: "Medium (12 in)",
  });
  assert.deepEqual(parseStep("press Enter", 1), { op: "press", key: "Enter" });
  assert.deepEqual(parseStep('press "Search" Enter', 1), {
    op: "press",
    key: "Enter",
    target: { kind: "text", text: "Search", nth: undefined },
  });
});

test("parses waits and expects", () => {
  assert.deepEqual(parseStep("wait 500ms", 1), { op: "wait", ms: 500 });
  assert.deepEqual(parseStep("wait 2s", 1), { op: "wait", ms: 2000 });
  assert.deepEqual(parseStep('wait for text "Saved"', 1), { op: "wait for text", text: "Saved" });
  assert.deepEqual(parseStep('wait for gone "Loading"', 1), { op: "wait for gone", text: "Loading" });
  assert.deepEqual(parseStep('expect text "Welcome"', 1), { op: "expect text", text: "Welcome" });
  assert.deepEqual(parseStep('expect no text "Error"', 1), { op: "expect no text", text: "Error" });
  assert.deepEqual(parseStep("expect url /dashboard", 1), { op: "expect url", text: "/dashboard" });
  assert.deepEqual(parseStep('expect value "Qty" = 2', 1), {
    op: "expect value",
    target: { kind: "text", text: "Qty", nth: undefined },
    value: "2",
  });
});

test("an = inside quotes is not the assignment", () => {
  assert.deepEqual(parseStep('fill "a = b" = c', 1), {
    op: "fill",
    target: { kind: "text", text: "a = b", nth: undefined },
    value: "c",
  });
});

test("skips blank lines and comments, keeps line numbers", () => {
  const steps = parseChunk('\n# setup\ngoto x.com\n\nclick "Go"\n');
  assert.deepEqual(
    steps.map((s) => [s.line, s.step.op]),
    [
      [3, "goto"],
      [5, "click"],
    ],
  );
});

test("reports bad lines with their number", () => {
  assert.throws(() => parseChunk('goto x.com\nclick Save'), (e: unknown) => e instanceof ParseError && e.line === 2);
  assert.throws(() => parseChunk("dance now"), /unknown step "dance"/);
  assert.throws(() => parseChunk('fill "Email"'), /fill needs/);
});

test("allow is a step with nothing after it, or unchecked", () => {
  assert.deepEqual(parseStep("allow", 1), { op: "allow" });
  assert.deepEqual(parseStep("allow unchecked", 1), { op: "allow", unchecked: true });
  assert.throws(() => parseStep("allow send", 1), /allow takes nothing/);
});

test("task keeps the whole text", () => {
  assert.deepEqual(parseStep('task Book "The Royal Dine" for 4 = July 20', 1), { op: "task", text: 'Book "The Royal Dine" for 4 = July 20' });
  assert.throws(() => parseStep("task", 1), /task needs/);
});

test("optional and if wrap one step", () => {
  const [a, b, c, d] = parseChunk(
    'optional click "Accept cookies"\nif text "Sold out": click "Notify me"\nif no text "Error: x": optional expect text "Saved"\nif url https://x.com/cart: click @e4',
  );
  assert.deepEqual({ step: a.step, optional: a.optional, when: a.when }, { step: { op: "click", target: { kind: "text", text: "Accept cookies", nth: undefined } }, optional: true, when: undefined });
  assert.deepEqual(b.when, { kind: "text", text: "Sold out" });
  assert.equal(b.optional, undefined);
  assert.deepEqual(b.step, { op: "click", target: { kind: "text", text: "Notify me", nth: undefined } });
  assert.deepEqual(c.when, { kind: "no text", text: "Error: x" }); // a ":" inside quotes is part of the text
  assert.equal(c.optional, true);
  assert.deepEqual(d.when, { kind: "url", text: "https://x.com/cart" }); // "https://" does not end the condition
  assert.deepEqual(d.step, { op: "click", target: { kind: "ref", ref: "e4" } });
});

test("optional and if: bad forms are parse errors", () => {
  for (const bad of [
    "optional",
    'if text "X" click "Y"', // no ":"
    'if text "X":',
    'if title "X": click "Y"',
    'optional if text "X": click "Y"', // order is if, then optional
    'if text "X": if text "Y": click "Z"',
    "optional optional click @e1",
    "optional allow",
    'if text "X": allow',
    "optional task Book a table",
  ]) {
    assert.throws(() => parseChunk(bad), ParseError, bad);
  }
});
