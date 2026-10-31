# Handoff prompt (2026-10-30)

Paste the text below into a new Claude Code session started in `~/Developer/fastb`.

---

You are the orchestrator for **fastb**, my solo entry in the Meta Global AI Developer Hackathon (Indie Developer track). Hard deadline: **Thu Nov 5, 03:00 Belgrade (Wed Nov 4, 9:00 PM ET)**. Judges score from a 3-minute video: creativity, technical ambition, does it work.

**Read first:** `AGENTS.md` (rules for you and Codex), `docs/plan.md` (phases, phase 7b and 8 notes), `docs/research-agents.md` (the ideas for your next task), `docs/research-lightpanda.md`. Older history is at the end of this file.

## What fastb is

A browser engine for AI coding agents (Claude Code, Codex). The agent sends a **chunk** (many steps) in one `fastb run`; a background engine (playwright-core, real Chrome) runs them and returns only what changed on the page. A failed step STOPs the chunk. Big views are cut to an 8 KB budget (`fastb look --all` shows all). A Meta Llama model checks risky clicks (pay, send, book) against the `task` line, and `fastb done` checks completion (DONE, NOT DONE, LIKELY DONE, NO PROOF). Lanes run tasks in parallel browsers. Skill text for agents: `skill/AGENTS.md` and `skill/fastb/SKILL.md` (keep both the same, apart from the header).

## State now (2026-10-30, evening)

- All work is committed (last: `d0265b4` research doc, `82ff73a` STOP cuts). 122 tests pass. `dist/` is built from the current code.
- Bench numbers (22 tasks, Claude Sonnet agent, mean of 3 runs; baseline = no fastb, headless: 17.5/22, 1517 s, 620 turns, $5.08):
  - final4 (view budget): 18.7/22, 965 s, 253 turns, $3.25: 1.57x faster, 2.45x fewer turns, 36% cheaper.
  - final5 (STOP cuts, current code): 18.3/22, 1074 s, 236 turns, $3.13, 27 STOPs per run (was 44). Time is worse than final4 because each Claude reply was slower (2.7 s against 2.1 s per turn, same context size); likely API speed at that hour, not proven.
  - Lanes: about 18.3/22, about 1000 s, about 150 turns, about $2.85. Codex + fastb: 18/22.
- Time split per run: Claude about 60%, browser steps about 25%, Meta checks about 12%.
- Fails that stay: fly-unified-9 and topwork-1 always; gomail-8 and staynb-9 often. False DONEs: gomail-8, topwork-1.
- Known limit (from the STOP cuts): "equal copies" can pick the first of 2 different records whose nearby text is the same (never for risky controls).

## Your task: decision A (Vuk, 2026-10-30)

Build ideas 1, 3 and 4 from `docs/research-agents.md`, get a Codex review, then run fastb x3 on the bench.

1. **Steps that may be skipped or branch.** Today chunks are a straight line (`src/chunk/parse.ts`, ops at lines 20-30; runner `src/chunk/run.ts` `runChunk`). Ideas: `optional <step>` (a not-found / covered / timeout failure skips the step and the chunk goes on; the output says which steps were skipped), and a one-line condition such as `if text "Sold out": <step>`. Keep the grammar tiny. Risky clicks still go through the safety gate and the commit check. The `fastb done` log (`recordActions` in `src/engine/main.ts`) must hold only steps that really ran. First check the final5 STOP reasons (see Tools) to see which STOPs these would remove.
2. **Start the Meta commit check early.** Today `gate()` in `src/chunk/run.ts` waits for `policy.check` just before the risky click (hook `check` in `hooksFor`, `src/engine/main.ts`, calls `runCommitCheck` with `readEvidence(page)`). Idea from Skyvern: start the check sooner (for example while the steps before the risky click run, or right after the last field step) and use its verdict only if the evidence the check read is still the same at click time; else check again. Safety first: never click on a verdict from different evidence. There are already "the page changed during the check" STOPs (5 in 3 runs).
3. **Small fixes:**
   - Native dialogs: fastb has no `page.on("dialog")` handler (checked), so Playwright dismisses `confirm()` in silence. Handle them on every page (main, lanes, new tabs), report them in the output (`dialog: confirm "..." accepted/dismissed`), and decide accept or dismiss by the safety rules (a confirm after a gated, allowed click may be accepted; else dismiss and say so). Dialog text is page text: local output only, never to the Meta API.
   - Chrome pop-ups that eat input: fastb sets no Chrome settings (checked; `launchPersistentContext` in `src/browser/session.ts` around line 146). Turn off the password leak warning, save-password bubble and autofill (launch args or profile Preferences). dev-browser does this in `src/daemon/sources/launch.ts` (MIT; ideas only).
4. Tests next to the code (`*.test.ts`), then a Codex review (see How to work), then fastb x3.

Do not build ideas 2 (`fastb ask`) or 5-10 unless Vuk says so. Vuk's other option was B: `fastb ask` answered by the Meta model; it may come next.

## Tools

- `.fastb/fb <args>` runs the built CLI. After code changes: `npx tsc -p .`, then `.fastb/fb stop` (the engine restarts with new code).
- Tests: `npm test` (starts headless Chrome; about 2-4 min). One file: `node --import tsx --test src/chunk/run.test.ts`.
- Bench (`~/Desktop/fastb-bench`, outside the repo):
  - Copy `phase8-final5.sh` to `phase8-final6.sh` (change the names to final6), then run it in the background: `./phase8-final6.sh > results/phase8-final6.log 2>&1` (Bash `run_in_background`, timeout 7200000, then `t3_background_wait`). About 1 hour and about $10 for 3 runs. Results: `results/final6-fastb-rN.jsonl`.
  - Each task starts a new engine from `dist/`: **never rebuild `dist/` while a bench runs.** Only one harness at a time (it uses the Chrome on CDP port 9222).
  - The harness writes `on` to `~/.fastb/remote-check` before a run and removes it after. Outside runs, the Meta checks are off.
  - Analysis: `python3 stops.py results/final5-fastb-r*.jsonl` counts STOP reasons; `python3 dump_turns.py results/final5-fastb-r1.jsonl /tmp/r1.txt` writes each task's commands and outputs from the agent transcripts (`~/.claude/projects/*<workdir>/*.jsonl`). Means: sum `success`, `wall_s`, `turns`, `cost_usd`, `fastb_ms` per results file.
  - Bench agents inherit Vuk's ELI5 output style; that is fine.

## How to work

- Codex review: T3 `delegate_task` with `target {driverKind:"codex", model:"gpt-6.1-sol", options:{reasoningEffort:"high"}}`, role `review`, mode `wait`, timeoutMs 900000. Give it the diff scope, what each change does, and the focus (safety: can anything click a risky control without intent, pick the wrong element, or leak a secret?). Every re-check is a new `delegate_task` with the findings and the fixes. Fix the findings yourself. The last change took 3 rounds.
- Code inside `evaluate` runs in the page: no named inner helper functions there (tsx adds a `__name` helper the page does not have). Inline loops are fine.
- Lightpanda (AGPL-3.0), Skyvern and workflow-use (AGPL-3.0), Notte (SSPL): ideas only, never their code. Clones in `~/Developer/_research/`; never build or run anything from them.
- Speed claims come only from bench runs. The builder does not grade itself.

## How I want you to work

- Talk to me in ASD-STE100 simple English (my ELI5 output style): short sentences; what you did, did it work, what I do now. Decisions: at most 2 options, with your pick.
- I commit and push. You write the commit message to `.fastb/commit-msg.txt` (end it with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`); I run `git add -A && git commit -F .fastb/commit-msg.txt`.
- Outward text (README, video script): no em dashes.
- Ask before adding a dependency. No secrets in the repo (Meta key in `~/.fastb/secrets.env`; send no private data to the Meta API). No code or data from `~/Developer/TCFramework`. The participant guide stays in `~/.fastb/private/`.
- Add each new decision and bench result to the History list below and to `docs/plan.md`.

## After this task

Phase 9: README with the bench numbers and known limits, the video (`docs/video-script.md` draft). Phase 10: submit before the deadline.

---

# History (older notes, oldest first)

## Handoff prompt (2026-10-27)

Paste the text below into a new Claude Code session started in `~/Developer/fastb`.

---

You are the orchestrator for **fastb**, my solo entry in the Meta Global AI Developer Hackathon (Indie Developer track, theme "Push the Frontier"). Hard deadline: **Thu Nov 5, 03:00 Belgrade (Wed Nov 4, 9:00 PM ET)**. Judged on creativity, technical ambition, and whether it works; judges score from a 3-minute video.

**Read first, in this order:** `AGENTS.md` (shared rules for you and Codex), `docs/plan.md` (phases, current state, lessons), `docs/product.md` (design), `docs/baseline-2026-10-26.md` (numbers to beat). Background: `docs/research.md`, `docs/hackathon.md`.

### What fastb is

A fast browser-execution engine for AI coding agents (Claude Code, Codex). The agent sends **chunks** (many steps + expected results) to a background engine; the engine runs them at code speed and stops at the first surprise. Goal: cut model turns, which are 83% of browser-agent time in our baseline. Later phases: changes-only feedback, draft-and-verify with a Meta open-weight model, and a gas pipeline (EBB) pack as the real-world showcase.

### State now (2026-10-28, paused)

- Direction: **parallel lanes** (docs/plan.md, decision 2026-10-28). Phases 1-4 done and pushed. Phases 5 (lanes), 6 (live grid) and 7 (Meta model commit check + lane report) built and meet their "done when"; **not committed yet**. Commit message ready: `.fastb/commit-msg.txt`.
- Results (docs/bench-2026-10-27.md): run 4, browser at US Pacific time / July 2024: fastb 2.07x faster than baseline per task (74 s -> 36 s), success 17/22 both. Lanes, all 22 tasks in 3 prompts: 18/22, 693 s vs baseline 2301 s (3.3x), 138 vs 632 turns, $2.52 vs $5.77.
- 92 tests pass. Build is current (`dist/`).
- Codex review of phases 5-7: 9 rounds, all findings fixed; stopped by plan (A). Known limits in docs/plan.md (phase 7).
- Remote check switch: a person writes `on` to `~/.fastb/remote-check` (removed now). Bench harnesses write it before a run and remove it after.

### Phase 8 paused by Vuk (2026-10-29)

- Done: Codex + fastb on all 22 tasks (`results/codex-r1.jsonl`): 16/22 passed. Harness fix: `codex exec` needs stdin closed (`stdin=DEVNULL` in run_codex.py), else it waits forever.
- Stopped in the middle: Claude Code + fastb r1 after 5 tasks (`results/fastb-r1-partial.jsonl`). Not started: fastb r2, r3; lanes x3; baseline x2.
- Decision A taken (2026-10-29): "proof of done" built (`fastb done`, `fastb lanes done`; docs/plan.md phase 7b). Live test on gomail-3 passes. Commit check flakes fixed on the way. Codex review: 4 rounds, all findings fixed. 103 tests pass, `dist/` is built. Commit message: `.fastb/commit-msg.txt`.
- Bench harnesses now start the test Chrome headless (Vuk: visible windows took focus). Baseline r2 + r3 run headless (`phase8-baseline.sh`); baseline r1 was headed. One headed r2 task was discarded (`baseline-r2-headed-discard.jsonl`).
- Baseline done, 3 runs (r1 headed, r2 + r3 headless): 17/22, 17/22, 18/22; median 75.7 / 56.1 / 65.9 s; total 2301 / 1436 / 1597 s.
- Final runs STOPPED by Vuk (2026-10-29, 09:53) after 1 task: `results/final-fastb-r1-partial.jsonl` (gomail-3 passed, agent used `fastb done`). Do not start any benchmark until Vuk says so. To start: `cd ~/Desktop/fastb-bench && nohup ./phase8-final.sh > results/phase8-final.log 2>&1 < /dev/null &` (fastb x3, lanes x3, Codex x1; results `results/final-*.jsonl`).
- Drafts waiting for the final numbers: `README.md` (rewritten, with a Mermaid diagram), `docs/video-script.md`, `LICENSE` (MIT).

### Next steps

1. Commit phases 5-7 with `git commit -F .fastb/commit-msg.txt` and push, if not done.
2. Phase 8 (proof): 3 runs per task / batch (baseline, fastb, lanes), Codex + fastb on 22 tasks (`run_codex.py`, smoke test gomail-2 passed: 22.5 s, 5 commands), the race vs Codex's own browser for the video.
3. Phase 9-10: video, README, submit (deadline Thu Nov 5, 03:00 Belgrade).

### Handy tools (gitignored, in `.fastb/`)

- `.fastb/fb <args>`: runs the built CLI (`node dist/cli.js`). Rebuild with `npx tsc -p .` after code changes, then `fb stop` so the engine restarts with new code.
- `.fastb/score.sh <task-id> <site-url>`: reads the site's `/finish` state through fastb and scores it with the REAL checker.
- REAL tasks: `~/Desktop/fastb-bench/.venv/lib/python3.12/site-packages/agisdk/REAL/browsergym/webclones/v1/tasks/`. Before a task: `fb open "<site>/config?run_id=0&task_id=<id>&latency=0" --headless --fresh --quiet`. Use only `"challengeType": "action"` tasks with `jmespath` checks. Offline sites: omnizon, udriver, marrisuite.
- Baseline harness: `~/Desktop/fastb-bench/run_baseline.py`, results in `results/baseline.jsonl`, `summarize.py`.

### Lessons that will bite you (details in docs/plan.md)

- Refs belong to the **latest** AI snapshot of the frame. Never take an element-level `ariaSnapshot({mode:"ai"})` after the page snapshot: it renumbers refs and makes them point at the wrong elements.
- `page.evaluate` with a transpiled function can fail under tsx (`__name` helper). Pass in-page code as a plain JS string.
- REAL sets `hide_aria_labels: true`; `getByRole` misses some buttons there. The target finder has HTML fallbacks.
- fastb's saved profile (`~/.fastb/profile`) keeps site data between runs. Benchmarks must use `--fresh`.
- Engine options (`--cdp`, `--headless`, `--fresh`) stick until changed.

### Open items

- Meta Model API: $150 free credits active. API key goes in `~/.fastb/secrets.env` as `META_API_KEY` (never in the repo; send no private data to the API while on free credits).
- Muse Spark Open is 816B: too big for my Mac (M5 Pro, 24 GB). Plan: partner inference for the open-weights prize, or Muse Glimmer 30B locally. Ask me for the Models page screenshot and Discord answers (partner inference credits, judging weights).

### How I want you to work

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
- Decision A (2026-10-30): cut STOPs (each costs a turn). final4 had 44 STOPs per run. Top causes from the agent logs, 3 runs: safety stop after the agent already said `allow` for the task (27; every one), lost ref after a re-render (20), covered click (20), several matches (25), read-only fill timing out (9).
  - Built: `allow` lasts for the task (asked at each risky click; goes with a new task, `done <other task>`, a closed lane); lost ref found again by role and name (only when unique now and in the agent's view, never for a risky name); covered click sends the click event to the element (not while a dialog is open, not disabled or inert, no key press); several matches: the only field, the only whole-word match, or the first of equal copies (item name in text, or one shared link); read-only fill fails at once (no secret value). `Session.onLanesClosed` drops a closed lane's task, allow and logs.
  - Codex review 3 rounds: round 1 6 findings, round 2 6, round 3 6; all fixed but one. Known limit: "equal copies" can pick the first of 2 different records whose nearby text is the same (never for risky controls). 122 tests pass.
- final5 (these fixes, fastb x3, 21:02-21:59): 18/22, 18/22, 19/22 (mean 18.3; gomail-3 fail in r1: the agent never clicked Send and ignored NOT DONE); total 1202 / 1048 / 973 s (mean 1074 s, final4 965 s); 246 / 225 / 236 turns (mean 236, final4 253: -7%); $3.17 / $3.06 / $3.15 (mean $3.13, final4 $3.25); STOPs 27 per run (final4 44: -38%).
  - Time went up although turns, output tokens and browser time did not: model seconds per turn 2.98 / 2.73 / 2.37 (final4 2.11-2.18), same context per turn (about 30 K cache read). Likely slower API replies at that hour; not proven.
- Decision A (2026-10-30, evening): build ideas 1, 3, 6, 7 from docs/research-agents.md (Vuk). Built `optional` / `if` steps, early commit check (+ one retry when the page moved), native dialog handling (tagged confirms), Chrome prefs against pop-ups. Codex review 5 rounds, all fixed but one known limit (a page can fake its own confirm's tag). Details in docs/plan.md phase 8.
- final6 (optional / if, early check, dialogs; fastb x3 stopped by Vuk in r3 after 6 tasks, 2026-10-31 01:50): r1 20/22, 980 s, 233 turns, $3.12; r2 17/22, 901 s, 221 turns, $3.05. Mean of 2: 18.5/22, 940 s, 227 turns, $3.09 (final5 1074 s, 236 turns). Against the headless baseline (1517 s, 620 turns, $5.08): 1.61x faster, 2.7x fewer turns, 39% cheaper. r3 partial: 6/6 (`results/final6-fastb-r3-partial.jsonl`). Not yet checked: STOP counts, and whether agents used `optional` / `if`.
