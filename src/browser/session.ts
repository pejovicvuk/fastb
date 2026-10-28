import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import type { EngineOptions } from "../protocol.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROFILE_DIR } from "../paths.ts";

// How a new lane's browser context is set up.
export interface LaneSetup {
  timezone?: string; // e.g. America/Los_Angeles
  clock?: string; // start time, e.g. 2024-07-18T09:00:00-07:00; time runs on from there
}

interface Lane {
  context: BrowserContext;
  current?: Page;
}

// Owns the browsers the engine drives. The main page: a running Chrome over CDP
// (real profile, real logins) or Chrome with fastb's own profile. Lanes: isolated
// contexts (own cookies and storage) that run at the same time.
export class Session {
  private browser?: Browser;
  private context?: BrowserContext;
  private current?: Page;
  private opts: EngineOptions = {};
  private tempProfile?: string;
  private starting?: Promise<void>;
  private lanesBrowser?: Promise<Browser>; // own-Chrome mode: one separate browser holds all lanes
  private lanes = new Map<string, Lane>();

  // Options stick: a command that does not name --cdp or --headless keeps the current browser.
  async page(given: EngineOptions): Promise<Page> {
    await this.ensure(given);
    if (!this.current || this.current.isClosed()) {
      const pages = this.context!.pages();
      this.current = pages[pages.length - 1] ?? (await this.context!.newPage());
    }
    return this.current;
  }

  // The page of lane `name`; the lane and its context are made on first use.
  async lane(name: string, given: EngineOptions, setup: LaneSetup = {}): Promise<Page> {
    await this.ensure(given);
    let lane = this.lanes.get(name);
    if (!lane) {
      // The launch promise is stored before any await, so lanes that start together share one browser.
      if (!this.browser && !this.lanesBrowser) {
        const launch = chromium.launch({ channel: "chrome", headless: this.opts.headless ?? false });
        this.lanesBrowser = launch;
        launch.catch(() => {
          if (this.lanesBrowser === launch) this.lanesBrowser = undefined; // a failed launch may be retried
        });
      }
      const browser = this.browser ?? (await this.lanesBrowser!);
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, timezoneId: setup.timezone });
      if (setup.clock) await context.clock.install({ time: new Date(setup.clock) });
      const made: Lane = { context };
      context.on("page", (p) => (made.current = p)); // a popup becomes the lane's page
      context.on("close", () => this.lanes.delete(name));
      this.lanes.set(name, (lane = made));
    }
    if (!lane.current || lane.current.isClosed()) {
      const pages = lane.context.pages();
      lane.current = pages[pages.length - 1] ?? (await lane.context.newPage());
    }
    return lane.current;
  }

  // How many browser processes hold the lanes (tests: lanes must share one).
  async laneBrowserContexts(): Promise<number> {
    return this.lanesBrowser ? (await this.lanesBrowser).contexts().length : 0;
  }

  laneNames(): string[] {
    return [...this.lanes.keys()];
  }

  // The main page if the browser runs; never starts one (for the live grid).
  mainPage(): Page | undefined {
    return this.current && !this.current.isClosed() ? this.current : undefined;
  }

  // Each lane's current page, for the live grid.
  lanePages(): { name: string; page?: Page }[] {
    return [...this.lanes].map(([name, l]) => ({ name, page: l.current && !l.current.isClosed() ? l.current : undefined }));
  }

  async closeLanes(): Promise<number> {
    const n = this.lanes.size;
    await Promise.all([...this.lanes.values()].map((l) => l.context.close().catch(() => {})));
    this.lanes.clear();
    const launch = this.lanesBrowser;
    this.lanesBrowser = undefined;
    await launch?.then((b) => b.close()).catch(() => {});
    return n;
  }

  // Starts the main browser once, even when several lanes ask at the same moment.
  // The check and the start happen with no await between them, so a second caller
  // always sees the first one's `starting` promise.
  private async ensure(given: EngineOptions): Promise<void> {
    for (;;) {
      if (this.starting) {
        await this.starting.catch(() => {});
        continue;
      }
      const opts = { ...this.opts, ...definedOnly(given) };
      const work = this.context && !sameOptions(this.opts, opts) ? this.close() : !this.context ? this.start(opts) : undefined;
      if (!work) return;
      this.starting = work.finally(() => (this.starting = undefined));
      await this.starting;
    }
  }

  describe(): string {
    if (!this.context) return "browser: not started";
    const mode = this.opts.cdp
      ? `cdp ${this.opts.cdp}`
      : `chrome${this.opts.headless ? " (headless)" : ""}${this.opts.fresh ? ", fresh profile" : ""}`;
    const lanes = this.lanes.size ? `, lanes: ${this.laneNames().join(" ")}` : "";
    return `browser: ${mode}, ${this.context.pages().length} tab(s)${lanes}`;
  }

  async close(): Promise<void> {
    await this.closeLanes();
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
