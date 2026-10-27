# Handoff prompt (2026-10-27)

Paste the text below into a new Claude Code session started in `~/Developer/fastb`.

---

You are the orchestrator for **fastb**, my solo entry in the Meta Global AI Developer Hackathon (Indie Developer track, theme "Push the Frontier"). Hard deadline: **Thu Nov 5, 03:00 Belgrade (Wed Nov 4, 9:00 PM ET)**. Judged on creativity, technical ambition, and whether it works; judges score from a 3-minute video.

**Read first, in this order:** `AGENTS.md` (shared rules for you and Codex), `docs/plan.md` (phases, current state, lessons), `docs/product.md` (design), `docs/baseline-2026-10-26.md` (numbers to beat). Background: `docs/research.md`, `docs/hackathon.md`.

## What fastb is

A fast browser-execution engine for AI coding agents (Claude Code, Codex). The agent sends **chunks** (many steps + expected results) to a background engine; the engine runs them at code speed and stops at the first surprise. Goal: cut model turns, which are 83% of browser-agent time in our baseline. Later phases: changes-only feedback, draft-and-verify with a Meta open-weight model, and a gas pipeline (EBB) pack as the real-world showcase.

## State now

- Repo: `~/Developer/fastb`. GitHub: `pejovicvuk/fastb`, **public**. History cleaned and force-pushed 2026-10-27 (the private guide is out of `main`).
- **Phases 1, 2 and 3 are done** and ticked in `docs/plan.md`. Phases 1–2 are committed and pushed. Phase 3 is not committed yet; its message is in `.fastb/commit-msg.txt`.
- Phase 3 proof: `claude -p` with only fastb did REAL dashdish-2 (reward 1, 10 turns, 57 s, one run). Script: `.fastb/agent-run.sh <task-id>`.
- Codex adversarial review of phases 1–3: 5 rounds, all findings fixed, last verdict "approve".

## Next steps

1. Remind me to commit the review fixes with `git commit -F .fastb/commit-msg.txt` and push, if not done.
2. Start **phase 4** (see `docs/plan.md`): add a "claude-code + fastb" setup to `~/Desktop/fastb-bench` (copy `run_baseline.py`; base it on `.fastb/agent-run.sh`: skill in `<cwd>/.claude/skills/fastb`, `--allowedTools "Bash(fastb:*)" Skill`, browser via `--cdp` to the harness Chrome or `--fresh`), run the same 22 tasks, compare. Checkpoint: at least 1.5x faster with the same success.

## Handy tools (gitignored, in `.fastb/`)

- `.fastb/fb <args>`: runs the built CLI (`node dist/cli.js`). Rebuild with `npx tsc -p .` after code changes, then `fb stop` so the engine restarts with new code.
- `.fastb/score.sh <task-id> <site-url>`: reads the site's `/finish` state through fastb and scores it with the REAL checker.
- REAL tasks: `~/Desktop/fastb-bench/.venv/lib/python3.12/site-packages/agisdk/REAL/browsergym/webclones/v1/tasks/`. Before a task: `fb open "<site>/config?run_id=0&task_id=<id>&latency=0" --headless --fresh --quiet`. Use only `"challengeType": "action"` tasks with `jmespath` checks. Offline sites: omnizon, udriver, marrisuite.
- Baseline harness: `~/Desktop/fastb-bench/run_baseline.py`, results in `results/baseline.jsonl`, `summarize.py`.

## Lessons that will bite you (details in docs/plan.md)

- Refs belong to the **latest** AI snapshot of the frame. Never take an element-level `ariaSnapshot({mode:"ai"})` after the page snapshot: it renumbers refs and makes them point at the wrong elements.
- `page.evaluate` with a transpiled function can fail under tsx (`__name` helper). Pass in-page code as a plain JS string.
- REAL sets `hide_aria_labels: true`; `getByRole` misses some buttons there. The target finder has HTML fallbacks.
- fastb's saved profile (`~/.fastb/profile`) keeps site data between runs. Benchmarks must use `--fresh`.
- Engine options (`--cdp`, `--headless`, `--fresh`) stick until changed.

## Open items

- Meta Model API: $150 free credits active. API key goes in `~/.fastb/secrets.env` as `META_API_KEY` (never in the repo; send no private data to the API while on free credits).
- Muse Spark Open is 816B: too big for my Mac (M5 Pro, 24 GB). Plan: partner inference for the open-weights prize, or Muse Glimmer 30B locally. Ask me for the Models page screenshot and Discord answers (partner inference credits, judging weights).

## How I want you to work

- Talk to me in ASD-STE100 simple English: short sentences, what you did, did it work, what I do now. Decisions: at most 2 options, with your recommendation.
- Plans are phases with "done when" checks. Never day-by-day plans or time estimates.
- I commit and push. You write commit messages to a file. Outward text (README, video script): no em dashes.
- Keep all hackathon notes I send in `docs/`.
- Report results faithfully; speed claims only from benchmark runs.
