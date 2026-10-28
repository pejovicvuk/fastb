import { test } from "node:test";
import assert from "node:assert/strict";
import { compact, parseSnapshot } from "./compact.ts";

const run = (yaml: string) => compact(parseSnapshot(yaml.trim()));

test("flattens nameless wrappers and keeps refs on actionable nodes", () => {
  const out = run(`
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - textbox "Email" [ref=e5]
    - button "Save" [ref=e6] [cursor=pointer]
`);
  assert.deepEqual(out, ['@e5 textbox "Email"', '@e6 button "Save"']);
});

test("merges a plain text block into one line and drops separators", () => {
  const out = run(`
- generic [ref=e1]:
  - heading [level=6] [ref=e2]: Little Caesars
  - paragraph [ref=e3]: •
  - paragraph [ref=e4]: 0.3 mi
`);
  assert.deepEqual(out, ["Little Caesars · 0.3 mi"]);
});

test("a clickable card becomes one ref line with its text", () => {
  const out = run(`
- generic [ref=e2808] [cursor=pointer]:
  - heading [level=6] [ref=e2812]: Little Caesars
  - generic [ref=e2815]:
    - heading [level=6] [ref=e2817]: "4.3"
    - paragraph [ref=e2820]: •
    - paragraph [ref=e2821]: 29 min
`);
  assert.deepEqual(out, ['@e2808 "Little Caesars · 4.3 · 29 min"']);
});

test("shows input values and state", () => {
  const out = run(`
- textbox "Email" [ref=e5]: user@x.com
- checkbox "Subscribe" [checked] [ref=e7]
- button "Pay" [disabled] [ref=e8]
`);
  assert.deepEqual(out, [
    '@e5 textbox "Email" = "user@x.com"',
    '@e7 checkbox "Subscribe" [checked]',
    '@e8 button "Pay" [disabled]',
  ]);
});

test("keeps a header for sections that hold actions", () => {
  const out = run(`
- dialog "Add item" [ref=e1]:
  - generic [ref=e2]: Choose a size
  - radio "Small" [ref=e3]
`);
  assert.deepEqual(out, ['dialog "Add item":', '  @e2 "Choose a size"', '  @e3 radio "Small"']);
});

test("parses keys that YAML wrapped in single quotes", () => {
  const out = run(`
- 'button "Delivery Fees: Under $3" [ref=e1824] [cursor=pointer]':
  - generic [ref=e1825]: Delivery Fees
`);
  assert.deepEqual(out, ['@e1824 button "Delivery Fees: Under $3"']);
});

test("drops image names when the block has other text", () => {
  const out = run(`
- generic [ref=e1] [cursor=pointer]:
  - img "Image Wingstop" [ref=e2]
  - heading [level=6] [ref=e3]: Wingstop
- generic [ref=e4]:
  - img "Company logo" [ref=e5]
`);
  assert.deepEqual(out, ['@e1 "Wingstop"', "Company logo"]);
});

test("keeps the ref on a short standalone label next to actions", () => {
  const out = run(`
- navigation "Mailbox" [ref=e68]:
  - generic [ref=e70]: Compose
  - menuitem "Inbox" [ref=e75] [cursor=pointer]
`);
  assert.deepEqual(out, ['navigation "Mailbox":', '  @e70 "Compose"', '  @e75 menuitem "Inbox"']);
});

test("drops nameless clickable boxes", () => {
  const out = run(`
- generic [ref=e1]:
  - generic [ref=e21] [cursor=pointer]
  - button "Go" [ref=e22]
`);
  assert.deepEqual(out, ['@e22 button "Go"']);
});

test("uses placeholder text as the name of an unlabeled field", () => {
  const out = run(`
- textbox [ref=e135]:
  - /placeholder: Subject
- textbox "Email" [ref=e136]:
  - /placeholder: you@example.com
`);
  assert.deepEqual(out, ['@e135 textbox "Subject"', '@e136 textbox "Email"']);
});

test("ignores property lines and handles escaped quotes", () => {
  const out = run(`
- link "Say \\"hi\\"" [ref=e1] [cursor=pointer]:
  - /url: /hello
`);
  assert.deepEqual(out, ['@e1 link "Say \\"hi\\""']);
});

test("keeps every row of a long static table and exposes a last-row change", () => {
  const table = (lastStatus: string) => `
- table "Invoices":
  - rowgroup:
${Array.from({ length: 12 }, (_, i) => `    - row:
      - cell: Invoice ${i + 1}
      - cell: $100.00
      - cell: ${i === 11 ? lastStatus : "unpaid"}`).join("\n")}
`;
  const before = run(table("unpaid"));
  const after = run(table("paid"));
  assert.deepEqual(before, [
    "Invoices",
    ...Array.from({ length: 12 }, (_, i) => `    Invoice ${i + 1} · $100.00 · unpaid`),
  ]);
  assert.deepEqual(after.slice(0, -1), before.slice(0, -1));
  assert.equal(after.at(-1), "    Invoice 12 · $100.00 · paid");
  assert.notDeepEqual(after, before);
});

test("splits a long static block into one line per paragraph", () => {
  const paragraphs = Array.from({ length: 8 }, (_, i) =>
    `Paragraph ${i + 1} contains useful page content.`,
  );
  const out = run(`
- generic:
${paragraphs.map((text) => `  - paragraph: ${text}`).join("\n")}
`);
  assert.deepEqual(out, paragraphs.map((text) => `  ${text}`));
});

test("keeps all cells of a long row; only the long cell is cut", () => {
  const description = "Invoice description ".repeat(12).trim();
  const out = run(`
- table:
  - row:
    - cell: ${description}
    - cell: $500.00
    - cell: paid
`);
  assert.deepEqual(out, [`  ${description.slice(0, 159)}… · $500.00 · paid`]);
});

test("splits at a custom maxText and still clips a long leaf", () => {
  const out = compact(parseSnapshot(`
- generic:
  - paragraph: first paragraph
  - paragraph: second paragraph
- paragraph: ${"x".repeat(40)}
`), { maxText: 20 });
  assert.deepEqual(out, ["  first paragraph", "  second paragraph", `${"x".repeat(19)}…`]);
});

test("keeps heading and alert prefixes when splitting their children", () => {
  for (const [role, prefix] of [["heading", "# "], ["alert", "! "]]) {
    const first = "First part ".repeat(10).trim();
    const second = "Second part ".repeat(10).trim();
    assert.deepEqual(run(`
- ${role}:
  - text: ${first}
  - text: ${second}
`), [`  ${prefix}${first}`, `  ${second}`]);
  }
});

test("keeps short standalone label refs after splitting a long block", () => {
  const labels = Array.from({ length: 12 }, (_, i) => `Standalone label ${i + 1}`);
  const out = run(`
- generic:
${labels.map((text, i) => `  - generic [ref=e${i + 1}]: ${text}`).join("\n")}
`);
  assert.deepEqual(out, labels.map((text, i) => `  @e${i + 1} ${JSON.stringify(text)}`));
});

test("named icons inside one clickable box keep their own refs", () => {
  const out = run(`
- generic [ref=e837] [cursor=pointer]:
  - generic "Mark as read" [ref=e838]
  - generic "Snooze" [ref=e839]
  - generic "Add to tasks" [ref=e840]
`);
  assert.deepEqual(out, ["@e837", '  @e838 "Mark as read"', '  @e839 "Snooze"', '  @e840 "Add to tasks"']);
});

test("a card with one named image stays one line", () => {
  const out = run(`
- generic [ref=e1] [cursor=pointer]:
  - img "Pizza" [ref=e2]
  - heading [level=6] [ref=e3]: Little Caesars
`);
  assert.deepEqual(out, ['@e1 "Little Caesars"']);
});

test("a nameless field shows its text as a value, not as a name", () => {
  const out = run(`
- textbox [ref=e77]: "+1"
- combobox [ref=e83]
`);
  assert.deepEqual(out, ['@e77 textbox = "+1"', "@e83 combobox"]);
});
