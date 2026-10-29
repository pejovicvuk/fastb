import { test } from "node:test";
import assert from "node:assert/strict";
import { donePrompt, doneLine, doneOutcome, finalClick, keepActions, lanesDoneText, logLine, MAX_ACTIONS } from "./done.ts";
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
  assert.match(doneLine({ status: "no_proof", reason: "" }), /^NO PROOF: this page does not show the result\. If a link on this page opens the result/);
});

test("the final click: only click lines with a page label, final words only, no form step after it", () => {
  assert.equal(finalClick(['click @e1  [clicked: Checkout | Checkout $26.07]']), null);
  assert.equal(finalClick(['click @e1  [clicked: Add to cart]', 'click @e2  [clicked: Place Order]', 'goto https://x.com/']), "place order");
  assert.equal(finalClick(['click @e1  [clicked: Delete]', 'click @e9  [clicked: Close]']), "delete");
  assert.equal(finalClick(['click @e1  [clicked: Book]']), null); // often opens the booking form
  assert.equal(finalClick(['click @e1  [clicked: Confirm booking]', 'fill "Phone" = 555']), null); // a form after it: not final
  assert.equal(finalClick(['fill "Body" = Notes  [clicked: Send]']), null); // a typed value is not a click
  assert.equal(finalClick(['click "x  [clicked: Send]"']), null); // no label from the page
  assert.equal(finalClick([]), null);
});

test("no proof after the final click is likely done; a rejection or no final click stays", () => {
  const log = ['click @e2  [clicked: Pay from account 123456789]'];
  const likely = doneOutcome({ status: "no_proof", reason: "need order history page" }, log);
  assert.equal(likely.status, "likely_done");
  assert.equal(likely.line, 'LIKELY DONE: a "pay" click ran and no error shows; this page does not show: need order history page. Answer DONE unless you see a problem. Do not search other pages for proof');
  assert.doesNotMatch(likely.line, /123456789/);
  assert.equal(doneOutcome({ status: "no_proof", reason: "no proof of: payment", strict: true }, log).status, "no_proof"); // the model's own unmet item
  assert.equal(doneOutcome({ status: "no_proof", reason: "x" }, ['click @e1  [clicked: Next]']).status, "no_proof");
  assert.equal(doneOutcome({ status: "not_done", reason: "phone invalid" }, log).status, "not_done"); // a clear miss stays a miss
  assert.equal(doneOutcome({ status: "done", reason: "ok" }, log).line, "DONE: ok");
});

test("lanes: a count line, then one line per lane", () => {
  const text = lanesDoneText(
    [
      { name: "a", line: "DONE: booked", status: "done" },
      { name: "b", line: "NOT DONE: date is July 19", status: "not_done" },
      { name: "c", line: "done: no task" },
      { name: "d", line: "LIKELY DONE: x", status: "likely_done" },
    ],
    1500,
  );
  assert.equal(text, ["done check (1.5s): 1 done, 1 likely done, 1 not done, 0 no proof, 1 not checked", "[a] DONE: booked", "[b] NOT DONE: date is July 19", "[c] done: no task", "[d] LIKELY DONE: x"].join("\n"));
});
