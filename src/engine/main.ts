import { createServer, type Socket } from "node:net";
import type { Page } from "playwright-core";
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
import { runChunk, type RunHooks, type RunResult } from "../chunk/run.ts";
import type { ParsedStep } from "../chunk/parse.ts";
import { commitCheck, readEvidence, REMOTE_CHECK_FILE, remoteCheckEnabled, runCommitCheck } from "../check/commit.ts";
import { laneReport, type LaneOutcome } from "../check/report.ts";
import { startWatch, type WatchLane } from "../watch/server.ts";
import { safeStep } from "../watch/logic.ts";
import { combineLanes, parseLanes } from "../chunk/lanes.ts";
import type { LaneSetup } from "../browser/session.ts";

const IDLE_EXIT_MS = 30 * 60 * 1000;

const session = new Session();
let queue: Promise<unknown> = Promise.resolve();
let idleTimer: NodeJS.Timeout | undefined;

type Handled = Response & { stat?: Partial<StatRow> };

// Each lane's latest outcome as data (never page text), for "fastb lanes report".
const laneOutcomes = new Map<string, LaneOutcome>();
const outcomeOf = (r: RunResult, steps: ParsedStep[]): LaneOutcome => ({
  ok: r.ok,
  done: r.done,
  total: r.total,
  stop: r.failure ? { index: r.failure.index, step: steps[r.failure.index].step, code: r.failure.code, checkReason: r.failure.checkReason } : undefined,
});

// What each lane is doing now, for the live grid.
type LaneState = "idle" | "running" | "ok" | "stopped";
const laneStatus = new Map<string, { state: LaneState; step?: string }>();

// The live grid, while someone asked for it.
let watcher: { url: string; close(): Promise<void> } | undefined;

function watchLanes(): WatchLane[] {
  // Sorted by name: lanes start at the same moment, so their own order is random.
  const lanes: WatchLane[] = session
    .lanePages()
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }))
    .map(({ name, page }) => {
      const st = laneStatus.get(name) ?? { state: "idle" as const };
      return { name, page, state: st.state, step: safeStep(st.step) };
    });
  const main = session.mainPage();
  const st = laneStatus.get("") ?? { state: "idle" as const };
  return main ? [{ name: "main", page: main, state: st.state, step: safeStep(st.step) }, ...lanes] : lanes;
}

// The task each lane (or the main page, key "") works on: a "task" line in a chunk sets it.
const tasks = new Map<string, string>();
// Values typed into secret fields, per lane: hidden from every later Meta request.
const secretsByLane = new Map<string, Set<string>>();
// Commit checks run in this command, for the stats line, and notes for the agent.
let checks = { n: 0, ms: 0, stopped: 0 };
let notes = new Set<string>();

// Hooks for one chunk: the live grid status, and the commit check when the lane has a task.
function hooksFor(name: string | undefined, steps: ParsedStep[]): { hooks: RunHooks; end(ok: boolean): void } {
  const key = name ?? "";
  const taskStep = steps.find((s) => s.step.op === "task")?.step as { text: string } | undefined;
  if (taskStep) tasks.set(key, taskStep.text);
  const check: RunHooks["check"] = async (page, label) => {
    const task = tasks.get(key);
    if (!task) return null;
    if (!remoteCheckEnabled()) {
      notes.add(`note: commit check is off (it sends page facts to the Meta API; a person turns it on by writing "on" to ${REMOTE_CHECK_FILE})`);
      return null;
    }
    const known = [...(secretsByLane.get(key) ?? [])];
    const out = await runCommitCheck(task, label, () => readEvidence(page), (t, a, e) => commitCheck(t, a, e, known));
    if (out.kind === "skipped") {
      console.error(`commit check failed, click goes on: ${out.error}`);
      notes.add(`note: commit check skipped, click done unchecked (${out.error})`);
      return null;
    }
    checks = { n: checks.n + 1, ms: checks.ms + (out.ms ?? 0), stopped: checks.stopped + (out.kind === "stop" ? 1 : 0) };
    return out.kind === "stop" ? { reason: out.reason, model: out.model } : null;
  };
  laneStatus.set(key, { state: "running" });
  return {
    hooks: {
      check,
      onSecret: (value) => secretsByLane.set(key, (secretsByLane.get(key) ?? new Set()).add(value)),
      flash: Boolean(watcher),
      onStep: (_i, source) => laneStatus.set(key, { state: "running", step: source }) },
    end: (ok) => laneStatus.set(key, { state: ok ? "ok" : "stopped", step: laneStatus.get(key)?.step }),
  };
}

// The page a command works on: lane `--lane x`, or the main page.
function target(req: Request): () => Promise<Page> {
  const lane = typeof req.flags.lane === "string" ? req.flags.lane : undefined;
  return lane ? () => session.lane(lane, req.options, laneSetup(req)) : () => session.page(req.options);
}

function laneSetup(req: Request): LaneSetup {
  const str = (k: string) => (typeof req.flags[k] === "string" ? (req.flags[k] as string) : undefined);
  return { timezone: str("timezone"), clock: str("clock") };
}

async function handle(req: Request): Promise<Handled> {
  switch (req.cmd) {
    case "open": {
      const url = req.args[0];
      if (!url) return fail("usage: fastb open <url>");
      const page = await target(req)();
      await page.goto(withScheme(url), { waitUntil: "domcontentloaded", timeout: 30000 });
      await settle(page);
      if (req.flags.quiet) {
        forgetView(page);
        return ok(`opened ${page.url()}`);
      }
      return ok(await showPage(page)); // the agent always looks after opening: save it a turn
    }
    case "look": {
      const page = await target(req)();
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
      const getPage = target(req);
      const track = hooksFor(typeof req.flags.lane === "string" ? req.flags.lane : undefined, steps);
      const result = await runChunk(getPage, steps, track.hooks);
      track.end(result.ok);
      const report = await runReport(result, async () => {
        const page = await getPage();
        return req.flags["no-look"] ? { text: await pageHeader(page) } : showChanges(page);
      });
      if (typeof req.flags.lane === "string") laneOutcomes.set(req.flags.lane, outcomeOf(result, steps));
      return { ok: result.ok, text: report.text, stat: { steps: result.total, done: result.done, full: report.full } };
    }
    case "lanes": {
      const input = req.args.join("\n").trim();
      if (input === "close") {
        laneStatus.clear();
        laneOutcomes.clear();
        for (const name of session.laneNames()) secretsByLane.delete(name);
        for (const name of session.laneNames()) tasks.delete(name);
        return ok(`lanes: closed ${await session.closeLanes()}`);
      }
      if (!input || input === "list") return ok(session.laneNames().length ? `lanes: ${session.laneNames().join(" ")}` : "lanes: none open");
      if (input === "report") {
        if (!remoteCheckEnabled()) return fail(`lanes report is off: it sends lane results to the Meta API. A person turns it on by writing "on" to ${REMOTE_CHECK_FILE}`);
        const names = session.laneNames().filter((n) => laneOutcomes.has(n));
        if (!names.length) return ok("lanes: nothing to report yet");
        return ok(await laneReport(names.map((name) => ({ name, outcome: laneOutcomes.get(name)! }))));
      }
      if (input === "look") {
        // Every lane's page in one call (an agent may not loop over lanes in the shell).
        const started = Date.now();
        const results = await Promise.all(
          session.laneNames().map(async (name) => {
            const page = await session.lane(name, req.options);
            await settle(page, { maxMs: 3000 });
            return { name, ok: true, text: await showPage(page) };
          }),
        );
        return ok(results.length ? combineLanes(results, Date.now() - started, 80) : "lanes: none open");
      }
      let blocks;
      try {
        blocks = parseLanes(input).map((b) => {
          try {
            return { name: b.name, steps: parseChunk(b.text) };
          } catch (err) {
            if (err instanceof ParseError) throw new ParseError(b.line + err.line, `lane ${b.name}: ${err.message.replace(/^line \d+: /, "")}`);
            throw err;
          }
        });
      } catch (err) {
        if (err instanceof ParseError) return fail(`not run: ${err.message}`);
        throw err;
      }
      if (!blocks.length) return fail('not run: no lanes (start each with "lane <name>")');
      const empty = blocks.find((b) => !b.steps.length);
      if (empty) return fail(`not run: lane ${empty.name} has no steps`);
      const setup = laneSetup(req);
      const started = Date.now();
      // All lanes at once. One lane's failure stops only that lane.
      const results = await Promise.all(
        blocks.map(async (b) => {
          const getPage = () => session.lane(b.name, req.options, setup);
          const track = hooksFor(b.name, b.steps);
          try {
            const result = await runChunk(getPage, b.steps, track.hooks);
            track.end(result.ok);
            const report = await runReport(result, async () => {
              const page = await getPage();
              return req.flags["no-look"] ? { text: await pageHeader(page) } : showChanges(page);
            });
            return { name: b.name, ok: result.ok, text: report.text, total: result.total, done: result.done, full: report.full, outcome: outcomeOf(result, b.steps) };
          } catch (err) {
            track.end(false);
            return { name: b.name, ok: false, text: `error: ${firstLine(err)}`, total: b.steps.length, done: 0, full: undefined, outcome: undefined };
          }
        }),
      );
      for (const r of results) if (r.outcome) laneOutcomes.set(r.name, r.outcome);
      const sum = (f: (r: (typeof results)[number]) => number) => results.reduce((n, r) => n + f(r), 0);
      return {
        ok: results.every((r) => r.ok),
        text: combineLanes(results, Date.now() - started),
        stat: { steps: sum((r) => r.total), done: sum((r) => r.done), lanes: results.length },
      };
    }
    case "watch": {
      if (req.args[0] === "stop") {
        await watcher?.close();
        watcher = undefined;
        return ok("watch: stopped");
      }
      watcher ??= await startWatch({ lanes: watchLanes }, { port: typeof req.flags.port === "string" ? Number(req.flags.port) : undefined });
      return ok(`watch: ${watcher.url}`);
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
      if (notes.size) reply.text += "\n" + [...notes].join("\n");
      notes = new Set();
      const checkStat = checks.n ? { checks: checks.n, check_ms: checks.ms, check_stops: checks.stopped } : {};
      checks = { n: 0, ms: 0, stopped: 0 };
      sock.end(JSON.stringify(reply) + "\n");
      if (req && req.cmd !== "status" && req.cmd !== "stop") {
        appendStat({ t: new Date(started).toISOString(), cmd: req.cmd, ok: res.ok, ms: Date.now() - started, out: res.text.length, ...stat, ...checkStat });
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
  await watcher?.close().catch(() => {});
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
