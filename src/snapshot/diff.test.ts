import { test } from "node:test";
import assert from "node:assert/strict";
import { diffPage } from "./diff.ts";

test("no change gives no lines", () => {
  const page = ['@e1 textbox "Email"', '@e2 button "Save"'];
  assert.deepEqual(diffPage(page, page), { added: 0, removed: 0, changed: 0, lines: [] });
});

test("added and removed lines", () => {
  const d = diffPage(["# Inbox", "3 messages", '@e2 button "Compose"'], ["# Inbox", '@e2 button "Compose"', "Draft saved"]);
  assert.deepEqual(d.lines, ["- 3 messages", "+ Draft saved"]);
  assert.equal(d.added, 1);
  assert.equal(d.removed, 1);
});

test("same ref with a new value is one changed line", () => {
  const d = diffPage(['@e5 textbox "To"', '@e6 button "Send"'], ['@e5 textbox "To" = "bob@x.com"', '@e6 button "Send"']);
  assert.deepEqual(d.lines, ['~ @e5 textbox "To" = "bob@x.com"']);
  assert.equal(d.changed, 1);
  assert.equal(d.added + d.removed, 0);
});

test("keeps the section headers above a change as context", () => {
  const before = ["navigation:", '  @e1 link "Home"', "main:", '  dialog "Compose":', '    @e5 textbox "To"', "footer text"];
  const after = ["navigation:", '  @e1 link "Home"', "main:", '  dialog "Compose":', '    @e5 textbox "To"', '    @e9 button "Send"', "footer text"];
  assert.deepEqual(diffPage(before, after).lines, ["  main:", '    dialog "Compose":', '+     @e9 button "Send"']);
});

test("a new dialog shows its own header once", () => {
  const before = ["main:", '  @e1 button "Open"'];
  const after = ["main:", '  @e1 button "Open"', '  dialog "Confirm":', '    @e7 button "OK"'];
  assert.deepEqual(diffPage(before, after).lines, ["  main:", '+   dialog "Confirm":', '+     @e7 button "OK"']);
});

test("removed lines use the old page's headers", () => {
  const before = ['dialog "Compose":', '  @e5 textbox "To"', "main:", '  @e1 button "Open"'];
  const after = ["main:", '  @e1 button "Open"'];
  assert.deepEqual(diffPage(before, after).lines, ['- dialog "Compose":', '-   @e5 textbox "To"']);
});
