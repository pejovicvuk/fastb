# Handoff prompt (2026-10-27)

Paste the text below into a new Claude Code session started in `~/Developer/fastb`.

---

You are the orchestrator for **fastb**, my solo entry in the Meta Global AI Developer Hackathon (Indie Developer track, theme "Push the Frontier"). Hard deadline: **Thu Nov 5, 03:00 Belgrade (Wed Nov 4, 9:00 PM ET)**. Judged on creativity, technical ambition, and whether it works; judges score from a 3-minute video.

**Read first, in this order:** `AGENTS.md` (shared rules for you and Codex), `docs/plan.md` (phases, current state, lessons), `docs/product.md` (design), `docs/baseline-2026-10-26.md` (numbers to beat). Background: `docs/research.md`, `docs/hackathon.md`.

## What fastb is

A fast browser-execution engine for AI coding agents (Claude Code, Codex). The agent sends **chunks** (many steps + expected results) to a background engine; the engine runs them at code speed and stops at the first surprise. Goal: cut model turns, which are 83% of browser-agent time in our baseline. Later phases: changes-only feedback, draft-and-verify with a Meta open-weight model, and a gas pipeline (EBB) pack as the real-world showcase.

## State now (2026-10-28, paused)

- Direction: **parallel lanes** (docs/plan.md, decision 2026-10-28). Phases 1-4 done and pushed. Phases 5 (lanes), 6 (live grid) and 7 (Meta model commit check + lane report) built and meet their "done when"; **not committed yet**. Commit message ready: `.fastb/commit-msg.txt`.
- Results (docs/bench-2026-10-27.md): run 4, browser at US Pacific time / July 2024: fastb 2.07x faster than baseline per task (74 s -> 36 s), success 17/22 both. Lanes, all 22 tasks in 3 prompts: 18/22, 693 s vs baseline 2301 s (3.3x), 138 vs 632 turns, $2.52 vs $5.77.
- 92 tests pass. Build is current (`dist/`).
- Codex review of phases 5-7: 9 rounds, all findings fixed; stopped by plan (A). Known limits in docs/plan.md (phase 7).
- Remote check switch: a person writes `on` to `~/.fastb/remote-check` (removed now). Bench harnesses write it before a run and remove it after.

## Phase 8 in progress (2026-10-29)

- Part 1 running: Codex + fastb x1 (`run_all_codex.sh` -> `results/codex-r1.jsonl`), then Claude Code + fastb x3 (`fastb-r1..r3.jsonl`), all with the current code (`phase8-part1.sh`).
- Part 2 to start after it: lanes x3 (`run_all_lanes.sh`, move `lanes.jsonl` to `lanes-r1..r3.jsonl` after each pass).
- Part 3: baseline x2 (`run_all_baseline.sh`, move `baseline.jsonl` to `baseline-r2`, `-r3`; run 4 is `baseline-r1.jsonl`).
- Combine: `.venv/bin/python compare_runs.py`. Old runs kept: `fastb-run1..4.jsonl`, `lanes-old.jsonl`, `baseline-oldclock.jsonl`, `codex-smoke.jsonl`.
- Drafts waiting for the final numbers: `README.md` (rewritten, no em dashes), `docs/video-script.md`, `LICENSE` (MIT).

## Next steps

1. Commit phases 5-7 with `git commit -F .fastb/commit-msg.txt` and push, if not done.
2. Phase 8 (proof): 3 runs per task / batch (baseline, fastb, lanes), Codex + fastb on 22 tasks (`run_codex.py`, smoke test gomail-2 passed: 22.5 s, 5 commands), the race vs Codex's own browser for the video.
3. Phase 9-10: video, README, submit (deadline Thu Nov 5, 03:00 Belgrade).

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
