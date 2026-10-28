// Safety gate: a click on something that deletes, pays, orders, books or sends
// stops the chunk, unless the chunk has an "allow" line. The agent knows its task;
// the gate catches a click it did not mean.

const RISKY = new RegExp(
  "\\b(" +
    [
      "delete", "remove", "erase", "discard", "destroy", "trash",
      "pay", "purchase", "buy", "checkout", "check out", "place order", "order now",
      "submit order", "submit payment", "confirm (?:order|purchase|payment|booking|reservation)",
      "complete (?:order|purchase|payment|booking|reservation)",
      "book", "reserve", "send", "post", "publish", "transfer", "withdraw",
      "unsubscribe", "deactivate", "close account",
      "cancel (?:order|subscription|account|booking|reservation|ride)",
    ].join("|") +
    ")\\b",
  "i",
);

// Returns the risky word in a control's label, or null.
export function riskyWord(label: string): string | null {
  const m = RISKY.exec(label);
  return m ? m[1].toLowerCase() : null;
}
