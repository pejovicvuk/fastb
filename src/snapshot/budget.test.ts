import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetView } from "./budget.ts";

const size = (l: string[]) => l.reduce((n, x) => n + x.length + 1, 0);
const listing = (i: number) => [`    @e${i}0`, `      @e${i}1 link "House ${i}, Main St"`, `      @e${i}2 "$${i}00,000"`, `      @e${i}3 button "Save this home"`];

test("a small page is not touched", () => {
  const lines = ['@e1 button "Go"', "Hello"];
  assert.deepEqual(budgetView(lines, 100), lines);
});

test("the biggest run of similar items keeps its first items and says how many are hidden", () => {
  const lines = ['@e1 textbox "Search"', 'list "Homes":', ...Array.from({ length: 40 }, (_, i) => listing(i + 1).map((l) => l.slice(2))).flat(), '@e9 button "Next page"'];
  const out = budgetView(lines, 1200);
  assert.ok(size(out) <= 1200, `size ${size(out)}`);
  assert.equal(out[0], '@e1 textbox "Search"');
  assert.ok(out.includes('    @e11 link "House 1, Main St"'));
  assert.ok(!out.some((l) => l.includes("House 40")));
  assert.ok(out.some((l) => /^  \[\+\d+ more like this; fastb look --all shows all\]$/.test(l)));
  assert.equal(out.at(-1), '@e9 button "Next page"'); // what comes after the list stays
});

test("repeated named controls fold to one line that keeps every ref; nameless ones keep their lines", () => {
  const lines = ['@e1 "Breakfast"', '@e2 "Pizza"', '@e3 "Breakfast"', '@e4 "Pizza"', "@e5 button", "@e6 button", "x".repeat(200)];
  const out = budgetView(lines, 100);
  assert.deepEqual(out.slice(0, 4), ['@e1 "Breakfast"  (same: @e3)', '@e2 "Pizza"  (same: @e4)', "@e5 button", "@e6 button"]);
});

test("a protected item stays and the marker still counts only hidden items", () => {
  const card = (i: number, extra = "") => [`  @e${i}0 link "Card ${i} with a name"`, `    @e${i}1 button "Open card ${i}"${extra}`];
  const lines = ["list:", ...card(1), ...card(2), ...card(3), ...card(4, " [pressed invalid]"), ...card(5), ...card(6), ...card(7), "x".repeat(300)];
  const out = budgetView(lines, 200);
  assert.ok(out.includes('    @e41 button "Open card 4" [pressed invalid]'));
  assert.ok(!out.includes('  @e50 link "Card 5 with a name"'));
  const marks = out.filter((l) => l.includes("more like this"));
  assert.equal(marks.length, 1);
  assert.match(marks[0], /\+3 more/); // cards 5, 6, 7 (card 4 is shown)
});

test("form fields, the checked choice and the changes the agent is told about are never cut", () => {
  const fields = Array.from({ length: 12 }, (_, i) => `@e${i} textbox "Field ${i} of a long form"`);
  const boxes = Array.from({ length: 12 }, (_, i) => `  @e${i + 50} checkbox "Option ${i} in a long list"${i === 9 ? " [checked]" : ""}`);
  const rows = Array.from({ length: 12 }, (_, i) => `  @e${i + 80} link "Row ${i} of the results table"`);
  const out = budgetView([...fields, "list:", ...boxes, "table:", ...rows], 600, new Set([rows[11]]));
  for (const f of fields) assert.ok(out.includes(f), f);
  assert.ok(out.includes(boxes[9]));
  assert.ok(out.includes(rows[11]));
  assert.ok(!out.includes(rows[8]));
});

test("a dialog, an alert and an invalid field are never cut", () => {
  const items = Array.from({ length: 30 }, (_, i) => `  @e${i + 10} link "Item ${i}"`);
  const lines = ['dialog "Checkout":', ...items, "list:", ...items.map((l) => l.replace("Item", "Other")), '  @e99 textbox "Phone" [invalid]', "! Payment failed"];
  const out = budgetView(lines, 400);
  for (const l of items) assert.ok(out.includes(l), l);
  assert.ok(out.includes('  @e99 textbox "Phone" [invalid]'));
  assert.ok(out.includes("! Payment failed"));
  assert.ok(!out.includes('  @e39 link "Other 29"'));
});

test("a run inside an item another run hid does not stop the cutting", () => {
  const region = (r: number, n: number) => [`region "R${r}":`, ...Array.from({ length: n }, (_, i) => `  @e${r}x${i} link "Link ${i} in region ${r} with a long name"`)];
  const lines = Array.from({ length: 6 }, (_, r) => region(r, r < 3 ? 20 : 24)).flat();
  const out = budgetView(lines, 1500);
  assert.ok(size(out) <= 1500, `size ${size(out)}`);
});

test("page chrome folds last, to one line, but never inside a dialog", () => {
  const nav = Array.from({ length: 5 }, (_, i) => `  @e${i} link "Section ${i} with a long name to fill the line"`);
  const lines = ['navigation "Main":', ...nav, "# Title", "Body text"];
  const out = budgetView(lines, 120);
  assert.deepEqual(out, ['navigation "Main":', "  [5 lines hidden; fastb look --all shows them]", "# Title", "Body text"]);
  const inDialog = ['dialog "Menu":', ...[...lines.slice(0, 6)].map((l) => "  " + l)];
  assert.deepEqual(budgetView(inDialog, 120), inDialog);
});
