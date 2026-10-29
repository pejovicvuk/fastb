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

## Phase 8 paused by Vuk (2026-10-29)

- Done: Codex + fastb on all 22 tasks (`results/codex-r1.jsonl`): 16/22 passed. Harness fix: `codex exec` needs stdin closed (`stdin=DEVNULL` in run_codex.py), else it waits forever.
- Stopped in the middle: Claude Code + fastb r1 after 5 tasks (`results/fastb-r1-partial.jsonl`). Not started: fastb r2, r3; lanes x3; baseline x2.
- Decision A taken (2026-10-29): "proof of done" built (`fastb done`, `fastb lanes done`; docs/plan.md phase 7b). Live test on gomail-3 passes. Commit check flakes fixed on the way. Codex review: 4 rounds, all findings fixed. 103 tests pass, `dist/` is built. Commit message: `.fastb/commit-msg.txt`.
- Bench harnesses now start the test Chrome headless (Vuk: visible windows took focus). Baseline r2 + r3 run headless (`phase8-baseline.sh`); baseline r1 was headed. One headed r2 task was discarded (`baseline-r2-headed-discard.jsonl`).
- Baseline done, 3 runs (r1 headed, r2 + r3 headless): 17/22, 17/22, 18/22; median 75.7 / 56.1 / 65.9 s; total 2301 / 1436 / 1597 s.
- Final runs STOPPED by Vuk (2026-10-29, 09:53) after 1 task: `results/final-fastb-r1-partial.jsonl` (gomail-3 passed, agent used `fastb done`). Do not start any benchmark until Vuk says so. To start: `cd ~/Desktop/fastb-bench && nohup ./phase8-final.sh > results/phase8-final.log 2>&1 < /dev/null &` (fastb x3, lanes x3, Codex x1; results `results/final-*.jsonl`).
- Drafts waiting for the final numbers: `README.md` (rewritten, with a Mermaid diagram), `docs/video-script.md`, `LICENSE` (MIT).

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
- Final runs restarted by Vuk's "resume" (2026-10-29, 12:58). At 14:58 fastb x3 and lanes r1, r2 done; lanes r3 and Codex r1 still run.
  - fastb r1/r2/r3: 18/22 each (same 4 fails: fly-unified-9, gomail-8, staynb-9, topwork-1; gomail-3 now passes in all 3). Median 56.8 / 63.0 / 55.7 s, total 1468 / 1359 / 1287 s, 267 / 269 / 256 turns, $3.90 / $4.03 / $3.79.
  - Run 4 (old code) was 17/22, median 35.6 s, total 890 s. The new code is SLOWER: fastb time per run 521 s vs 266 s, Claude API time about 900 s vs 601 s. Today's fastb is about as fast as today's baseline (r2 56.0 s, r3 64.2 s). Cause not yet found.
  - lanes r1: 19/22, 1032 s, 139 turns, $2.82. r2: 18/22, 992 s, 164 turns, $2.90. Old lanes: 18/22, 693 s.
- Slowdown cause (read from the agent transcripts of final fastb r1):
  - `fastb done` ran 43 times in 22 tasks, about 5 s each (Meta call): about 215 s of the 255 s extra fastb time.
  - NO PROOF loops: on DashDish (no order history page) and StayNB the checker asks for a proof page that does not exist; the agent searches (404 /orders, "Order History"...) for 2 to 5 extra calls.
  - Real catches: networkin-5 (Connect not sent yet), opendining-3/4/5 (phone invalid, booking not confirmed), zilloft-6 (wrong city), gomail-3 (pass now).
  - False DONEs left: gomail-8, topwork-1, staynb-9 (checker said DONE, REAL says fail). fly-unified-9 never ran `fastb done`.
- lanes r3: 18/22, 1008 s, 154 turns, $2.87.
- Decision A (2026-10-29, after the slowdown): NO PROOF after the final click is now LIKELY DONE (docs/plan.md phase 7b). Codex review 2 rounds, all fixed; 105 tests pass; `dist/` built 15:11. Commit message: `.fastb/commit-msg.txt`.
  - Codex r1 (started 15:03:47) ran with mixed code: dist was rebuilt at 15:03, 15:08 and 15:11 during it (each task starts a new engine). The later builds only change edge cases.
  - Queued: `phase8-final2.sh` waits for `results/final-codex-r1.jsonl`, then fastb x3 with the new code -> `results/final2-fastb-rN.jsonl`, log `results/phase8-final2.log`.
- Codex + fastb r1 (mixed code, see above): 18/22, median 69.2 s, total 1631 s, 212 turns (old Codex r1: 16/22).
- fastb with LIKELY DONE (final2, 3 runs, done 16:36): 18/22, 19/22, 19/22; median 49.4 / 50.7 / 48.4 s; total 1142 / 1241 / 1199 s; 243 / 232 / 243 turns; $3.56 / $3.49 / $3.54. NO PROOF loops gone (1, 0, 0 NO PROOF answers; 4-6 LIKELY DONE per run).
  - Against the headless baseline (r2, r3 mean: 17.5/22, 1517 s, 620 turns, $5.08): 1.27x faster in total time, 2.6x fewer turns, 31% cheaper, +1 task.
  - Lanes (first done code, 3 runs): 18-19/22, about 1000 s, about 150 turns, about $2.85: 1.5x faster, 4x fewer turns, 44% cheaper.
  - Not yet checked: whether the 14-20 NOT DONE answers per run are all real catches.
- Lightpanda ideas (decision A, 2026-10-29; notes in docs/research-lightpanda.md):
  - Built: view budget (src/snapshot/budget.ts, 8 KB per full view, `fastb look` shows all). Bench pages: full views 501 KB -> 328 KB. Codex review 2 rounds, all fixed; 112 tests pass.
  - Not built: action-caused waits. Measured with FASTB_TRACE on REAL: waits are about 0.3 s, one 2.6 s after a page change; little to gain.
  - Dropped: blocking images, fonts and video. Page opens 0.7-1 s with or without; no gain.
  - Running: `phase8-final3.sh` (fastb x3 with the budget) -> `results/final3-fastb-rN.jsonl`, log `results/phase8-final3.log`, started 22:05.
- final3 (view budget, fastb x3, done 23:00): 20/22, 17/22, 19/22; median 45.5 / 42.3 / 38.3 s; total 1032 / 928 / 1052 s (mean 1004 s, was 1194 s: 16% faster); 259 / 235 / 253 turns; $3.57 / $3.34 / $3.59. Against the headless baseline (1517 s): 1.51x faster in total time.
  - New fail: zilloft-6 in r2 (site search gave San Marcos; fastb done said NOT DONE, the agent answered DONE anyway). Not caused by the budget.
  - Text to the agent fell only about 10% (608 KB -> 525-563 KB): `fastb look` shows the whole page, and agents start with it. Plain `fastb look` was about 190 KB per run, 9-11 calls over 8 KB. Next candidate: budget `fastb look` too, `fastb look --all` for everything.
- Decision A (2026-10-29, 23:10): `fastb look` is cut to the budget too; `fastb look --all` shows every line (skill text updated). 113 tests pass. Running: `phase8-final4.sh` (fastb x3) -> `results/final4-fastb-rN.jsonl`, log `results/phase8-final4.log`, started 23:17.
- final4 (budget on `fastb look` too, fastb x3, done 00:09): 19/22, 18/22, 19/22; total 1001 / 960 / 934 s (mean 965 s); 260 / 254 / 244 turns; $3.36 / $3.26 / $3.15; text to the agent 481 / 464 / 433 KB (mean 459 KB, final3 550 KB, final2 608 KB). Agents used `fastb look --all` 5-6 times per run.
  - Against the headless baseline (1517 s, 620 turns, $5.08, 17.5/22): 1.57x faster in total time, 2.45x fewer turns, 36% cheaper, +1.2 tasks.
