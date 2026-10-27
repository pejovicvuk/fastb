import { createServer, type Socket } from "node:net";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";
import { HOME, SHOTS_DIR, SOCKET } from "../paths.ts";
import type { Request, Response } from "../protocol.ts";
import { Session } from "../browser/session.ts";
import { settle } from "../browser/settle.ts";
import { look, pageHeader, pageLines } from "../snapshot/look.ts";
import { diffPage } from "../snapshot/diff.ts";
import { appendStat, type StatRow } from "./stats.ts";
import { withScheme } from "../browser/url.ts";
import { parseChunk, ParseError } from "../chunk/parse.ts";
import { runChunk } from "../chunk/run.ts";

const IDLE_EXIT_MS = 30 * 60 * 1000;

// Changes are sent only when they are clearly shorter than the full page.
const DIFF_MAX_SHARE = 0.7;

const session = new Session();
let queue: Promise<unknown> = Promise.resolve();
let idleTimer: NodeJS.Timeout | undefined;
// The page as the agent last saw it: the base for "only what changed".
let seen: { page: Page; lines: string[] } | undefined;

type Handled = Response & { stat?: Partial<StatRow> };

async function showPage(page: Page): Promise<string> {
  const lines = await pageLines(page);
  seen = { page, lines };
  return `${await pageHeader(page)}\n${lines.join("\n")}`;
}

// After a chunk: only what changed since the agent last saw this page, or the
// full page when there is no base or the changes are not much shorter.
async function showChanges(page: Page): Promise<{ text: string; full?: number }> {
  const header = await pageHeader(page);
  const lines = await pageLines(page);
  const before = seen?.page === page ? seen.lines : undefined;
  seen = { page, lines };
  const fullText = `${header}\n${lines.join("\n")}`;
  if (!before) return { text: fullText };
  const d = diffPage(before, lines);
  const changes = d.lines.length
    ? `changes since the last view (+${d.added} -${d.removed} ~${d.changed}):\n${d.lines.join("\n")}`
    : "no changes on the page";
  const text = `${header}\n${changes}`;
  if (text.length > fullText.length * DIFF_MAX_SHARE) return { text: fullText };
  return { text, full: fullText.length };
}

async function handle(req: Request): Promise<Handled> {
  switch (req.cmd) {
    case "open": {
      const url = req.args[0];
      if (!url) return fail("usage: fastb open <url>");
      const page = await session.page(req.options);
      await page.goto(withScheme(url), { waitUntil: "domcontentloaded", timeout: 30000 });
      await settle(page);
      if (req.flags.quiet) {
        seen = undefined;
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
      const page = await session.page(req.options);
      const secs = (result.ms / 1000).toFixed(1);
      const lines: string[] = [];
      if (result.ok) lines.push(`OK ${result.done}/${result.total} steps ${secs}s`);
      else {
        const f = result.failure!;
        lines.push(`STOP at step ${f.index + 1}/${result.total}: ${f.source}`);
        lines.push(`reason: ${f.reason}`);
        if (f.choices) lines.push("choices (add #n to the target):", ...f.choices.map((c) => "  " + c));
        lines.push(result.done ? `done: steps 1-${result.done} in ${secs}s` : `done: none (${secs}s)`);
      }
      const view = req.flags["no-look"] ? { text: await pageHeader(page) } : await showChanges(page);
      lines.push(view.text);
      return { ok: result.ok, text: lines.join("\n"), stat: { steps: result.total, done: result.done, full: view.full } };
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
        res = fail(`error: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
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
rmSync(SOCKET, { force: true }); // the CLI only starts us when no engine answers
const server = createServer(onConnection);
server.listen(SOCKET, () => console.error(`fastb engine listening on ${SOCKET} (pid ${process.pid})`));
resetIdle();
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
process.on("unhandledRejection", (err) => console.error("unhandled rejection:", err));
process.on("uncaughtException", (err) => console.error("uncaught exception:", err));
process.on("exit", (code) => console.error(`fastb engine exit (code ${code})`));
