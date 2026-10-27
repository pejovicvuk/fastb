# fastb: product notes and decisions

## Problem

AI coding agents (Claude Code, Codex) are slow and expensive when they use the browser. They call the big model for almost every step and send the full page again each time. Claude in Chrome also freezes (45 s waits on `document_idle`).

## Pitch

"The convenience of Claude in Chrome, the speed of Playwright, and fewer AI turns than both."
"Meta's small model makes big agents 2–3x faster."

## Shape (decided 2026-10-26)

- **fastb core:** general engine for any website and any agent.
- **fastb packs:** learned routines + domain checks for one industry. First pack: **gas pipelines** (public EBB notices and capacity pages, cycle deadlines). Showcase only, not the product.
- Why the energy demo matters to judges: hard deadlines (nomination cycles, OFOs). Story: "a normal agent misses the cutoff; fastb makes it in time."
- Not doing: an ETRM-only product (small market, competes with SynMax / Wood Mackenzie / NatGasHub notice feeds).

## Who uses it

People who already let an AI agent use their browser, often, and are tired of waiting and paying.

- A developer who checks their own feature many times a day.
- A developer who tests a logged-in admin panel (real Chrome, real logins).
- A team that runs the same kind of browser task many times (cost).

Not for: one quick page read, fixed daily tests (use plain Playwright), visual-only checks, people who do not use agents.

## Core tech (priority order)

1. **Chunks:** the agent sends many steps plus expected results in one call. The engine runs them with code. Stops on a surprise. Main win: fewer model turns.
2. **Draft and verify:** a Meta open-weight model drafts the next steps; the big model approves them in one turn. Model: Muse Spark Open via partner inference (816B, too big for a laptop), or Muse Glimmer 30B locally on big machines.
3. **Changes-only feedback:** return only what changed on the page. Lowers cost and keeps late turns small.
4. **Smart waits:** wait for the expected change, not "page idle". Mostly matters against Claude in Chrome.
5. **Connect to real Chrome** (logged-in) or launch a fresh Chromium.

Dropped: "pre-run clicks while the model thinks". Baseline shows browser tools take only ~17% of time, so hiding them saves little.

## Commands (draft)

```
fastb open http://localhost:3000
fastb look            # page as short text with refs (@e1 button "Save")
fastb look --shot     # plus screenshot
fastb run <<'EOF'
fill "Email" = test@x.com
fill "Password" = abc
click "Create account"
expect text "Welcome"
expect url /dashboard
EOF
```

Result on success: `OK 5/5 steps 0.9s`. On surprise: step number, what was expected, what was seen, what changed.

Safety: "delete", "pay", "send" and similar stop the chunk unless `allow` is given.

## Architecture

```
Claude Code / Codex
      │ shell command
      ▼
fastb CLI (thin)
      │ local socket
      ▼
fastb engine (background, always on)
  ├─ browser link  -> real Chrome (CDP) or fresh Chromium
  ├─ snapshot + diff
  ├─ chunk runner (steps, waits, expects, stop on surprise)
  ├─ safety gate
  ├─ stats log
  └─ draft model link -> Muse Spark Open (partner inference) or Muse Glimmer (local)
```

- Language: **TypeScript** (Node 22+), `playwright-core`. No Rust for now.
- Integration: **CLI + skill file first**, MCP wrapper later.
- Benchmark: Python, in `~/Desktop/fastb-bench`.

## Open decisions

- Chunk format: line format (recommended) or JSON.
- Draft model: Muse Spark Open via partner inference (recommended, fast) or Muse Glimmer local (slow on 24 GB Mac).
- Which partner inference provider (ask in Discord).
