import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { Session } from "./session.ts";

test("lanes that start together share one browser, and close frees it", async (t) => {
  const probe = await chromium.launch({ channel: "chrome", headless: true }).catch(() => undefined);
  if (!probe) return t.skip("Chrome not installed");
  await probe.close();
  const session = new Session();
  try {
    const pages = await Promise.all(["a", "b", "c", "d"].map((n) => session.lane(n, { headless: true, fresh: true })));
    assert.equal(new Set(pages.map((p) => p.context())).size, 4, "each lane has its own context");
    assert.equal(new Set(pages.map((p) => p.context().browser())).size, 1, "all lanes in one browser");
    assert.equal(await session.laneBrowserContexts(), 4);
    assert.equal(await session.closeLanes(), 4);
    assert.equal(await session.laneBrowserContexts(), 0);
    assert.equal(pages[0].context().browser()?.isConnected(), false, "the lanes browser is closed");
  } finally {
    await session.close();
  }
});
