import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lockPort, takeLock } from "./lock.ts";

// A port unlikely to be in use, different for each test.
let next = 48500 + (process.pid % 400);
const freshPort = () => next++;

test("one lock per port; free again after release", async () => {
  const port = freshPort();
  const first = await takeLock(port);
  assert.ok(first);
  assert.equal(await takeLock(port), null);
  await first.release();
  const again = await takeLock(port);
  assert.ok(again);
  await again.release();
});

test("one folder written different ways gives one port", () => {
  const home = mkdtempSync(join(tmpdir(), "fastb-home-"));
  const link = `${home}-link`;
  symlinkSync(home, link);
  const port = lockPort(home);
  for (const alias of [`${home}/`, `${home}/./`, join(home, "x", ".."), link]) assert.equal(lockPort(alias), port, alias);
});

test("each home folder gets its own port", () => {
  assert.notEqual(lockPort("/a/.fastb"), lockPort("/b/.fastb"));
  assert.equal(lockPort("/a/.fastb"), lockPort("/a/.fastb"));
});

const lockModule = new URL("./lock.ts", import.meta.url).href;

function child(code: string): ReturnType<typeof spawn> {
  return spawn(process.execPath, ["--import", "tsx", "-e", code], { stdio: ["ignore", "pipe", "inherit"] });
}

// Real processes start together; each tries once and holds what it got for a moment.
test("processes racing for the lock: one wins", async () => {
  const port = freshPort();
  const code = `import(${JSON.stringify(lockModule)}).then(async (m) => { const l = await m.takeLock(${port}); console.log(Boolean(l)); setTimeout(() => process.exit(0), 1500); });`;
  const outs = await Promise.all(
    Array.from({ length: 8 }, () => new Promise<string>((resolve) => {
      const c = child(code);
      let out = "";
      c.stdout!.on("data", (d) => (out += d));
      c.on("close", () => resolve(out.trim()));
    })),
  );
  assert.equal(outs.filter((o) => o === "true").length, 1);
});

test("a crashed holder leaves nothing behind", async () => {
  const port = freshPort();
  const holder = child(`import(${JSON.stringify(lockModule)}).then(async (m) => { console.log(Boolean(await m.takeLock(${port}))); setInterval(() => {}, 1000); });`);
  const got = await new Promise<string>((resolve) => holder.stdout!.once("data", (d) => resolve(String(d).trim())));
  assert.equal(got, "true");
  assert.equal(await takeLock(port), null);
  const exited = new Promise((resolve) => holder.on("close", resolve));
  holder.kill("SIGKILL");
  await exited;
  const after = await takeLock(port);
  assert.ok(after);
  await after.release();
});
