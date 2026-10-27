import { createServer, type Socket } from "node:net";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { HOME, SHOTS_DIR, SOCKET } from "../paths.ts";
import type { Request, Response } from "../protocol.ts";
import { Session } from "../browser/session.ts";
import { settle } from "../browser/settle.ts";
import { look, pageHeader } from "../snapshot/look.ts";
import { withScheme } from "../browser/url.ts";
import { parseChunk, ParseError } from "../chunk/parse.ts";
import { runChunk } from "../chunk/run.ts";

const IDLE_EXIT_MS = 30 * 60 * 1000;

const session = new Session();
let queue: Promise<unknown> = Promise.resolve();
let idleTimer: NodeJS.Timeout | undefined;

async function handle(req: Request): Promise<Response> {
  switch (req.cmd) {
    case "open": {
      const url = req.args[0];
      if (!url) return fail("usage: fastb open <url>");
      const page = await session.page(req.options);
      await page.goto(withScheme(url), { waitUntil: "domcontentloaded", timeout: 30000 });
      await settle(page);
      if (req.flags.quiet) return ok(`opened ${page.url()}`);
      return ok(await look(page)); // the agent always looks after opening: save it a turn
    }
    case "look": {
      const page = await session.page(req.options);
      await settle(page, { maxMs: 3000 });
      let text = await look(page, { full: Boolean(req.flags.full) });
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
      // Phase 3 replaces the full page with only what changed.
      lines.push(req.flags["no-look"] ? await pageHeader(page) : await look(page));
      return { ok: result.ok, text: lines.join("\n") };
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
      let res: Response;
      try {
        res = await handle(JSON.parse(line) as Request);
      } catch (err) {
        res = fail(`error: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
      }
      sock.end(JSON.stringify(res) + "\n");
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
