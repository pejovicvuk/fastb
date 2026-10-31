import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright-core";
import { parseChunk } from "./parse.ts";
import { runChunk, type RunHooks } from "./run.ts";
import { dialogAnswer, type Arm } from "../browser/dialogs.ts";
import { changedFields, readEvidence } from "../check/commit.ts";
import { seenLine, showPage } from "../engine/view.ts";

// Runs chunks in a real headless Chrome. Skipped when Chrome is not installed.
let browser: Browser | undefined;
let page: Page;

before(async () => {
  browser = await chromium.launch({ channel: "chrome", headless: true }).catch(() => undefined);
  if (browser) page = await browser.newPage();
});
after(async () => browser?.close());

// The ref on the line that holds `text` (or, with `parent`, on the line above it).
async function refOf(p: Page, text: string, parent = false): Promise<string> {
  const snap = await p.ariaSnapshot({ mode: "ai" });
  const lines = snap.split("\n");
  const at = lines.findIndex((l) => l.includes(text));
  const line = lines[parent ? at - 1 : at];
  const ref = line && /\[ref=(\w+)\]/.exec(line)?.[1];
  assert.ok(ref, `no ref for ${text} in:\n${snap}`);
  return ref;
}

const run = (chunk: string) => runChunk(async () => page, parseChunk(chunk));

const ICONS = `
  <span id="lbl" hidden>Send</span>
  <button id="b1" aria-labelledby="lbl" onclick="document.title='sent'">✉</button>
  <button id="b2" onclick="document.title='deleted'"><img alt="Delete" src="data:,"></button>
  <img id="trash" alt="Remove" src="data:,">
  <button id="b3" aria-labelledby="trash" onclick="document.title='removed'">🗑</button>
  <span id="l4" title="Action">Delete</span>
  <button id="b4" aria-labelledby="l4" onclick="document.title='deleted'">×</button>
  <div role="button" onclick="document.title='opened'">From Support: your statement for September is ready to read
    <button aria-label="Remove star">★</button></div>`;

test("safety gate reads names from aria-labelledby and icon alt text", async (t) => {
  if (!browser) return t.skip("Chrome not installed");
  await page.setContent(ICONS);
  const send = await refOf(page, 'button "Send"');
  let r = await run(`click @${send}`);
  assert.equal(r.ok, false);
  assert.match(r.failure!.reason, /safety stop.*send/);
  assert.equal(await page.title(), "");

  r = await run(`allow\nclick @${send}`);
  assert.equal(r.ok, true);
  assert.equal(await page.title(), "sent");

  const del = await refOf(page, 'img "Delete"', true); // the button itself has no name
  r = await run(`click @${del}`);
  assert.match(r.failure?.reason ?? "", /safety stop.*delete/);
  assert.equal(await page.title(), "sent"); // not clicked

  const remove = await refOf(page, 'button "Remove"'); // named by an image outside it
  r = await run(`click @${remove}`);
  assert.match(r.failure?.reason ?? "", /safety stop.*remove/);
  assert.equal(await page.title(), "sent");

  const titled = await refOf(page, 'button "Delete"'); // the naming element also has a title
  r = await run(`click @${titled}`);
  assert.match(r.failure?.reason ?? "", /safety stop.*delete/);
  assert.equal(await page.title(), "sent");
});

test("safety gate finds a label inside the same shadow root", async (t) => {
  if (!browser) return t.skip("Chrome not installed");
  await page.setContent(`<div id="host"></div><script>
    const root = document.getElementById("host").attachShadow({ mode: "open" });
    root.innerHTML = '<span id="sl" hidden>Delete</span><button aria-labelledby="sl" onclick="document.title=\\'gone\\'">×</button>';
  </script>`);
  const ref = await refOf(page, 'button "Delete"');
  const r = await run(`click @${ref}`);
  assert.match(r.failure?.reason ?? "", /safety stop.*delete/);
  assert.equal(await page.title(), "");
});

test("safety gate ignores icons inside a large card", async (t) => {
  if (!browser) return t.skip("Chrome not installed");
  await page.setContent(ICONS);
  const r = await run('click "From Support: your statement"');
  assert.equal(r.ok, true, r.failure?.reason);
  assert.equal(await page.title(), "opened");
});

test("safety gate reads an image's own alt (icon refs from icon groups)", async (t) => {
  if (!browser) return t.skip("Chrome not installed");
  await page.setContent(`<div style="cursor:pointer"><img alt="Delete" src="data:," width="20" height="20" onclick="document.title='deleted'"><img alt="Archive" src="data:," width="20" height="20"></div>`);
  const ref = await refOf(page, 'img "Delete"');
  const r = await run(`click @${ref}`);
  assert.match(r.failure?.reason ?? "", /safety stop.*delete/);
  assert.equal(await page.title(), "");
});

test("type finishes long text", async (t) => {
  if (!browser) return t.skip("Chrome not installed");
  await page.setContent(`<textarea aria-label="Note"></textarea>`);
  const text = "a".repeat(250);
  const r = await run(`type "Note" = ${text}\nexpect value "Note" = ${text}`);
  assert.equal(r.ok, true, r.failure?.reason);
});

test("fill works on plaintext-only and inherited editable elements", async (t) => {
  if (!browser) return t.skip("Chrome not installed");
  await page.setContent(`<div contenteditable="plaintext-only" aria-label="Plain" role="textbox"></div>
    <div contenteditable="true"><p aria-label="Inner" role="textbox">x</p></div>`);
  const r = await run(`fill "Plain" = hello\nfill "Inner" = world\nexpect text "hello"\nexpect text "world"`);
  assert.equal(r.ok, true, r.failure?.reason);
});

test("commit check stops an allowed risky click on a mismatch; allow unchecked skips it", async (t) => {
  if (!browser) return t.skip("Chrome not installed");
  await page.setContent(`<input aria-label="Date" value="2024-07-19"><button onclick="document.title='booked'">Book</button>`);
  const asked: string[] = [];
  const check = async (_p: unknown, label: string) => {
    asked.push(label);
    return { reason: 'date is "2024-07-19", task wants "2024-07-20"', model: true };
  };
  let r = await runChunk(async () => page, parseChunk('allow\nclick "Book"'), { check });
  assert.match(r.failure?.reason ?? "", /^CHECK before "Book" \(not clicked\): date is "2024-07-19"/);
  assert.equal(await page.title(), "");
  assert.deepEqual(asked, ["Book"]);

  r = await runChunk(async () => page, parseChunk('allow unchecked\nclick "Book"'), { check });
  assert.equal(r.ok, true, r.failure?.reason);
  assert.equal(await page.title(), "booked");
  assert.equal(asked.length, 1); // not asked again
});

test("a failed expect value on a password field never prints the value", async (t) => {
  if (!browser) return t.skip("Chrome not installed");
  await page.setContent(`<input type="password" aria-label="Password" value="actualPassword7">`);
  const r = await runChunk(async () => page, parseChunk('expect value "Password" = other'));
  assert.equal(r.ok, false);
  assert.equal(r.failure!.reason.includes("actualPassword7"), false, r.failure!.reason);
});

test("failures carry a fixed code; page text stays in the local reason only", async (t) => {
  if (!browser) return t.skip("Chrome not installed");
  await page.setContent(`<div role="dialog" style="position:fixed;inset:0;background:#fff">API secret: smallSecret</div><button>Go</button>`);
  let r = await run('click "Go"');
  assert.equal(r.failure?.code, "covered");
  r = await run('expect text "Recovery phrase: amber birch cedar"');
  assert.equal(r.failure?.code, "text-missing");
  r = await run('click "Nothing here"');
  assert.equal(r.failure?.code, "not-found");
});

test("a page-change stop is a fixed code, not free text; secret fields report typed values", async (t) => {
  if (!browser) return t.skip("Chrome not installed");
  await page.setContent(`<input type="password" aria-label="Password"><input aria-label="Card number"><input aria-label="City"><button>Pay</button>`);
  const secrets: string[] = [];
  const r = await runChunk(async () => page, parseChunk('allow\nfill "Password" = hunter22\nfill "Card number" = 4242424242424242\nfill "City" = Belgrade\nclick "Pay"'), {
    check: async () => ({ reason: "the page changed during the check (API secret smallSecret); run the step again", model: false }),
    onSecret: (v) => secrets.push(v),
  });
  assert.equal(r.failure?.code, "check-blocked");
  assert.equal(r.failure?.checkReason, undefined);
  assert.deepEqual(secrets, ["hunter22", "4242424242424242"]);
});

test("a click label names the control, never a value typed into a field", async (t) => {
  if (!browser) return t.skip("Chrome not installed");
  await page.setContent(`<input type="password" aria-label="Password" value="hunter2"><input type="submit" value="Send now">`);
  const labels: [number, string][] = [];
  const r = await runChunk(async () => page, parseChunk('allow unchecked\nclick "Password"\nclick "Send now"'), { onClickLabel: (i, l) => labels.push([i, l]) });
  assert.equal(r.ok, true, r.failure?.reason);
  assert.equal(JSON.stringify(labels).includes("hunter2"), false, JSON.stringify(labels));
  assert.deepEqual(labels.map(([i]) => i), [1, 2]);
  assert.match(labels[1][1], /Send now/);
});

test("a page reading keeps messages apart by element, so one that goes away is no change", async (t) => {
  if (!browser) return t.skip("Chrome not installed");
  await page.setContent(`<div role="alert">Version 2.0 launches soon! Mail alice@example.com</div>
    <main>Compose <span id="chip">alice@example.com</span> <button>Send</button> <span id="total">Total $10</span></main>
    <div role="status" id="promo">Total $1000</div><div role="status" id="live">Total $10</div>`);
  const before = await readEvidence(page);
  assert.deepEqual(before.transient?.map((m) => m.text), ["Version 2.0 launches soon! Mail alice@example.com", "Total $1000", "Total $10"]);
  assert.equal(before.whole?.includes("launches"), false);
  assert.match(before.whole ?? "", /alice@example\.com/); // the same words outside the message stay
  assert.match(before.text, /launches soon/); // the model still sees the message
  await page.evaluate(`document.querySelector('[role=alert]').remove()`);
  assert.deepEqual(changedFields(before, await readEvidence(page)), []);
  // A recipient chip removed while a message holds the same address: a change.
  await page.evaluate(`document.getElementById('chip').remove()`);
  assert.deepEqual(changedFields(before, await readEvidence(page)), ["page text"]);
  // A live total changes to text another message already shows: a change.
  await page.setContent(`<main>Pay</main><div role="status">Total $1000</div><div role="status">Total $10</div>`);
  const b2 = await readEvidence(page);
  await page.evaluate(`document.querySelectorAll('[role=status]')[1].textContent = "Total $1000"`);
  assert.deepEqual(changedFields(b2, await readEvidence(page)), ["page text"]);
  // Text under display: contents is drawn, so a change there counts; hidden text does not.
  await page.setContent(`<main>Pay <span style="display:contents">Total $10</span> <span style="visibility:hidden">x1</span> <span hidden>x2</span></main>`);
  const b3 = await readEvidence(page);
  assert.match(b3.whole ?? "", /Total \$10/);
  assert.doesNotMatch(b3.whole ?? "", /x1|x2/);
  await page.evaluate(`document.querySelector('span').textContent = "Total $1000"`);
  assert.deepEqual(changedFields(b3, await readEvidence(page)), ["page text"]);
  // A large element or one with fields is page content, not a message.
  await page.setContent(`<div role="status">Amount <input aria-label="Amount" value="10"></div>`);
  assert.deepEqual((await readEvidence(page)).transient, []);
});

test("an earlier allow of the same task lets a later run click", async (t) => {
  if (!browser) return t.skip("Chrome not installed");
  await page.setContent(`<button onclick="document.title='sent'">Send</button>`);
  let r = await runChunk(async () => page, parseChunk(`click "Send"`), { allowed: () => false });
  assert.match(r.failure?.reason ?? "", /safety stop/);
  r = await runChunk(async () => page, parseChunk(`click "Send"`), { allowed: () => true });
  assert.equal(r.ok, true);
  assert.equal(await page.title(), "sent");
});

test("a ref lost in a re-render is found again by its role and name", async (t) => {
  if (!browser) return t.skip("Chrome not installed");
  await page.setContent(`<div id="box"><button onclick="document.title='go'">Depart</button><button>Other</button></div>`);
  const ref = await refOf(page, 'button "Depart"');
  await page.evaluate(() => {
    const box = document.getElementById("box")!;
    box.innerHTML = box.innerHTML; // new elements, same look
  });
  const lines = new Map([[ref, `  @${ref} button "Depart"`]]);
  const refLine = (_p: Page, r: string) => lines.get(r);
  let res = await runChunk(async () => page, parseChunk(`click @${ref}`), { refLine });
  assert.equal(res.ok, true, res.failure?.reason);
  assert.equal(await page.title(), "go");

  // Gone for good: the reason says what the agent saw is not there.
  await page.setContent(`<button>Other</button>`);
  res = await runChunk(async () => page, parseChunk(`click @${ref}`), { refLine });
  assert.match(res.failure?.reason ?? "", /no button "Depart" is on the page now/);
});

test("several matches: the only field, the only whole word, or the first of equal copies", async (t) => {
  if (!browser) return t.skip("Chrome not installed");
  await page.setContent(`
    <div aria-label="Card number"><input aria-label="Card number"></div>
    <div role="listbox"><div role="option" onclick="document.title='M'">Male (M)</div><div role="option" onclick="document.title='F'">Female (F)</div></div>
    <section>Featured<div><h6 onclick="document.title='s1'">Souvla</h6>4.8 • 0.3 mi • 28 min</div><div>Taco Bell</div></section>
    <section>Near you<div><h6 onclick="document.title='s2'">Souvla</h6>4.8 • 0.3 mi • 28 min</div></section>
    <div><p>Rome <button onclick="document.title='r'">Book</button></p><p>Paris <button>Book</button></p></div>`);
  let r = await run(`fill "Card number" = 4242`);
  assert.equal(r.ok, true, r.failure?.reason);
  assert.equal(await page.locator("input").inputValue(), "4242");
  r = await run(`click "Male"`);
  assert.equal(r.ok, true, r.failure?.reason);
  assert.equal(await page.title(), "M");
  r = await run(`click "Souvla"`);
  assert.equal(r.ok, true, r.failure?.reason);
  assert.equal(await page.title(), "s1");
  // Two different rows: the agent picks.
  r = await run(`allow\nclick "Book"`);
  assert.match(r.failure?.reason ?? "", /2 elements match/);
});

test("a covered button is clicked by keyboard; a read-only field fails at once", async (t) => {
  if (!browser) return t.skip("Chrome not installed");
  await page.setContent(`
    <button style="position:fixed;top:0;left:0" onclick="document.title='hit'">Next</button>
    <div style="position:fixed;top:0;left:0;width:300px;height:100px;background:#fff">banner</div>
    <label>Country <input readonly value="United States"></label>`);
  let r = await run(`click "Next"`);
  assert.equal(r.ok, true, r.failure?.reason);
  assert.equal(await page.title(), "hit");
  const started = Date.now();
  r = await run(`fill "Country" = USA`);
  assert.match(r.failure?.reason ?? "", /read-only and holds "United States"/);
  assert.ok(Date.now() - started < 1500);
});

test("review: a covered click never presses Enter on another control or behind a dialog", async (t) => {
  if (!browser) return t.skip("Chrome not installed");
  // The target cannot take the focus: Enter would go to the focused Send button.
  await page.setContent(`
    <button id="send" onclick="document.title='sent'">Send</button>
    <button style="position:fixed;top:0;left:0" disabled onclick="document.title='next'">Next</button>
    <div style="position:fixed;top:0;left:0;width:300px;height:100px;background:#fff">banner</div>`);
  await page.focus("#send");
  let r = await run(`click "Next"`);
  assert.equal(r.ok, false);
  assert.equal(await page.title(), "");
  // A backdrop beside an open dialog covers the page.
  await page.setContent(`
    <button style="position:fixed;top:0;left:0" onclick="document.title='next'">Next</button>
    <div style="position:fixed;inset:0;background:#0008"></div>
    <div role="dialog" aria-modal="true" style="position:fixed;top:200px;left:200px">Are you sure?</div>`);
  r = await run(`click "Next"`);
  assert.equal(r.failure?.code, "covered");
  assert.equal(await page.title(), "");
});

test("review: a lost ref is not guessed when the agent saw two alike, or for a risky control", async (t) => {
  if (!browser) return t.skip("Chrome not installed");
  await page.setContent(`
    <div id="a">Alice <button onclick="document.title='open alice'">Open</button></div>
    <div id="b">Bob <button onclick="document.title='open bob'">Open</button></div>`);
  await showPage(page);
  const ref = await refOf(page, 'button "Open"');
  await page.evaluate(() => document.getElementById("a")!.remove());
  const refLine = seenLine;
  let r = await runChunk(async () => page, parseChunk(`click @${ref}`), { refLine });
  assert.equal(r.failure?.code, "ref-gone");
  assert.equal(await page.title(), "");
  // One "Delete" seen, re-rendered: a risky control is still not guessed.
  await page.setContent(`<div id="box"><button>Delete</button></div>`);
  await showPage(page);
  const del = await refOf(page, 'button "Delete"');
  await page.evaluate(() => {
    const box = document.getElementById("box")!;
    box.innerHTML = box.innerHTML;
  });
  r = await runChunk(async () => page, parseChunk(`allow\nclick @${del}`), { refLine });
  assert.equal(r.failure?.code, "ref-gone");
});

test("review: equal action bars in two records are not copies; a read-only secret is not printed", async (t) => {
  if (!browser) return t.skip("Chrome not installed");
  await page.setContent(`
    <section>Alice<div><button onclick="document.title='alice'">Open</button> Preview account details</div></section>
    <section>Bob<div><button onclick="document.title='bob'">Open</button> Preview account details</div></section>
    <label>Password <input type="password" readonly value="actualPassword7"></label>`);
  let r = await run(`click "Open"`);
  assert.match(r.failure?.reason ?? "", /2 elements match/);
  assert.equal(await page.title(), "");
  r = await run(`fill "Password" = other`);
  assert.match(r.failure?.reason ?? "", /read-only/);
  assert.equal(r.failure!.reason.includes("actualPassword7"), false);
});

test("review 2: no focus tricks, shadow dialogs, exact names, placeholder links, labelled secrets", async (t) => {
  if (!browser) return t.skip("Chrome not installed");
  // A focus handler that moves the focus to Send: the covered click must not send.
  await page.setContent(`
    <button id="send" onclick="document.title='sent'">Send</button>
    <button id="next" style="position:fixed;top:0;left:0" onclick="document.title='next'">Next</button>
    <div style="position:fixed;top:0;left:0;width:300px;height:100px;background:#fff">banner</div>
    <script>document.getElementById("next").addEventListener("focus", () => queueMicrotask(() => document.getElementById("send").focus()));</script>`);
  let r = await run(`click "Next"`);
  assert.equal(r.ok, true, r.failure?.reason);
  assert.equal(await page.title(), "next");
  // A modal inside a shadow root.
  await page.setContent(`<button style="position:fixed;top:0;left:0" onclick="document.title='behind'">Next</button><div id="host"></div>`);
  await page.evaluate(() => {
    const root = document.getElementById("host")!.attachShadow({ mode: "open" });
    root.innerHTML = '<div style="position:fixed;inset:0;background:#0008"></div><div role="dialog" aria-modal="true" style="position:fixed;top:200px;left:200px">Sure?</div>';
  });
  r = await run(`click "Next"`);
  assert.equal(r.failure?.code, "covered");
  assert.equal(await page.title(), "");
  // Both are named "Open"; placeholder links are not one item.
  await page.setContent(`
    <section>Alice <button aria-label="Open">Open</button></section>
    <section>Bob <button aria-label="Open">View account</button></section>
    <p><a href="#" onclick="document.title='a'">Read</a></p><p><a href="#" onclick="document.title='b'">Read</a></p>
    <span id="tk">API token</span><input aria-labelledby="tk" readonly value="tok_live_123">`);
  r = await run(`click "Open"`);
  assert.match(r.failure?.reason ?? "", /2 elements match/);
  r = await run(`click "Read"`);
  assert.match(r.failure?.reason ?? "", /2 elements match/);
  r = await run(`fill "API token" = x`);
  assert.match(r.failure?.reason ?? "", /read-only/);
  assert.equal(r.failure!.reason.includes("tok_live_123"), false);
  assert.equal(await page.title(), "");
});

test("review 3: labelledby names, display-contents dialogs, labelled secrets", async (t) => {
  if (!browser) return t.skip("Chrome not installed");
  await page.setContent(`
    <span id="o1">Open</span><span id="o2">Open</span>
    <section>Alice <button aria-labelledby="o1">Open</button></section>
    <section>Bob <button aria-labelledby="o2">View account</button></section>
    <span id="lb" aria-label="API token">Key</span><input aria-labelledby="lb" readonly value="tok_live_9">`);
  let r = await run(`click button "Open"`);
  assert.match(r.failure?.reason ?? "", /2 elements match/);
  r = await run(`fill textbox "API token" = x`);
  assert.match(r.failure?.reason ?? "", /read-only/);
  assert.equal(r.failure!.reason.includes("tok_live_9"), false);

  await page.setContent(`
    <button style="position:fixed;top:0;left:0" onclick="document.title='behind'">Next</button>
    <div role="dialog" aria-modal="true" style="display:contents"><div style="position:fixed;inset:0;background:#0008">Sure?</div></div>`);
  r = await run(`click "Next"`);
  assert.equal(r.failure?.code, "covered");
  assert.equal(await page.title(), "");
});

test("optional steps that find nothing are skipped; if steps run only when their condition holds", async (t) => {
  if (!browser) return t.skip("Chrome not installed");
  await page.setContent(`<p>Sold out</p><button onclick="document.title += 'n'">Notify me</button><button onclick="document.title += 'b'">Buy</button>`);
  await page.evaluate(() => (document.title = ""));
  const steps = parseChunk(
    'optional click "Accept cookies"\nif text "Sold out": click "Notify me"\nif no text "Sold out": click "Buy"\noptional expect text "Thanks"\nexpect text "Sold out"',
  );
  const t0 = Date.now();
  const r = await runChunk(async () => page, steps);
  assert.equal(r.ok, true);
  assert.equal(await page.title(), "n");
  assert.deepEqual(r.skipped?.map((s) => [s.index, s.reason]), [[0, "not found within 2s"], [2, "condition not met"], [3, 'text "Thanks" not on the page']]);
  assert.ok(Date.now() - t0 < 6000, "optional steps wait at most 2 s");
});

test("optional never skips a safety stop, a choice between matches, or an unknown step error", async (t) => {
  if (!browser) return t.skip("Chrome not installed");
  await page.setContent(`<button onclick="document.title='sent'">Send</button><a>Open</a><a>Open</a>`);
  await page.evaluate(() => (document.title = ""));
  let r = await run('optional click "Send"\nexpect text "Open"');
  assert.equal(r.failure?.code, "safety-stop");
  assert.equal(r.skipped, undefined);
  r = await run('optional click "Open"');
  assert.equal(r.failure?.code, "many-matches");
  // a false "if" never opens the gate: nothing is clicked, nothing stops
  r = await run('if text "Missing": click "Send"');
  assert.equal(r.ok, true);
  assert.equal(await page.title(), "");
});

// The engine's hooks, cut down: the check spy and the confirm rule (see engine/main.ts).
function checkSpy(verdict: { reason: string; model: boolean } | null = null) {
  const calls = { check: [] as string[], start: [] as string[], finish: 0 };
  const hooks: RunHooks = {
    check: async (_p, label) => (calls.check.push(label), verdict),
    startCheck: (_p, label) => {
      calls.start.push(label);
      return async () => (calls.finish++, verdict);
    },
  };
  return { calls, hooks };
}

test("early commit check: starts during the read-only steps and is used for the same click", async (t) => {
  if (!browser) return t.skip("Chrome not installed");
  await page.setContent(`<label>Amount <input id="a"></label><button onclick="document.title='paid ' + a.value">Pay</button>`);
  await page.evaluate(() => (document.title = ""));
  const spy = checkSpy();
  let r = await runChunk(async () => page, parseChunk('allow\nfill "Amount" = 5\nexpect value "Amount" = 5\nwait 50ms\nclick button "Pay"'), spy.hooks);
  assert.equal(r.ok, true);
  assert.equal(await page.title(), "paid 5");
  assert.deepEqual(spy.calls, { check: [], start: ["Pay"], finish: 1 });

  // a mismatch from the early check stops the click
  await page.evaluate(() => (document.title = ""));
  const no = checkSpy({ reason: "amount is 5, task wants 50", model: true });
  r = await runChunk(async () => page, parseChunk('allow\nexpect value "Amount" = 5\nclick button "Pay"'), no.hooks);
  assert.equal(r.failure?.code, "check-mismatch");
  assert.equal(await page.title(), "");

  // no read-only step before the click, no allow, or "allow unchecked": no early check
  for (const chunk of ['allow\nfill "Amount" = 5\nclick button "Pay"', 'expect value "Amount" = 5\nclick button "Pay"', 'allow unchecked\nexpect value "Amount" = 5\nclick button "Pay"']) {
    const s = checkSpy();
    await runChunk(async () => page, parseChunk(chunk), s.hooks);
    assert.deepEqual(s.calls.start, [], chunk);
  }
  // a click that is not risky: started for nothing is fine, but no early check is used
  await page.setContent(`<input aria-label="Q"><button>Next</button>`);
  const next = checkSpy();
  r = await runChunk(async () => page, parseChunk('allow\nexpect value "Q" = \nclick "Next"'), next.hooks);
  assert.equal(r.ok, true);
  assert.deepEqual(next.calls, { check: [], start: [], finish: 0 });
});

test("early commit check: a different control at click time gets its own check", async (t) => {
  if (!browser) return t.skip("Chrome not installed");
  // The button's label changes after the early check started (a cart that was still loading).
  await page.setContent(`<button id="b" onclick="document.title='clicked ' + b.textContent">Pay $5</button>
    <script>setTimeout(() => { b.textContent = "Pay $50" }, 300)</script>`);
  await page.evaluate(() => (document.title = ""));
  const spy = checkSpy();
  const r = await runChunk(async () => page, parseChunk('allow\nwait 600ms\nclick button "Pay"'), spy.hooks);
  assert.equal(r.ok, true);
  assert.deepEqual(spy.calls, { check: ["Pay | Pay $50"], start: ["Pay | Pay $5"], finish: 0 });
  assert.equal(await page.title(), "clicked Pay $50");
});

// The engine's dialog rule, cut down (see engine/main.ts onDialog).
function dialogRule(p: Page) {
  const armed = new WeakMap<Page, Arm>();
  const notes: string[] = [];
  const onDialog = (d: import("playwright-core").Dialog) => {
    const a = dialogAnswer(d.type(), d.message(), armed.get(p));
    if (a.accept && d.type() === "confirm") armed.delete(p);
    notes.push(a.note.split(" (")[0]);
    void (a.accept ? d.accept() : d.dismiss());
  };
  p.on("dialog", onDialog);
  const hooks: RunHooks = { arm: (pg, what) => (what ? armed.set(pg, what) : armed.delete(pg)) };
  return { armed, notes, hooks, off: () => p.off("dialog", onDialog) };
}

test("confirm dialogs: accepted only during an allowed risky click, dismissed otherwise", async (t) => {
  if (!browser) return t.skip("Chrome not installed");
  const d = dialogRule(page);
  try {
    await page.setContent(`
      <button onclick="if (confirm('Delete this mail?')) document.title += 'D'">Delete</button>
      <button onclick="if (confirm('Leave the form?')) document.title += 'L'">Back</button>
      <button onclick="alert('Saved'); document.title += 'A'">Save</button>
      <button onclick="document.title += 'S'; setTimeout(() => { if (confirm('Delete all drafts?')) document.title += 'X' }, 50)">Send</button>
      <button onclick="if (confirm('Delete one?')) document.title += '1'; if (confirm('Delete two?')) document.title += '2'">Remove</button>`);
    await page.evaluate(() => (document.title = ""));
    let r = await runChunk(async () => page, parseChunk('allow\nclick "Delete"'), d.hooks);
    assert.equal(r.ok, true);
    r = await runChunk(async () => page, parseChunk('allow\nclick "Back"\nclick "Save"'), d.hooks);
    assert.equal(r.ok, true);
    // review 1: a confirm from a timer while the page settles is not the click's own
    r = await runChunk(async () => page, parseChunk('allow\nclick "Send"\nwait 200ms'), d.hooks);
    assert.equal(r.ok, true);
    // one click, one confirm
    r = await runChunk(async () => page, parseChunk('allow\nclick "Remove"'), d.hooks);
    assert.equal(r.ok, true);
    assert.equal(await page.title(), "DAS1");
    assert.deepEqual(d.notes, [
      `dialog: confirm "Delete this mail?" accepted`,
      `dialog: confirm "Leave the form?" dismissed`,
      `dialog: alert "Saved" closed`,
      `dialog: confirm "Delete all drafts?" dismissed`,
      `dialog: confirm "Delete one?" accepted`,
      `dialog: confirm "Delete two?" dismissed`,
    ]);
    assert.equal(d.armed.has(page), false, "disarmed after the click");
  } finally {
    d.off();
  }
});

test("review 1: an optional step that may have acted, or failed for another cause, is not skipped", async (t) => {
  if (!browser) return t.skip("Chrome not installed");
  // The click ran, then its navigation stalls: Playwright times out after the click.
  const p = await browser.newPage();
  try {
    await p.route("http://stall.test/**", () => {}); // never answered
    await p.setContent(`<button onclick="document.title='clicked'; location.href='http://stall.test/'">Go</button>`);
    const r = await runChunk(async () => p, parseChunk('optional click "Go"'));
    assert.equal(r.skipped, undefined, "a click that ran is never reported as skipped");
    assert.equal(r.failure?.mayHaveRun, true);
    assert.match(r.failure!.reason, /may have run/);
  } finally {
    await p.close();
  }
  // A closed page is an error, not missing text.
  const r = await runChunk(async () => p, parseChunk('optional wait for text "Saved"\noptional expect text "Saved"'));
  assert.equal(r.ok, false);
  assert.equal(r.failure?.code, "error");
});

test("review 1: no early check across an expect value step (it may learn a secret first)", async (t) => {
  if (!browser) return t.skip("Chrome not installed");
  await page.setContent(`<label>Password <input type="password" value="violetfox"></label><button>Send</button>`);
  const spy = checkSpy();
  let r = await runChunk(async () => page, parseChunk('allow\nwait 50ms\nexpect value "Password" = violetfox\nclick "Send"'), spy.hooks);
  assert.equal(r.ok, true);
  assert.deepEqual(spy.calls, { check: ["Send"], start: [], finish: 0 });
  // after the expect value, read-only steps may still overlap the check
  const late = checkSpy();
  r = await runChunk(async () => page, parseChunk('allow\nexpect value "Password" = violetfox\nwait 50ms\nclick "Send"'), late.hooks);
  assert.deepEqual(late.calls, { check: [], start: ["Send"], finish: 1 });
});

test("review 2: a confirm while a gated click waits to be ready is not accepted", async (t) => {
  if (!browser) return t.skip("Chrome not installed");
  const d = dialogRule(page);
  try {
    await page.setContent(`<button id="s" disabled onclick="document.title += 'S'">Send</button>
      <script>
        setTimeout(() => { if (confirm('Delete all drafts?')) document.title += 'X' }, 100);
        setTimeout(() => { s.disabled = false }, 400);
      </script>`);
    await page.evaluate(() => (document.title = ""));
    const r = await runChunk(async () => page, parseChunk('allow\nclick "Send"'), d.hooks);
    assert.equal(r.ok, true);
    assert.equal(await page.title(), "S");
    assert.deepEqual(d.notes, [`dialog: confirm "Delete all drafts?" dismissed`]);
  } finally {
    d.off();
  }
});

test("review 2: an early verdict is reused only for the whole same label", async (t) => {
  if (!browser) return t.skip("Chrome not installed");
  const long = "Send payment of the monthly invoice amount to the account holder ";
  await page.setContent(`<button id="b" aria-label="${long}Alice">Send</button>
    <script>setTimeout(() => b.setAttribute("aria-label", "${long}Bob"), 200)</script>`);
  const spy = checkSpy();
  const r = await runChunk(async () => page, parseChunk('allow\nwait 500ms\nclick button "Send"'), spy.hooks);
  assert.equal(r.ok, true);
  assert.equal(spy.calls.start.length, 1);
  assert.equal(spy.calls.finish, 0, "the early verdict was for Alice");
  assert.equal(spy.calls.check.length, 1);
});

test("review 2: an optional custom select whose option is missing is not skipped (the dropdown opened)", async (t) => {
  if (!browser) return t.skip("Chrome not installed");
  await page.setContent(`<div role="combobox" aria-label="Size" onclick="document.title='open'">Pick</div>`);
  await page.evaluate(() => (document.title = ""));
  const r = await runChunk(async () => page, parseChunk('optional select "Size" = Huge'));
  assert.equal(r.ok, false);
  assert.equal(r.failure?.code, "option-missing");
  assert.equal(r.failure?.mayHaveRun, true);
  assert.equal(await page.title(), "open");
});

test("review 3: the confirm arm ends when the click goes out, not when its navigation loads", async (t) => {
  if (!browser) return t.skip("Chrome not installed");
  const p = await browser.newPage();
  const d = dialogRule(p);
  try {
    await p.route("http://stall.test/**", () => {}); // never answered
    await p.setContent(`<button onclick="location.href='http://stall.test/'">Send</button>
      <script>setTimeout(() => { if (confirm('Delete all drafts?')) document.title = 'X' }, 500)</script>`);
    const r = await runChunk(async () => p, parseChunk('allow\nclick "Send"\nwait 600ms'), d.hooks);
    assert.equal(r.ok, true);
    assert.deepEqual(d.notes, [`dialog: confirm "Delete all drafts?" dismissed`]);
  } finally {
    d.off();
    await p.close();
  }
});

test("review 3: the commit check reads the page after the control is ready, as the click meets it", async (t) => {
  if (!browser) return t.skip("Chrome not installed");
  await page.setContent(`<p>Total <span id="a">5</span></p><button id="b" disabled onclick="document.title='paid ' + a.textContent">Pay</button>
    <script>setTimeout(() => { a.textContent = "50"; b.disabled = false }, 300)</script>`);
  await page.evaluate(() => (document.title = ""));
  const seen: string[] = [];
  const r = await runChunk(async () => page, parseChunk('allow\nclick "Pay"'), {
    check: async (pg) => (seen.push((await pg.textContent("#a")) ?? ""), null),
  });
  assert.equal(r.ok, true);
  assert.deepEqual(seen, ["50"]);
  assert.equal(await page.title(), "paid 50");
});

test("review 4: a confirm from a timer while the gated click waits again is dismissed (no tag)", async (t) => {
  if (!browser) return t.skip("Chrome not installed");
  const d = dialogRule(page);
  try {
    await page.setContent(`<button id="s" onclick="if (confirm('Send it?')) document.title += 'S'">Send</button>`);
    await page.evaluate(() => (document.title = ""));
    // The check takes a while; meanwhile the button turns disabled, a timer asks, then it turns on again.
    const hooks: RunHooks = {
      ...d.hooks,
      check: async (p) => {
        await p.evaluate(() => {
          const s = document.getElementById("s") as HTMLButtonElement;
          s.disabled = true;
          setTimeout(() => { if (confirm("Delete all drafts?")) document.title += "X"; }, 100);
          setTimeout(() => (s.disabled = false), 400);
        });
        return null;
      },
    };
    const r = await runChunk(async () => page, parseChunk('allow\nclick "Send"'), hooks);
    assert.equal(r.ok, true);
    assert.equal(await page.title(), "S");
    assert.deepEqual(d.notes, [`dialog: confirm "Delete all drafts?" dismissed`, `dialog: confirm "Send it?" accepted`]);
  } finally {
    d.off();
  }
});

test("review 4: a control whose label changes while it gets ready is not clicked", async (t) => {
  if (!browser) return t.skip("Chrome not installed");
  await page.setContent(`<button id="b" disabled aria-label="Send Alice" onclick="document.title='clicked'">Send</button>
    <script>setTimeout(() => { b.setAttribute("aria-label", "Send Bob"); b.disabled = false }, 300)</script>`);
  await page.evaluate(() => (document.title = ""));
  const spy = checkSpy();
  const r = await runChunk(async () => page, parseChunk('allow\nclick "Send"'), spy.hooks);
  assert.equal(r.failure?.code, "check-blocked");
  assert.match(r.failure!.reason, /changed while it got ready/);
  assert.equal(await page.title(), "");
  assert.deepEqual(spy.calls.check, []);
});

test("review 5: a control that turns into another one during the check is not clicked", async (t) => {
  if (!browser) return t.skip("Chrome not installed");
  await page.setContent(`<button id="b" aria-label="Send Alice" onclick="document.title='clicked ' + b.getAttribute('aria-label')">Send</button>`);
  await page.evaluate(() => (document.title = ""));
  const r = await runChunk(async () => page, parseChunk('allow\nclick "Send"'), {
    check: async (p) => {
      // During the check: disabled, then a new label, then enabled again.
      await p.evaluate(() => {
        const b = document.getElementById("b") as HTMLButtonElement;
        b.disabled = true;
        setTimeout(() => { b.setAttribute("aria-label", "Send Bob"); b.disabled = false; }, 200);
      });
      return null;
    },
  });
  assert.equal(r.failure?.code, "check-blocked");
  assert.equal(await page.title(), "");
});
