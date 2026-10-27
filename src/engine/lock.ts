import { createServer, type Server } from "node:net";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";

// Only one engine may run. The lock is a listening TCP port on 127.0.0.1: the
// system gives a port to one process only, and frees it the moment that process
// ends, even after a crash. So no lock file can go stale. The port only holds the
// lock; it answers nothing (commands go over the engine's unix socket).

export interface Lock {
  release(): Promise<void>;
}

// One port per fastb home folder, so test homes do not share a lock.
export function lockPort(home: string): number {
  if (process.env.FASTB_LOCK_PORT) return Number(process.env.FASTB_LOCK_PORT);
  // The same folder written another way (trailing slash, "..", a symlink) must give the same port.
  let canonical = resolve(home);
  try {
    canonical = realpathSync(canonical);
  } catch {
    // not created yet: the resolved path is the best we have
  }
  return 47000 + (createHash("sha256").update(canonical).digest().readUInt16BE(0) % 2000);
}

// Resolves to the lock, or null when another process holds the port.
export function takeLock(port: number): Promise<Lock | null> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer((sock) => sock.destroy());
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") resolve(null);
      else reject(err);
    });
    server.listen({ port, host: "127.0.0.1", exclusive: true }, () => {
      server.unref(); // the lock alone must not keep the process alive
      resolve({ release: () => new Promise((done) => server.close(() => done())) });
    });
  });
}
