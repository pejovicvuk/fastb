#!/usr/bin/env node
import { createConnection } from "node:net";
import { spawn } from "node:child_process";
import { mkdirSync, openSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ENGINE_LOG, HOME, SOCKET } from "./paths.ts";
import type { EngineOptions, Request, Response } from "./protocol.ts";
import { readStats, summarize } from "./engine/stats.ts";

const USAGE = `fastb: fast browser for AI agents

  fastb open <url>        open a page and print it (add --quiet to skip the page)
  fastb look              print the current page as short text with refs (@e3)
  fastb look --shot       also save a screenshot and print its path
  fastb look --full       print the full raw snapshot
  fastb run <<'EOF'       run many steps in one call; stops at the first surprise
    fill "Email" = test@x.com
    click button "Sign up"
    expect text "Welcome"
  EOF
  fastb run --file steps.txt    (or pass each step as an argument)
                          after a run: only what changed on the page (--no-look: only the page title)
                          clicks on delete / pay / send / order controls stop the run;
                          add the line "allow" to the chunk when the task needs them
  fastb stats             commands, steps and characters saved so far
  fastb status            show engine and browser state
  fastb stop              close the browser and stop the engine

options (apply when the browser starts):
  --cdp <url>             use a running Chrome, e.g. http://127.0.0.1:9222
  --headless              start Chrome without a window
  --fresh                 start with an empty temporary profile (no saved logins or site data)`;

const OPTION_FLAGS = new Set(["cdp", "headless", "fresh"]);

function parse(argv: string[]): Request | null {
  const args: string[] = [];
  const flags: Record<string, string | boolean> = {};
  const options: EngineOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      args.push(a);
      continue;
    }
    const [key, inline] = a.slice(2).split("=", 2);
    const takesValue = key === "cdp" || key === "file";
    const value = inline ?? (takesValue ? argv[++i] : true);
    if (OPTION_FLAGS.has(key)) {
      if (key === "cdp") options.cdp = String(value);
      if (key === "headless") options.headless = value !== "false";
      if (key === "fresh") options.fresh = value !== "false";
    } else flags[key] = value;
  }
  const cmd = args.shift();
  if (!cmd || cmd === "help" || flags.help) return null;
  if (!options.cdp && process.env.FASTB_CDP) options.cdp = process.env.FASTB_CDP;
  if (options.headless === undefined && process.env.FASTB_HEADLESS === "1") options.headless = true;
  return { cmd, args, flags, options };
}

function send(req: Request): Promise<Response> {
  return new Promise((resolve, reject) => {
    const sock = createConnection(SOCKET);
    let buf = "";
    sock.setEncoding("utf8");
    sock.on("connect", () => sock.write(JSON.stringify(req) + "\n"));
    sock.on("data", (d) => (buf += d));
    sock.on("end", () => {
      try {
        resolve(JSON.parse(buf) as Response);
      } catch {
        reject(new Error("engine closed the connection without an answer"));
      }
    });
    sock.on("error", reject);
  });
}

function startEngine(): void {
  mkdirSync(HOME, { recursive: true });
  const here = fileURLToPath(import.meta.url);
  const fromSource = here.endsWith(".ts");
  const entry = join(dirname(here), "engine", fromSource ? "main.ts" : "main.js");
  const args = fromSource ? ["--import", import.meta.resolve("tsx"), entry] : [entry];
  const log = openSync(ENGINE_LOG, "a");
  spawn(process.execPath, args, { detached: true, stdio: ["ignore", log, log] }).unref();
}

async function sendStartingEngine(req: Request): Promise<Response> {
  try {
    return await send(req);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ECONNREFUSED") throw err;
  }
  if (req.cmd === "stop" || req.cmd === "status") return { ok: true, text: "engine: not running" };
  startEngine();
  const deadline = Date.now() + 15000;
  for (;;) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      return await send(req);
    } catch (err) {
      if (Date.now() > deadline) throw new Error(`engine did not start; see ${ENGINE_LOG}`);
    }
  }
}

// A chunk comes from --file, from stdin (heredoc or pipe), or from the arguments (one step each).
function readChunk(req: Request): void {
  if (typeof req.flags.file === "string") req.args = [readFileSync(req.flags.file, "utf8")];
  else if (!req.args.length && !process.stdin.isTTY) req.args = [readFileSync(0, "utf8")];
}

const req = parse(process.argv.slice(2));
if (!req) {
  console.log(USAGE);
  process.exit(0);
}
if (req.cmd === "stats") {
  console.log(summarize(readStats()));
  process.exit(0);
}
if (req.cmd === "run") readChunk(req);
sendStartingEngine(req).then(
  (res) => {
    console.log(res.text);
    process.exit(res.ok ? 0 : 1);
  },
  (err: Error) => {
    console.error(`fastb: ${err.message}`);
    process.exit(1);
  },
);
