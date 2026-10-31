import { test } from "node:test";
import assert from "node:assert/strict";
import { dialogAnswer, newTag } from "./dialogs.ts";

const tag = newTag();
const armed = { kind: "confirm" as const, tag };

test("a confirm is accepted only during an allowed risky click", () => {
  assert.deepEqual(dialogAnswer("confirm", tag + "Delete 3 mails?", armed), { accept: true, note: `dialog: confirm "Delete 3 mails?" accepted (it came from the allowed click)` });
  assert.equal(dialogAnswer("confirm", tag + "Delete 3 mails?", { kind: "leave" }).accept, false);
  // no tag (a timer's confirm), or another click's tag: dismissed, and the tag never shows
  assert.equal(dialogAnswer("confirm", "Delete 3 mails?", armed).accept, false);
  const other = dialogAnswer("confirm", newTag() + "Delete 3 mails?", armed);
  assert.equal(other.accept, false);
  assert.match(other.note, /^dialog: confirm "Delete 3 mails\?" dismissed/);
  const no = dialogAnswer("confirm", "Delete 3 mails?");
  assert.equal(no.accept, false);
  assert.match(no.note, /^dialog: confirm "Delete 3 mails\?" dismissed/);
});

test("alerts close, prompts are dismissed, leave-page warnings are accepted only for a goto", () => {
  assert.equal(dialogAnswer("alert", "Saved").accept, true);
  assert.equal(dialogAnswer("prompt", tag + "Your name?", armed).accept, false);
  assert.equal(dialogAnswer("beforeunload", "", { kind: "leave" }).accept, true);
  assert.equal(dialogAnswer("beforeunload", tag, armed).accept, false);
  assert.match(dialogAnswer("beforeunload", "").note, /dismissed, the page stays/);
});

test("dialog text is one short line with no double quotes", () => {
  const note = dialogAnswer("alert", `Line one\n  "two" ${"x".repeat(300)}`).note;
  assert.ok(!note.includes("\n"));
  assert.match(note, /^dialog: alert "Line one 'two' x+" closed$/);
  assert.ok(note.length < 140);
});
