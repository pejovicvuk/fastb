import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import type { CDPSession, Page } from "playwright-core";
import { watchHtml } from "./html.ts";
import { diffLanePages, shouldForwardFrame, sseMessage } from "./logic.ts";

export interface WatchLane {
  name: string;
  page?: Page;
  state: "idle" | "running" | "ok" | "stopped";
  step?: string;
}

export interface WatchSource { lanes(): WatchLane[] }

interface Client {
  response: ServerResponse;
  needsLanes: boolean;
}

interface Cast {
  page: Page;
  ready: Promise<void>;
  stopped: boolean;
  stop?: Promise<void>;
  session?: CDPSession;
  onFrame?: (frame: { sessionId: number; data: string }) => void;
  onClose?: () => void;
  lastSent?: number;
  frame?: string;
  pendingFrame?: string;
  frameTimer?: ReturnType<typeof setTimeout>;
}

export async function startWatch(
  source: WatchSource,
  opts?: { port?: number },
): Promise<{ url: string; close(): Promise<void> }> {
  const clients = new Set<Client>();
  const casts = new Map<string, Cast>();
  const stoppingPages = new Map<Page, Promise<void>>();
  let lanes: WatchLane[] = [];
  let laneMessage = sseMessage("lanes", []);
  let closing = false;
  let closePromise: Promise<void> | undefined;

  // A slow viewer must not build an unbounded queue or delay the browser.
  function write(client: Client, message: string): void {
    if (!client.response.destroyed && !client.response.writableEnded) client.response.write(message);
  }

  function sendLanes(client: Client): void {
    client.needsLanes = client.response.writableNeedDrain;
    if (!client.needsLanes) write(client, laneMessage);
  }

  function stopCast(name: string, cast: Cast): Promise<void> {
    if (cast.stop) return cast.stop;
    cast.stopped = true;
    clearTimeout(cast.frameTimer);
    cast.pendingFrame = undefined;
    if (casts.get(name) === cast) casts.delete(name);
    cast.stop = (async () => {
      await cast.ready.catch(() => {});
      const session = cast.session;
      if (!session) return;
      if (cast.onFrame) session.off("Page.screencastFrame", cast.onFrame);
      if (cast.onClose) session.off("close", cast.onClose);
      try {
        await session.send("Page.stopScreencast").catch(() => {});
      } finally {
        await session.detach().catch(() => {});
      }
    })();
    stoppingPages.set(cast.page, cast.stop);
    void cast.stop.then(() => {
      if (stoppingPages.get(cast.page) === cast.stop) stoppingPages.delete(cast.page);
    });
    return cast.stop;
  }

  function startCast(name: string, page: Page): void {
    // A reconnect can happen while the old session is still stopping. Do not let
    // its Page.stopScreencast stop the new session on the same target.
    const previousStop = stoppingPages.get(page);
    const cast: Cast = { page, ready: Promise.resolve(), stopped: false };
    casts.set(name, cast);
    cast.ready = (async () => {
      await previousStop;
      if (cast.stopped || closing || page.isClosed()) return;
      const session = await page.context().newCDPSession(page);
      cast.session = session;
      if (cast.stopped || closing || page.isClosed()) return;
      const forwardFrame = () => {
        cast.frameTimer = undefined;
        if (cast.stopped || closing || clients.size === 0 || cast.pendingFrame === undefined) return;
        const now = performance.now();
        if (!shouldForwardFrame(cast.lastSent, now)) {
          cast.frameTimer = setTimeout(forwardFrame, 200 - (now - cast.lastSent!));
          return;
        }
        cast.lastSent = now;
        // Keep base64 as supplied by CDP; encode once for all viewers.
        cast.frame = sseMessage("frame", { lane: name, jpegBase64: cast.pendingFrame });
        cast.pendingFrame = undefined;
        for (const client of clients) {
          if (!client.response.writableNeedDrain && !client.needsLanes) write(client, cast.frame);
        }
      };
      cast.onFrame = (frame) => {
        // Ack even discarded frames. CDP otherwise stalls the producer.
        void session.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {});
        if (cast.stopped || closing || clients.size === 0) return;
        // Replace, never queue: one pending frame also preserves the final picture
        // if the page becomes still during the throttle interval.
        cast.pendingFrame = frame.data;
        if (!cast.frameTimer) forwardFrame();
      };
      cast.onClose = () => { void stopCast(name, cast); };
      session.on("Page.screencastFrame", cast.onFrame);
      session.once("close", cast.onClose);
      await session.send("Page.startScreencast", {
        format: "jpeg", quality: 50, maxWidth: 640, maxHeight: 400,
      });
    })();
    // Target closure and unsupported CDP targets are recoverable on the next poll.
    void cast.ready.catch(() => stopCast(name, cast));
  }

  function poll(): void {
    if (closing) return;
    try {
      try {
        // Copy records because the engine may update its lane objects in place.
        lanes = source.lanes().map(({ name, page, state, step }) => ({ name, page, state, step }));
      } catch {
        // Retain the last list during a transient source failure.
      }
      const nextMessage = sseMessage("lanes", lanes.map(({ name, state, step }) => ({ name, state, step })));
      if (nextMessage !== laneMessage) {
        laneMessage = nextMessage;
        for (const client of clients) sendLanes(client);
      }
      const desired = new Map<string, Page>();
      if (clients.size > 0) {
        for (const lane of lanes) {
          if (lane.page && !lane.page.isClosed()) desired.set(lane.name, lane.page);
        }
      }
      const diff = diffLanePages(new Map([...casts].map(([name, cast]) => [name, cast.page])), desired);
      for (const name of diff.stop) void stopCast(name, casts.get(name)!);
      for (const name of diff.start) startCast(name, desired.get(name)!);
    } catch {
      // Watching is best effort; it must never throw into the engine's poll loop.
    }
  }

  // Access: a secret path (other local users and programs cannot guess it) and the
  // Host and Origin must be this server (blocks DNS rebinding from web pages).
  const key = randomBytes(16).toString("hex");
  const base = `/${key}/`;
  let port = 0;
  const local = (value: string | undefined, withScheme: boolean) =>
    value !== undefined && [`127.0.0.1:${port}`, `localhost:${port}`].some((h) => value === (withScheme ? `http://${h}` : h));
  const allowed = (request: IncomingMessage) =>
    local(request.headers.host, false) && (request.headers.origin === undefined || local(request.headers.origin, true));

  const server = createServer((request, response) => {
    if (closing) {
      response.writeHead(503).end();
    } else if (!allowed(request)) {
      response.writeHead(403).end("Forbidden\n");
    } else if (request.method === "GET" && request.url === base) {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      response.end(watchHtml);
    } else if (request.method === "GET" && request.url === `${base}events`) {
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });
      response.flushHeaders();
      const client: Client = { response, needsLanes: false };
      const remove = () => {
        clients.delete(client);
        if (clients.size === 0) poll();
      };
      response.on("close", remove);
      response.on("error", () => { response.destroy(); remove(); });
      response.on("drain", () => { if (client.needsLanes) sendLanes(client); });
      // Read the source before adding a viewer so metadata always precedes frames.
      poll();
      clients.add(client);
      sendLanes(client);
      for (const cast of casts.values()) {
        if (cast.frame && !response.writableNeedDrain) write(client, cast.frame);
      }
      poll();
    } else {
      response.writeHead(404).end("Not found\n");
    }
  });

  server.listen(opts?.port ?? 0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Watch server has no TCP address");
  port = address.port;
  poll();
  const timer = setInterval(poll, 500);
  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (!client.response.writableNeedDrain) write(client, ": keepalive\n\n");
    }
  }, 15_000);

  return {
    url: `http://127.0.0.1:${address.port}${base}`,
    close() {
      closePromise ??= (async () => {
        closing = true;
        clearInterval(timer);
        clearInterval(heartbeat);
        for (const client of clients) client.response.end();
        clients.clear();
        const stopped = [...casts].map(([name, cast]) => stopCast(name, cast));
        const serverClosed = new Promise<void>((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        });
        // Also release slow SSE readers and HTTP keep-alive sockets.
        server.closeAllConnections();
        await Promise.all([...stopped, ...stoppingPages.values(), serverClosed]);
      })();
      return closePromise;
    },
  };
}
