import http from "node:http";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test, type TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type CDPSession, type Page } from "playwright-core";
import { startWatch, type WatchLane } from "./server.ts";

class FakeSession extends EventEmitter {
  commands: { method: string; params: unknown }[] = [];
  detached = false;
  failStart = false;
  stopGate?: Promise<void>;
  async send(method: string, params?: unknown): Promise<void> {
    this.commands.push({ method, params });
    if (method === "Page.startScreencast" && this.failStart) throw new Error("Target closed");
    if (method === "Page.stopScreencast") await this.stopGate;
  }
  async detach(): Promise<void> {
    this.detached = true;
    this.emit("close");
  }
  frame(id: number): void { this.emit("Page.screencastFrame", { sessionId: id, data: `jpeg-${id}` }); }
}

function fakePage(attach?: () => Promise<FakeSession>) {
  const sessions: FakeSession[] = [];
  let closed = false;
  const page = {
    isClosed: () => closed,
    context: () => ({
      newCDPSession: async () => {
        const session = attach ? await attach() : new FakeSession();
        sessions.push(session);
        return session as unknown as CDPSession;
      },
    }),
  } as unknown as Page;
  return { page, sessions, close: () => { closed = true; } };
}

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 2_500;
  while (!predicate()) {
    assert.ok(performance.now() < deadline, message);
    await delay(10);
  }
}

async function connect(url: string, t: TestContext, timeout = 8_000) {
  const controller = new AbortController();
  const response = await fetch(`${url}events`, {
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)]),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type")!, /^text\/event-stream/);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  async function close() {
    controller.abort();
    await reader.cancel().catch(() => {});
  }
  t.after(close);
  return {
    close,
    async next(): Promise<{ event: string; data: unknown }> {
      for (;;) {
        const end = buffer.indexOf("\n\n");
        if (end !== -1) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (block.startsWith(":")) continue;
          const [event, data] = block.split("\n");
          return { event: event.slice(7), data: JSON.parse(data.slice(6)) };
        }
        const { done, value } = await reader.read();
        assert.equal(done, false, "SSE ended before the expected event");
        buffer += decoder.decode(value, { stream: true });
      }
    },
  };
}

test("serves a local self-contained grid and waits for viewers before capture", async (t) => {
  const lane = fakePage();
  const watch = await startWatch({ lanes: () => [{ name: "a", page: lane.page, state: "idle" }] });
  t.after(() => watch.close());
  assert.match(watch.url, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\/$/);
  // Without the secret path, or for another host name, nothing is served.
  const root = new URL(watch.url).origin + "/";
  assert.equal((await fetch(root)).status, 404);
  assert.equal((await fetch(`${root}events`)).status, 404);
  const response = await fetch(watch.url);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /new EventSource\('events'\)/);
  assert.match(html, /grid-template-columns/);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=/);
  assert.equal((await fetch(`${watch.url}missing`)).status, 404);
  assert.equal((await fetch(watch.url, { method: "POST" })).status, 404);
  // A web page that rebinds its own name to 127.0.0.1 sends its own Host or Origin: refused.
  const status = (headers: Record<string, string>) =>
    new Promise<number>((resolve, reject) => {
      const u = new URL(`${watch.url}events`);
      http.get({ host: "127.0.0.1", port: u.port, path: u.pathname, headers }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      }).on("error", reject);
    });
  const port = new URL(watch.url).port;
  assert.equal(await status({ host: `evil.example:${port}` }), 403);
  assert.equal(await status({ host: `127.0.0.1:${port}`, origin: "http://evil.example" }), 403);
  await delay(550);
  assert.equal(lane.sessions.length, 0);
});

test("acks every frame, throttles to the latest picture, and shares cached frames", async (t) => {
  const lane = fakePage();
  const watch = await startWatch({ lanes: () => [{ name: "a", page: lane.page, state: "running", step: 'click "Checkout"' }] });
  t.after(() => watch.close());
  const first = await connect(watch.url, t);
  assert.deepEqual(await first.next(), {
    event: "lanes", data: [{ name: "a", state: "running", step: 'click "Checkout"' }],
  });
  await waitFor(() => lane.sessions.length === 1, "one CDP session should start");
  const session = lane.sessions[0];
  assert.deepEqual(session.commands[0], {
    method: "Page.startScreencast", params: { format: "jpeg", quality: 50, maxWidth: 640, maxHeight: 400 },
  });
  for (let id = 0; id < 20; id++) session.frame(id);
  assert.equal(session.commands.filter((command) => command.method === "Page.screencastFrameAck").length, 20);
  assert.deepEqual(await first.next(), { event: "frame", data: { lane: "a", jpegBase64: "jpeg-0" } });
  const second = await connect(watch.url, t);
  assert.equal((await second.next()).event, "lanes");
  assert.deepEqual(await second.next(), { event: "frame", data: { lane: "a", jpegBase64: "jpeg-0" } });
  assert.equal(lane.sessions.length, 1, "viewers must share capture");
  assert.deepEqual(await first.next(), { event: "frame", data: { lane: "a", jpegBase64: "jpeg-19" } });
  assert.deepEqual(await second.next(), { event: "frame", data: { lane: "a", jpegBase64: "jpeg-19" } });
  await delay(210);
  session.frame(20);
  assert.deepEqual(await first.next(), { event: "frame", data: { lane: "a", jpegBase64: "jpeg-20" } });
  assert.deepEqual(await second.next(), { event: "frame", data: { lane: "a", jpegBase64: "jpeg-20" } });
  await first.close();
  assert.equal(session.detached, false, "the other viewer still needs capture");
  await second.close();
  await waitFor(() => session.detached, "last disconnect should stop capture");
  assert.equal(session.listenerCount("Page.screencastFrame"), 0);
  const third = await connect(watch.url, t);
  await third.next();
  await waitFor(() => lane.sessions.length === 2, "reconnect should restart capture");
});

test("polls state changes, page replacement, closed pages, removal, and source failures", async (t) => {
  const first = fakePage(), replacement = fakePage();
  let lanes: WatchLane[] = [{ name: "lane", page: first.page, state: "idle" }];
  let fail = false;
  const watch = await startWatch({ lanes: () => {
    if (fail) throw new Error("source temporarily unavailable");
    return lanes;
  } });
  t.after(() => watch.close());
  const viewer = await connect(watch.url, t);
  await viewer.next();
  await waitFor(() => first.sessions.length === 1, "first page capture");
  lanes[0].page = replacement.page;
  lanes[0].state = "ok";
  lanes[0].step = "done";
  assert.deepEqual(await viewer.next(), {
    event: "lanes", data: [{ name: "lane", state: "ok", step: "done" }],
  });
  await waitFor(() => replacement.sessions.length === 1 && first.sessions[0].detached, "replace and release page");
  fail = true;
  replacement.close();
  await waitFor(() => replacement.sessions[0].detached, "closed pages stop even if the source throws");
  assert.equal((await fetch(watch.url)).status, 200);
  fail = false;
  lanes = [];
  assert.deepEqual(await viewer.next(), { event: "lanes", data: [] });
});

test("a failed screencast detaches and can recover on a later poll", async (t) => {
  let attempts = 0;
  const lane = fakePage(async () => {
    const session = new FakeSession();
    session.failStart = attempts++ === 0;
    return session;
  });
  const watch = await startWatch({ lanes: () => [{ name: "a", page: lane.page, state: "idle" }] });
  t.after(() => watch.close());
  await connect(watch.url, t);
  await waitFor(() => lane.sessions.length >= 2, "next poll should retry the failed capture");
  assert.equal(lane.sessions[0].detached, true);
  assert.equal(lane.sessions[1].detached, false);
  await watch.close();
  assert.equal(lane.sessions[1].detached, true);
  await watch.close();
});

test("close waits for a pending CDP attachment and cleans it up", async (t) => {
  const attached = Promise.withResolvers<FakeSession>();
  let attaching = false;
  const lane = fakePage(() => { attaching = true; return attached.promise; });
  const watch = await startWatch({ lanes: () => [{ name: "a", page: lane.page, state: "idle" }] });
  t.after(() => watch.close());
  await connect(watch.url, t);
  await waitFor(() => attaching, "attachment should be pending");
  const closed = watch.close();
  const session = new FakeSession();
  attached.resolve(session);
  await closed;
  assert.equal(session.detached, true);
  assert.equal(session.commands.some((command) => command.method === "Page.startScreencast"), false);
});

test("a fast viewer reconnect waits for the previous screencast to stop", async (t) => {
  const stopped = Promise.withResolvers<void>();
  const lane = fakePage(async () => {
    const session = new FakeSession();
    session.stopGate = stopped.promise;
    return session;
  });
  const watch = await startWatch({ lanes: () => [{ name: "a", page: lane.page, state: "idle" }] });
  t.after(() => { stopped.resolve(); return watch.close(); });
  const first = await connect(watch.url, t);
  await waitFor(() => lane.sessions.length === 1, "first capture should attach");
  await first.close();
  await waitFor(() => lane.sessions[0].commands.some((command) => command.method === "Page.stopScreencast"),
    "the previous session should be stopping");
  const second = await connect(watch.url, t);
  await second.next();
  assert.equal(lane.sessions.length, 1, "replacement must wait until stop completes");
  stopped.resolve();
  await waitFor(() => lane.sessions.length === 2, "replacement should attach after stop");
  assert.equal(lane.sessions[0].detached, true);
  assert.equal(lane.sessions[1].commands[0].method, "Page.startScreencast");
});

test("real headless Chrome streams both lanes within 5 s and renders the grid", { timeout: 30_000 }, async (t) => {
  const browser = await chromium.launch({ channel: "chrome", headless: true }).catch(() => undefined);
  if (!browser) return t.skip("Chrome cannot start");
  t.after(() => browser.close());
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  await Promise.all([first.setContent('<body style="background:navy;color:white">Alpha</body>'),
    second.setContent('<body style="background:green;color:white">Beta</body>')]);
  const lanes: WatchLane[] = [
    { name: "Alpha <script>bad</script>", page: first, state: "running", step: 'click "Checkout"' },
    { name: "Beta", page: second, state: "ok", step: "Done" },
  ];
  const watch = await startWatch({ lanes: () => lanes });
  t.after(() => watch.close());
  const started = performance.now();
  const viewer = await connect(watch.url, t, 5_000);
  assert.deepEqual((await viewer.next()).data, lanes.map(({ name, state, step }) => ({ name, state, step })));
  const received = new Set<string>();
  while (received.size < 2) {
    const message = await viewer.next();
    if (message.event !== "frame") continue;
    const frame = message.data as { lane: string; jpegBase64: string };
    assert.ok(lanes.some((lane) => lane.name === frame.lane));
    assert.equal(Buffer.from(frame.jpegBase64, "base64").subarray(0, 2).toString("hex"), "ffd8");
    received.add(frame.lane);
  }
  assert.ok(performance.now() - started < 5_000, "both lane frames must arrive within 5 s");
  const monitor = await browser.newPage();
  await monitor.goto(watch.url);
  await monitor.waitForFunction(() => document.querySelectorAll('.tile img:not([hidden])').length === 2);
  assert.deepEqual(await monitor.locator(".tile h2").allTextContents(), lanes.map((lane) => lane.name));
  assert.equal(await monitor.locator(".tile script").count(), 0);
  assert.deepEqual(await monitor.locator(".badge").allTextContents(), ["running", "ok"]);
  await monitor.setViewportSize({ width: 360, height: 700 });
  assert.equal(await monitor.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  lanes.pop();
  await monitor.waitForFunction(() => document.querySelectorAll('.tile').length === 1);
});
