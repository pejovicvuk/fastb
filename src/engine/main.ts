import { createServer, type Socket } from "node:net";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { HOME, SHOTS_DIR, SOCKET } from "../paths.ts";
import type { Request, Response } from "../protocol.ts";
import { Session } from "../browser/session.ts";
import { settle } from "../browser/settle.ts";
import { look, pageHeader } from "../snapshot/look.ts";
import { forgetView, runReport, showChanges, showPage } from "./view.ts";
import { appendStat, type StatRow } from "./stats.ts";
import { lockPort, takeLock } from "./lock.ts";
import { withScheme } from "../browser/url.ts";
import { parseChunk, ParseError } from "../chunk/parse.ts";
import { runChunk } from "../chunk/run.ts";

const IDLE_EXIT_MS = 30 * 60 * 1000;

const session = new Session();
let queue: Promise<unknown> = Promise.resolve();
let idleTimer: NodeJS.Timeout | undefined;

type Handled = Response & { stat?: Partial<StatRow> };

async function handle(req: Request): Promise<Handled> {
  switch (req.cmd) {
    case "open": {
      const url = req.args[0];
      if (!url) return fail("usage: fastb open <url>");
      const page = await session.page(req.options);
      await page.goto(withScheme(url), { waitUntil: "domcontentloaded", timeout: 30000 });
      await settle(page);
      if (req.flags.quiet) {
        forgetView();
        return ok(`opened ${page.url()}`);
      }
      return ok(await showPage(page)); // the agent always looks after opening: save it a turn
    }
    case "look": {
      const page = await session.page(req.options);
      await settle(page, { maxMs: 3000 });
      let text = req.flags.full ? await look(page, { full: true }) : await showPage(page);
      if (req.flags.shot) {
        mkdirSync(SHOTS_DIR, { recursive: true });
        const file = join(SHOTS_DIR, `${Date.now()}.png`);
        await page.screenshot({ path: file });
        text += `\nscreenshot: ${file}`;
      }
      return ok(text);
    }
    case "run": {
      let steps;
      try {
        steps = parseChunk(req.args.join("\n"));
      } catch (err) {
        if (err instanceof ParseError) return fail(`not run: ${err.message}`);
        throw err;
      }
      if (!steps.length) return fail("not run: the chunk has no steps");
      const result = await runChunk(() => session.page(req.options), steps);
      const report = await runReport(result, async () => {
        const page = await session.page(req.options);
        return req.flags["no-look"] ? { text: await pageHeader(page) } : showChanges(page);
      });
      return { ok: result.ok, text: report.text, stat: { steps: result.total, done: result.done, full: report.full } };
    }
    case "status":
      return ok(`engine: running (pid ${process.pid})\n${session.describe()}`);
    case "stop":
      await session.close(); // Chrome must release the profile before the CLI may start a new engine
      setTimeout(shutdown, 10);
      return ok("engine: stopped");
    default:
      return fail(`unknown command: ${req.cmd}`);
  }
}

const ok = (text: string): Response => ({ ok: true, text });
const firstLine = (err: unknown) => (err instanceof Error ? err.message : String(err)).split("\n")[0];
const fail = (text: string): Response => ({ ok: false, text });

function onConnection(sock: Socket): void {
  let buf = "";
  sock.setEncoding("utf8");
  sock.on("data", (chunk) => {
    buf += chunk;
    const nl = buf.indexOf("\n");
    if (nl < 0) return;
    const line = buf.slice(0, nl);
    buf = "";
    resetIdle();
    // One command at a time: the browser is shared state.
    queue = queue.then(async () => {
      const started = Date.now();
      let req: Request | undefined;
      let res: Handled;
      try {
        req = JSON.parse(line) as Request;
        res = await handle(req);
      } catch (err) {
        res = fail(`error: ${firstLine(err)}`);
      }
      const { stat, ...reply } = res;
      sock.end(JSON.stringify(reply) + "\n");
      if (req && req.cmd !== "status" && req.cmd !== "stop") {
        appendStat({ t: new Date(started).toISOString(), cmd: req.cmd, ok: res.ok, ms: Date.now() - started, out: res.text.length, ...stat });
      }
    });
  });
  sock.on("error", () => {});
}

function resetIdle(): void {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(shutdown, IDLE_EXIT_MS);
}

async function shutdown(): Promise<void> {
  await session.close();
  server.close();
  rmSync(SOCKET, { force: true });
  process.exit(0);
}

mkdirSync(HOME, { recursive: true });
const port = lockPort(HOME);
if (!(await takeLock(port))) {
  // Another engine runs or is starting; the CLI connects to that one.
  // (If some other program uses this port, set FASTB_LOCK_PORT.)
  console.error(`fastb engine: lock port ${port} is taken; exiting (pid ${process.pid})`);
  process.exit(0);
}
rmSync(SOCKET, { force: true }); // we hold the lock: any socket left here is stale
const server = createServer(onConnection);
server.listen(SOCKET, () => console.error(`fastb engine listening on ${SOCKET} (pid ${process.pid})`));
resetIdle();
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
process.on("unhandledRejection", (err) => console.error("unhandled rejection:", err));
process.on("uncaughtException", (err) => console.error("uncaught exception:", err));
process.on("exit", (code) => console.error(`fastb engine exit (code ${code})`));
