import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import type { EngineOptions } from "../protocol.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROFILE_DIR } from "../paths.ts";

// Owns the one browser the engine drives. Either connects to a running Chrome
// over CDP (real profile, real logins) or launches Chrome with fastb's own profile.
export class Session {
  private browser?: Browser;
  private context?: BrowserContext;
  private current?: Page;
  private opts: EngineOptions = {};
  private tempProfile?: string;

  // Options stick: a command that does not name --cdp or --headless keeps the current browser.
  async page(given: EngineOptions): Promise<Page> {
    const opts = { ...this.opts, ...definedOnly(given) };
    if (this.context && !sameOptions(this.opts, opts)) await this.close();
    if (!this.context) await this.start(opts);
    if (!this.current || this.current.isClosed()) {
      const pages = this.context!.pages();
      this.current = pages[pages.length - 1] ?? (await this.context!.newPage());
    }
    return this.current;
  }

  describe(): string {
    if (!this.context) return "browser: not started";
    const mode = this.opts.cdp
      ? `cdp ${this.opts.cdp}`
      : `chrome${this.opts.headless ? " (headless)" : ""}${this.opts.fresh ? ", fresh profile" : ""}`;
    return `browser: ${mode}, ${this.context.pages().length} tab(s)`;
  }

  async close(): Promise<void> {
    if (this.opts.cdp) await this.browser?.close().catch(() => {}); // disconnects, keeps the user's Chrome open
    else await this.context?.close().catch(() => {});
    this.browser = this.context = this.current = undefined;
    if (this.tempProfile) rmSync(this.tempProfile, { recursive: true, force: true });
    this.tempProfile = undefined;
  }

  private async start(opts: EngineOptions): Promise<void> {
    this.opts = { ...opts };
    if (opts.cdp) {
      this.browser = await chromium.connectOverCDP(opts.cdp);
      this.context = this.browser.contexts()[0] ?? (await this.browser.newContext());
    } else {
      // The saved profile keeps logins, but also old site data (drafts, carts).
      if (opts.fresh) this.tempProfile = mkdtempSync(join(tmpdir(), "fastb-profile-"));
      this.context = await chromium.launchPersistentContext(this.tempProfile ?? PROFILE_DIR, {
        channel: "chrome",
        headless: opts.headless ?? false,
        viewport: null,
      });
    }
    // A new tab or popup becomes the page the agent works on.
    this.context.on("page", (p) => (this.current = p));
    // The user may close Chrome by hand: forget it so the next command starts a new one.
    this.context.on("close", () => {
      console.error("browser closed");
      this.browser = this.context = this.current = undefined;
    });
  }
}

function definedOnly(o: EngineOptions): EngineOptions {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as EngineOptions;
}

function sameOptions(a: EngineOptions, b: EngineOptions): boolean {
  return (a.cdp ?? "") === (b.cdp ?? "") && Boolean(a.headless) === Boolean(b.headless) && Boolean(a.fresh) === Boolean(b.fresh);
}
