import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright-core";
import { parseChunk } from "./parse.ts";
import { runChunk } from "./run.ts";

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
