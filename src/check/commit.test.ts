import { test } from "node:test";
import assert from "node:assert/strict";
import { changedFields, checkWithRetry, finishEarlyCheck, TEXT_MAX, commitPrompt, safeTask, formatEvidence, mismatchReason, redactEvidence, redactText, runCommitCheck, type Evidence } from "./commit.ts";

test("evidence lists fields with kind, state and value", () => {
  const text = formatEvidence({
    title: "Book",
    url: "https://x.com/book",
    fields: [
      { label: "Date", value: "07/19/2024", kind: "text" },
      { label: "Guests", value: "", kind: "number", state: "min=1 max=16" },
    ],
    text: "Royal Dine · 7:00 PM",
  });
  assert.equal(
    text,
    ["page: Book | https://x.com/book", "fields:", "- Date [text]: 07/19/2024", "- Guests [number min=1 max=16]: (empty)", "visible text:", "Royal Dine · 7:00 PM"].join("\n"),
  );
});

test("a verdict becomes one short reason", () => {
  assert.equal(mismatchReason({ ok: true, mismatches: [] }), null);
  assert.equal(
    mismatchReason({ ok: false, mismatches: [{ fact: "date", expected: "July 20", found: "July 19" }, { fact: "guests", expected: "4", found: "2" }] }),
    'date is "July 19", task wants "July 20"; guests is "2", task wants "4"',
  );
  assert.equal(mismatchReason({ ok: false, mismatches: [] }), "the page does not match the task");
});

test("private values are hidden before sending; values the task names stay", () => {
  const e = redactEvidence(
    {
      title: "Pay",
      url: "https://shop.com/pay?session=abc123&token=xyz#top",
      fields: [
        { label: "Card number", value: "4242 4242 4242 4242", kind: "text" },
        { label: "CVV", value: "123", kind: "text" },
        { label: "Email", value: "ana@private.com", kind: "email" },
        { label: "To", value: "jonathan.smith@example.com", kind: "text" },
        { label: "Phone", value: "+1 415 555 0123", kind: "tel" },
        { label: "Guests", value: "4", kind: "number" },
      ],
      text: "Call 0641234567 or mail ana@private.com. Order 2024-07-20, 07-20-2024, 07/20/2024",
    },
    "Send an email to jonathan.smith@example.com for 4 guests",
  );
  assert.equal(e.url, "https://shop.com/pay");
  assert.deepEqual(
    e.fields.map((f) => f.value),
    ["[hidden]", "[hidden]", "[email]", "jonathan.smith@example.com", "[number]", "4"],
  );
  assert.equal(e.text, "Call [number] or mail [email]. Order 2024-07-20, 07-20-2024, 07/20/2024");
});

test("changed fields between two readings", () => {
  const at = (amount: string) => ({ title: "", url: "", text: "", fields: [{ label: "Amount", value: amount, kind: "text" }, { label: "Note", value: "x", kind: "text" }] });
  assert.deepEqual(changedFields(at("10.00"), at("10.00")), []);
  assert.deepEqual(changedFields(at("10.00"), at("1000.00")), ["Amount"]);
});

test("a message that goes away is not a page change; a new or changed message, or other text, is", () => {
  const ev = (whole: string, transient: { id: number; text: string }[] = []) => ({ title: "", url: "", fields: [], text: whole, whole, transient });
  const page = "GoMail Compose To Subject Send";
  assert.deepEqual(changedFields(ev(page, [{ id: 1, text: "Version 2.0 launches soon!" }]), ev(page)), []); // the banner went away
  assert.deepEqual(changedFields(ev(page), ev(page, [{ id: 2, text: "Price changed to $1000" }])), ["page text"]); // a new alert
  assert.deepEqual(changedFields(ev(page, [{ id: 1, text: "Total $10" }]), ev(page, [{ id: 1, text: "Total $1000" }])), ["page text"]); // a live total changed
  // The same text in another message does not hide a change.
  assert.deepEqual(changedFields(ev(page, [{ id: 1, text: "Total $1000" }, { id: 2, text: "Total $10" }]), ev(page, [{ id: 1, text: "Total $1000" }, { id: 2, text: "Total $1000" }])), ["page text"]);
  assert.deepEqual(changedFields(ev("Checkout Pay Total 1 000 USD including tax"), ev("Checkout Pay Total 1")), ["page text"]);
});

test("the change check compares whole texts: a cut text cannot hide a changed price", () => {
  const filler = "item ".repeat(TEXT_MAX);
  const ev = (whole: string) => ({ title: "", url: "", fields: [], text: whole.slice(0, TEXT_MAX), whole });
  assert.deepEqual(changedFields(ev(filler + "Total $10"), ev(filler + "Total $1000")), ["page text"]);
});

test("the whole text never leaves the machine", () => {
  const e = { title: "t", url: "https://x.com/", fields: [], text: "short", whole: "short SECRETWHOLE" };
  assert.equal(JSON.stringify(redactEvidence(e, "task")).includes("SECRETWHOLE"), false);
  assert.equal(commitPrompt("task", "Send", e).includes("SECRETWHOLE"), false);
});

test("a secret field's value is removed from every surface", () => {
  const e = redactEvidence(
    { title: "Key sk_live_SYNTHETIC_TEST_ONLY", url: "https://x.com/k", fields: [{ label: "API token", value: "sk_live_SYNTHETIC_TEST_ONLY", kind: "text" }], text: "Your API token sk_live_SYNTHETIC_TEST_ONLY is ready" },
    "Create an API key",
  );
  assert.equal(JSON.stringify(e).includes("SYNTHETIC"), false);
  assert.equal(e.text, "Your API token [hidden] is ready");
});

test("free text hides tokens and URL queries", () => {
  assert.equal(redactText("open https://x.com/a?session=abc#t now", "task"), "open https://x.com/a now");
  assert.equal(redactText("id 9f8a7b6c5d4e3f2a1b0c9d8e7f done", "task"), "id [token] done");
  assert.equal(redactText("Royal Dine on July 20", "task"), "Royal Dine on July 20");
});

test("nameless fields, URL and page text changes are all seen", () => {
  const ev = (a: string, b: string, text = "Total $10", url = "https://x.com/pay") => ({ title: "", url, text, fields: [{ label: "", value: a, kind: "text" }, { label: "", value: b, kind: "text" }] });
  assert.deepEqual(changedFields(ev("1", "2"), ev("1", "2")), []);
  assert.deepEqual(changedFields(ev("1", "2"), ev("9", "2")), ["field 1"]);
  assert.deepEqual(changedFields(ev("1", "2"), ev("1", "2", "Total $1000")), ["page text"]);
  assert.deepEqual(changedFields(ev("1", "2"), ev("1", "2", "Total $10", "https://x.com/pay?x=1")), ["url"]);
});

test("the whole outgoing check text hides secrets in the URL path and the action label", () => {
  const key = "sk_live_SYNTHETIC_TEST_ONLY";
  const text = commitPrompt(`Revoke the old key`, `Delete ${key}`, {
    title: "Keys",
    url: `https://x.com/keys/${key}?a=1`,
    fields: [{ label: "API token", value: key, kind: "text" }],
    text: `Key ${key}`,
  });
  assert.equal(text.includes("SYNTHETIC"), false, text);
  assert.match(text, /About to click: Delete \[hidden\]/);
  assert.match(text, /page: Keys \| https:\/\/x\.com\/keys\/\[hidden\]/);
});


const ev = (amount: string): Evidence => ({ title: "", url: "https://x.com/pay", text: "", fields: [{ label: "Amount", value: amount, kind: "text" }] });

test("check flow: a negative verdict stops even when the second read would fail", async () => {
  let reads = 0;
  const read = async () => {
    if (reads++ > 0) throw new Error("Execution context was destroyed");
    return ev("10.00");
  };
  const out = await runCommitCheck("pay 10.00", "Pay", read, async () => ({ ok: false, mismatches: [{ fact: "amount", expected: "10.00", found: "100" }], ms: 5 }));
  assert.equal(out.kind, "stop");
  assert.equal(reads, 1, "no second read needed");
});

test("check flow: a failed second read after an OK verdict stops the click", async () => {
  let reads = 0;
  const read = async () => {
    if (reads++ > 0) throw new Error("Execution context was destroyed");
    return ev("10.00");
  };
  const out = await runCommitCheck("pay 10.00", "Pay", read, async () => ({ ok: true, mismatches: [], ms: 5 }));
  assert.equal(out.kind, "stop");
  assert.match((out as { reason: string }).reason, /could not read the page again/);
});

test("check flow: a change during the check stops; an API failure is skipped; a stable page passes", async () => {
  const seq = (...xs: Evidence[]) => { let i = 0; return async () => xs[Math.min(i++, xs.length - 1)]; };
  const okAsk = async () => ({ ok: true, mismatches: [], ms: 5 });
  assert.equal((await runCommitCheck("pay", "Pay", seq(ev("10.00"), ev("1000.00")), okAsk)).kind, "stop");
  assert.equal((await runCommitCheck("pay", "Pay", seq(ev("10.00")), async () => { throw new Error("Meta API 503"); })).kind, "skipped");
  assert.equal((await runCommitCheck("pay", "Pay", seq(ev("10.00"), ev("10.00")), okAsk)).kind, "ok");
  assert.equal((await runCommitCheck("pay", "Pay", async () => { throw new Error("closed"); }, okAsk)).kind, "stop");
});

test("retry: a page that moved during the check gets one more check, and only one", async () => {
  const seq = (...xs: Evidence[]) => { let i = 0; return async () => xs[Math.min(i++, xs.length - 1)]; };
  const okAsk = async () => ({ ok: true, mismatches: [], ms: 5 });
  // moved, then stable: the second check passes; ms counts both
  const read = seq(ev("10.00"), ev("10.50"), ev("10.50"), ev("10.50"));
  const out = await checkWithRetry(() => runCommitCheck("pay", "Pay", read, okAsk));
  assert.equal(out.kind, "ok");
  assert.equal((out as { ms: number }).ms, 10);
  // moves every time: stops after two checks
  let n = 0;
  const moving = async () => ev(String(n++));
  let asks = 0;
  const stop = await checkWithRetry(() => runCommitCheck("pay", "Pay", moving, async () => (asks++, { ok: true, mismatches: [], ms: 5 })));
  assert.equal(stop.kind, "stop");
  assert.match((stop as { reason: string }).reason, /changed during the check/);
  assert.equal(asks, 2);
  // a mismatch is never checked again
  asks = 0;
  const no = await checkWithRetry(() => runCommitCheck("pay", "Pay", seq(ev("1")), async () => (asks++, { ok: false, mismatches: [{ fact: "a", expected: "1", found: "2" }], ms: 5 })));
  assert.equal(no.kind, "stop");
  assert.equal(asks, 1);
});

test("early check: its verdict counts only while the page reads the same", async () => {
  const okEarly = Promise.resolve({ kind: "ok" as const, ms: 5, seen: ev("10.00") });
  let again = 0;
  const fresh = async () => (again++, { kind: "stop" as const, reason: "fresh", model: true });
  // same page at click time: the early OK is used, no new check
  const same = await finishEarlyCheck(okEarly, async () => ev("10.00"), fresh);
  assert.equal(same.kind, "ok");
  assert.equal(same.reused, true);
  assert.equal(again, 0);
  // the amount changed after the early check: a new check decides
  const moved = await finishEarlyCheck(okEarly, async () => ev("100.00"), fresh);
  assert.equal(moved.kind, "stop");
  assert.equal(again, 1);
  // the click-time read fails: a new check decides (it reads the page itself)
  await finishEarlyCheck(okEarly, async () => { throw new Error("closed"); }, fresh);
  assert.equal(again, 2);
  // an early check that stopped for a page change, failed, or was skipped: a new check
  for (const early of [
    Promise.resolve({ kind: "stop" as const, reason: "changed", model: false, changed: true }),
    Promise.reject(new Error("boom")),
    Promise.resolve({ kind: "skipped" as const, error: "503" }),
  ]) await finishEarlyCheck(early as Promise<never>, async () => ev("10.00"), fresh);
  assert.equal(again, 5);
  // an early mismatch on the same page stops without a new check
  const mismatch = await finishEarlyCheck(Promise.resolve({ kind: "stop" as const, reason: "amount", model: true, seen: ev("10.00") }), async () => ev("10.00"), fresh);
  assert.deepEqual([mismatch.kind, (mismatch as { reason: string }).reason, again], ["stop", "amount", 5]);
});



test("short known secrets (CVV, PIN) go everywhere in the check request, as whole words", () => {
  const text = commitPrompt("Pay the order", "Pay with CVV 123", {
    title: "Pay 123",
    url: "https://x.com/pay/123",
    fields: [{ label: "CVV", value: "123", kind: "text" }, { label: "PIN", value: "4821", kind: "text" }],
    text: "CVV 123 entered. PIN 4821. Total $1123.00 on 2024-07-20",
  });
  assert.equal(/(?<!\w)123(?!\w)/.test(text), false, text);
  assert.equal(text.includes("4821"), false, text);
  assert.match(text, /\$1123\.00/); // digits inside other numbers stay
  assert.match(text, /2024-07-20/);
});

test("a known secret named in the task stays hidden in the check request", () => {
  const text = commitPrompt("Pay the order using CVV 123", "Pay", { title: "Pay", url: "https://x.com/pay", fields: [{ label: "CVV", value: "123", kind: "text" }], text: "" });
  assert.equal(/(?<!\w)123(?!\w)/.test(text), false, text);
  assert.match(text, /Task: Pay the order using CVV \[hidden\]/);
});

test("task secrets are hidden even when their fields are gone (confirmation page)", () => {
  const empty: Evidence = { title: "Confirm", url: "https://x.com/confirm", fields: [], text: "Please confirm your order" };
  const text = commitPrompt("Pay using card 4242424242424242 and CVV 123, password: hunter22, for 4 guests on 2024-07-20", "Confirm order", empty);
  for (const secret of ["4242424242424242", "123", "hunter22"]) assert.equal(new RegExp(`(?<!\\w)${secret}(?!\\w)`).test(text), false, `${secret} leaked:\n${text}`);
  assert.match(text, /4 guests on 2024-07-20/);
});

test("values typed into secret fields earlier stay hidden in later checks", () => {
  const text = commitPrompt("Log in as ana", "Sign in", { title: "Welcome", url: "https://x.com/home", fields: [], text: "Your passphrase s3cret-River is saved" }, ["s3cret-River"]);
  assert.equal(text.includes("s3cret-River"), false, text);
});

test("safeTask keeps ordinary values", () => {
  assert.equal(safeTask('Book "The Royal Dine" for 4 on July 20, 2024 at 7 PM'), 'Book "The Royal Dine" for 4 on July 20, 2024 at 7 PM');
  assert.equal(safeTask("Use PIN 4821 and card 4111 1111 1111 1111"), "Use PIN [hidden] and card [number]");
});

test("task-only credentials are hidden before anything is typed", () => {
  const empty: Evidence = { title: "Integrations", url: "https://x.com/int", fields: [], text: "" };
  const cases = [
    "Delete the old integration, then recreate it with API token sk_live_1234567890abcdef123456",
    'Log in with {"password": "hunter22"}',
    "Use password 'hunter23' and PIN=4821",
    "Set the api key to abcDEF9 then save",
  ];
  for (const task of cases) {
    const text = commitPrompt(task, "Save", empty);
    for (const secret of ["sk_live_1234567890abcdef123456", "hunter22", "hunter23", "4821", "abcDEF9"]) {
      assert.equal(text.includes(secret), false, `${secret} leaked from: ${task}\n${text}`);
    }
  }
  assert.equal(safeTask("Book a table for 4 on July 20, 2024 at 7 PM"), "Book a table for 4 on July 20, 2024 at 7 PM");
});
