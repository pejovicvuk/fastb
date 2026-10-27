# AGENTS.md

Shared rules for every coding agent on this repo (Claude Code, Codex). `CLAUDE.md` imports this file.

## What fastb is

A fast browser-execution engine for AI coding agents (Claude Code, Codex). The agent sends **chunks** (many steps plus expected results) to a background engine; the engine runs them at code speed and returns only what changed. A Meta open-weight model drafts next steps so the big agent needs fewer turns. Showcase: a gas pipeline pack (public EBB notice pages).

Read before working: `docs/plan.md` (phases and current state), `docs/product.md` (design), `docs/baseline-2026-10-26.md` (numbers to beat).

Built for the Meta Global AI Developer Hackathon. Deadline: Thu Nov 5, 03:00 Belgrade (Wed Nov 4, 9:00 PM ET).

## Roles

- **Orchestrator (Claude Code main session):** owns `docs/plan.md` and the architecture, builds the engine core, writes worker prompts, verifies every worker diff on disk, ticks plan boxes.
- **Workers (Codex, or Claude subagents):** do one fenced task from a prompt. Stay inside the files the prompt names. Do not tick plan boxes. Do not commit.
- **Reviewer (Codex):** `/codex:adversarial-review` at the end of each phase, before its "done when" is ticked.
- **Vuk (human):** decides, commits and pushes. Never `push --force`.

## Working rules

- **One writer per folder.** Parallel worker tasks run in their own git worktree (`git worktree add ../fastb-<task> -b <task>`).
- **Stop and report** instead of guessing when a task needs a change outside its fence, a new dependency, or a design decision.
- **Decisions for Vuk:** at most two options, with a recommendation.
- **Plans are phases with "done when" checks.** No day-by-day schedules, no time estimates.
- **The builder does not grade itself.** Speed and success claims come only from `~/Desktop/fastb-bench` runs.
- **Report results faithfully.** Failed tests, skipped steps and unverified claims are stated as such.

## Hackathon rules (hard)

- Public repo; all code is new work written during the event.
- **No company code or data** from `~/Developer/TCFramework` (ideas only).
- **No secrets in the repo.** Meta API key lives in `~/.fastb/secrets.env` (`META_API_KEY`). The Meta free credits allow content use for product improvement: send no private data to the Meta API.
- `docs/participant-guide.txt` is private: delete it before the repo goes public.
- Meta models must do real work (draft-and-verify drafter, gas pack routine learning), not decoration.

## Code

- TypeScript, strict, ESM (`"type": "module"`, `NodeNext`), Node >= 22. Browser control: `playwright-core`.
- Layout: `src/cli.ts` (thin CLI), `src/engine/` (background engine), `src/browser/`, `src/chunk/` (parser, runner), `src/snapshot/` (page text, diff), `src/model/` (Meta model client), `src/packs/gas/`.
- CLI talks to the engine over a local socket; the engine keeps the browser open.
- Output to the calling agent is short plain text. Every token sent back costs a model turn: no banners, no colors, no long logs.
- Small modules, plain functions, few dependencies. Ask before adding a dependency.
- Tests: Node's built-in runner (`node --import tsx --test`), next to the code as `*.test.ts`. Pure logic (parser, diff, target matching) must have tests.

## Commands

```
npm run dev -- <args>     # run the CLI from source
npm run typecheck
npm run build
```

## Writing style

- Messages to Vuk: ASD-STE100 simple English, short sentences, active voice. Say what was done, whether it worked, what to do next.
- Outward text (README, PR text, video script): no em dashes.
- Commit messages are written by the orchestrator to a file; Vuk commits with `git commit -F`.
