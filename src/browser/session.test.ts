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

test("every page answers native dialogs through onDialog (main page, new tabs, lanes)", async (t) => {
  const probe = await chromium.launch({ channel: "chrome", headless: true }).catch(() => undefined);
  if (!probe) return t.skip("Chrome not installed");
  await probe.close();
  const session = new Session();
  const seen: string[] = [];
  session.onDialog = (_p, lane, d) => {
    seen.push(`${lane}:${d.type()}:${d.message()}`);
    void d.dismiss();
  };
  try {
    const main = await session.page({ headless: true, fresh: true });
    await main.setContent(`<button onclick="window.open('about:blank')">tab</button>`);
    assert.equal(await main.evaluate(() => confirm("main?")), false);
    const [tab] = await Promise.all([main.context().waitForEvent("page"), main.click("button")]);
    await tab.evaluate(() => alert("tab!"));
    const lane = await session.lane("x", { headless: true });
    assert.equal(await lane.evaluate(() => confirm("lane?")), false);
    assert.deepEqual(seen, [":confirm:main?", ":alert:tab!", "x:confirm:lane?"]);
  } finally {
    await session.close();
  }
});
