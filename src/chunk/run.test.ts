import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright-core";
import { parseChunk } from "./parse.ts";
import { runChunk } from "./run.ts";
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
