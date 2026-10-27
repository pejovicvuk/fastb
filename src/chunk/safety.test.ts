import { test } from "node:test";
import assert from "node:assert/strict";
import { riskyWord } from "./safety.ts";

test("finds risky actions", () => {
  assert.equal(riskyWord("Send"), "send");
  assert.equal(riskyWord("Delete account"), "delete");
  assert.equal(riskyWord("Place order"), "place order");
  assert.equal(riskyWord("Confirm booking"), "confirm booking");
  assert.equal(riskyWord("Cancel subscription"), "cancel subscription");
  assert.equal(riskyWord("Buy now"), "buy");
});

test("ignores safe controls and longer words", () => {
  for (const label of ["Compose", "Search", "Cancel", "Sender", "Deleted items", "Booking history", "Facebook", "Submit", "Payments"]) {
    assert.equal(riskyWord(label), null, label);
  }
});
