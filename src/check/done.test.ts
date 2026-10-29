import { test } from "node:test";
import assert from "node:assert/strict";
import { donePrompt, doneLine, keepActions, lanesDoneText, logLine, MAX_ACTIONS } from "./done.ts";
import { parseChunk } from "../chunk/parse.ts";

test("the log is built from parsed steps: settings dropped, clicks named, secret values hidden", () => {
  const steps = parseChunk(['task send a mail', "allow", "# note", 'click @e44', 'fill "Subject" = Hi', 'fill "Password" = pa"ss', 'expect value "PIN" = 1234', 'type @e9 = s3cret'].join("\n"));
  const lines = steps.map((s, i) => logLine(s.step, i === 2 ? "Send" : undefined, i === 6));
  assert.deepEqual(keepActions([], lines), ['click @e44  [clicked: Send]', 'fill "Subject" = Hi', 'fill "Password" = [hidden]', 'expect value "PIN" = [hidden]', "type @e9 = [hidden]"]);
  const many = Array.from({ length: MAX_ACTIONS + 5 }, (_, i) => `click "b${i}"`);
  const kept = keepActions([], many);
  assert.equal(kept.length, MAX_ACTIONS);
  assert.equal(kept.at(-1), `click "b${MAX_ACTIONS + 4}"`);
});

test("the done prompt hides private values in the task, the steps and the page", () => {
  const text = donePrompt(
    "Send a mail to jonathan.smith@example.com, pay with card 4242 4242 4242 4242",
    ['fill "To" = jonathan.smith@example.com', 'fill "Password" = hunter2pass', 'fill "Note" = call ana@private.com', "goto https://mail.com/sent?session=abc"],
    { title: "Sent", url: "https://mail.com/sent?x=1", fields: [{ label: "Password", value: "hunter2pass", kind: "text" }], text: "Sent to jonathan.smith@example.com" },
    ["hunter2pass"],
  );
  assert.match(text, /jonathan\.smith@example\.com/); // the task names it: it stays
  assert.doesNotMatch(text, /4242/);
  assert.doesNotMatch(text, /hunter2pass/);
  assert.doesNotMatch(text, /ana@private\.com/);
  assert.doesNotMatch(text, /session=abc|x=1/);
  assert.match(text, /Steps the browser ran:\n1\. fill "To"/);
});

test("no steps is said plainly", () => {
  const text = donePrompt("Send a mail", [], { title: "Inbox", url: "https://m.com/", fields: [], text: "" });
  assert.match(text, /\(no steps ran\)/);
});

test("each verdict becomes one line that tells the agent what to do", () => {
  assert.equal(doneLine({ status: "done", reason: "Send was clicked, inbox shows no draft" }), "DONE: Send was clicked, inbox shows no draft");
  assert.equal(doneLine({ status: "not_done", reason: "the mail was written but never sent" }), "NOT DONE: the mail was written but never sent. Fix it, then run fastb done again");
  assert.match(doneLine({ status: "no_proof", reason: "" }), /^NO PROOF: this page does not show the result\. Open the page/);
});

test("lanes: a count line, then one line per lane", () => {
  const text = lanesDoneText(
    [
      { name: "a", line: "DONE: booked", status: "done" },
      { name: "b", line: "NOT DONE: date is July 19", status: "not_done" },
      { name: "c", line: "done: no task" },
    ],
    1500,
  );
  assert.equal(text, ["done check (1.5s): 1 done, 1 not done, 0 no proof, 1 not checked", "[a] DONE: booked", "[b] NOT DONE: date is July 19", "[c] done: no task"].join("\n"));
});
