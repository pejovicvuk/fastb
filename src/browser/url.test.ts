import { test } from "node:test";
import assert from "node:assert/strict";
import { withScheme } from "./url.ts";

test("adds https only to bare host names", () => {
  assert.equal(withScheme("example.com/a"), "https://example.com/a");
  assert.equal(withScheme("http://localhost:3000"), "http://localhost:3000");
  assert.equal(withScheme("about:blank"), "about:blank");
  assert.equal(withScheme("data:text/html,<p>x</p>"), "data:text/html,<p>x</p>");
});
