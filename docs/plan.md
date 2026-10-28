# fastb: build plan

Decision (2026-10-26): **general fastb core + a small gas pipeline pack as the showcase.**

Hard deadline: **Wed Nov 4, 9:00 PM ET = Thu Nov 5, 03:00 Belgrade.** Submit well before it.

Judged on: creativity, technical ambition, whether it works. Judges score from the 3-minute video.

## Baseline to beat (docs/baseline-2026-10-26.md)

Claude Code + Playwright MCP on 22 REAL tasks: 62 s, 27 turns, $0.25 per task (median), 59% success. Model time is 83% of the total.

**Goal:** 2–3x faster and 2–3x fewer turns, same or better success.

## Phases

Each phase ends with a "done when" check. Do not start the next phase before it passes, except where noted.

### Phase 1 · Engine skeleton · done 2026-10-27, Codex review passed
- [x] Background engine + thin CLI, talking over a local socket. CLI starts the engine if it is not running.
- [x] Browser link: launch Chrome (own profile, `--headless` optional), or connect to a running Chrome over CDP (`--cdp http://127.0.0.1:9222`). Options stick until changed.
- [x] `fastb open <url>` (prints the page, `--quiet` to skip), `fastb look` (page as short text with refs: `@e3 button "Save"`), `look --shot`, `look --full`, `status`, `stop`.
- [x] Settle: wait for no DOM changes for 300 ms and no visible loading indicator (max 8 s on open, 3 s on look). No "network idle".
- [x] Compactor: DashDish home page 109,542 → 18,168 chars (6.0x). 10 unit tests.
- **Done when:** `fastb open` + `fastb look` work on a REAL site from the terminal. **Met 2026-10-27** (GoMail, DashDish; own Chrome, headless, CDP).
- Notes: GoMail has a built-in ~6.5 s fake loading screen. `look` on a settled page: ~0.4 s. CLI start (node, built): ~25 ms.

### Phase 2 · Chunks · done 2026-10-27, Codex review passed
- [x] Line-format parser: `goto`, `click`, `hover`, `check`/`uncheck`, `fill "X" = v`, `type`, `select`, `press [target] Key`, `wait 500ms`, `wait for text|gone "X"`, `expect text|no text|url|value`. Targets: `@ref`, `"Label"`, `role "Name"`, `#n`.
- [x] Target resolution, in tiers: role + exact name → label/placeholder → text → loose matches → HTML fallbacks (`button` that contains the text). More than one match → stop and list the choices (`#n`).
- [x] Smart waits: elements are searched again until 5 s; after clicks and key presses the page settles (quiet 200 ms, max 3 s). No "page idle".
- [x] Stop on surprise: step number, the step, the reason, steps done, then the page.
- [x] Input: heredoc / pipe, `--file`, or one step per argument. `--no-look` prints only the page header.
- [x] `--fresh`: temporary empty profile.
- **Done when:** a 5-step form chunk runs in one call and stops correctly when a step fails. **Met 2026-10-27:** REAL gomail-3 (compose email) passes the benchmark checker (reward 1) with one 6-step chunk in 0.9 s (baseline: 51 s, 12 turns). A chunk with a missing button stops at that step with the reason.
- Lessons:
  - REAL sets `hide_aria_labels: true`: many controls have no names. fastb must work without names.
  - Playwright's role search (`getByRole`) misses some elements that the snapshot shows as buttons on these sites. HTML fallbacks fix it.
  - Rich-text editors (contenteditable) have no role: `look` marks them `role=textbox` before the snapshot.
  - Refs belong to the latest AI snapshot of the frame. Never take an element-level AI snapshot after the page snapshot (it renumbers refs).
  - The saved profile keeps site data between runs (a stale draft broke the recipient). Benchmarks use `--fresh`.
  - GoMail's "To" field needs the suggestion clicked, not just text.

### Phase 3 · Changes-only feedback and agent link · done 2026-10-27, Codex review passed
- [x] Snapshot diff: after a chunk, return only what changed since the agent's last view (`+` added, `-` removed, `~` same ref with a new value or state, plus the section headers above each change). Full page instead when there is no base, the tab changed, or the changes are not much shorter (over 70% of the full page).
- [x] Safety gate: a click on a delete / pay / checkout / send / order / book control stops the chunk unless it has an `allow` line.
- [x] Stats log (`~/.fastb/stats.jsonl`, no page text or urls) and `fastb stats` (runs, steps, chars sent, chars saved by diffs).
- [x] Skill file for Claude Code (`skill/fastb/SKILL.md`) and the same text for Codex (`skill/AGENTS.md`).
- **Done when:** Claude Code finishes a REAL task using only fastb. **Met 2026-10-27:** `claude -p` (sonnet) with only `Bash(fastb:*)` and the skill did dashdish-2 (order a pizza): reward 1, 10 turns, 57 s, $0.18. One run only, not a benchmark number (baseline row: 85 s, 33 turns). Script: `.fastb/agent-run.sh <task-id>`.
- Lessons:
  - Playwright keeps a ref while the element keeps its role and name, so "same ref, new text" is one changed element.
  - Ref prefixes (`f1e`, `f2e`) change on a real navigation: every ref is new and the diff falls back to the full page. That is correct.
  - GoMail hides all aria labels while the compose dialog is open, so the first click after open changes every ref (full page once).
  - The agent first wrote short chunks with `wait 1000ms` after clicks, and hit the safety stop at "Checkout" although the task said "purchase". Skill text now says: no fixed waits; put `allow` in from the start when the task asks for it.
  - In that run some clicks took 4 s (settle after navigation). Look at this in phase 4.
  - Gate words can hit harmless controls (GoMail "Remove star from email ..."). Count false stops in phase 4.

### Phase 4 · First measurement and tuning (checkpoint) · met 2026-10-27, Codex review passed
- [x] `fastb-bench`: new setup "claude-code + fastb" (`run_fastb.py`, `run_all_fastb.sh`, `compare.py`). Ran the 22 tasks twice.
- [x] Read the failed and slow runs. Fixed the engine and the skill text. Re-ran.
- **Checkpoint:** at least 1.5x faster with the same success. **Met (just) 2026-10-27, run 2:** median 62 s -> 41 s (1.51x), success 13/22 -> 16/22, turns 27 -> 12, cost $5.61 -> $3.91. One run per task. Details: `docs/bench-2026-10-27.md`.
- Lessons:
  - Run 1 halved the turns but not the time: fastb's own waits were 42% of the total. Read where the time goes before tuning the model side.
  - A progressbar with a value is not a loading sign (Staynb rating bars).
  - Waiting does not bring back a gone ref. Saying what covers a button saves turns.
  - Agents still send short chunks when they explore a new page. Long chunks come when the page is known.
- Run 3 (2026-10-27, fastb text in CLAUDE.md + "chain ahead" skill text): median 62 s -> 33 s (1.89x), success 13/22 -> 15/22, turns 27 -> 10, cost $5.61 -> $3.57.
- Decision (2026-10-27): no draft-and-verify. Claude Code and Codex stay the agents; the Meta model works inside fastb (see phase 5).
- Next (optional, before phase 7): read the 6 tasks both setups fail (fly-unified x3, opendining-3/4, topwork-1).

Decision (2026-10-28): **parallel lanes.** One agent turn drives many isolated browsers at once, you watch them all live, and a Meta model checks each lane. Draft-and-verify and the gas pack are dropped. Why: our data says the cost is model round trips; chunks cut them 27 -> 10 per task, lanes cut them per batch of tasks. Research on what exists: `docs/research-gaps.md`, plus the parallel search in this decision (Steel / Browserbase have cloud sessions with live view; Playwright / QA Wolf run written tests in parallel; none found where a coding agent fans out many local lanes in one turn and gets one checked answer).

### Phase 5 · Parallel lanes (core) · done 2026-10-28, Codex review: 9 rounds, findings fixed
- [x] `fastb lanes`: one input with several blocks (`lane <name>` then its steps). Each new lane gets its own isolated browser context (own cookies and storage). All lanes run at the same time.
- [x] Answer: one short line per lane (`[b] STOP at step 3/5: click "Pay": reason`), then that lane's changes only. Lanes stay open: `fastb run --lane b`, `fastb look --lane b`, `fastb lanes look` (all pages), `fastb lanes close`.
- [x] Engine: many contexts in one Chrome (own Chrome: a launched browser for lanes; CDP: new contexts in that Chrome). `--timezone` and `--clock` for lane contexts (tests at a fixed time).
- [x] Unit tests: lanes parser, combined answer.
- **Done when:** one `fastb lanes` call runs 6 REAL tasks in 6 lanes at once, and each lane passes the REAL checker where the same task passes alone. **Met 2026-10-28** (`run_lanes.py`, batch six-a): 6/6 passed, 84 s, 17 turns, $0.23. Same 6 tasks one by one: baseline 293 s, 103 turns, $1.00; fastb 104 s, 34 turns, $0.63.
- Lessons:
  - The agent's first move was a shell loop over the lanes; Claude Code's `Bash(fastb:*)` permission blocks loops. Added `fastb lanes look`.

### Phase 6 · Live grid · done 2026-10-28, Codex review: 9 rounds, findings fixed
- [x] `fastb watch`: a local page with one live tile per lane (CDP screencast), the current step, a status color, and a short flash on each element fastb acts on. Server written by a Codex worker (`src/watch/`), wired and tested here.
- **Done when:** 12 lanes are visible live while they run, and watching slows the runs by less than 10%. **Met 2026-10-28:** 12 lanes on 6 REAL sites shown live (screenshot check). 6-lane run, 3 times each: 8.4 / 8.1 / 8.3 s without a viewer, 8.5 / 8.3 / 8.2 s with one (about 0%). A viewer got 35 frames in 8 s from 2 lanes. Script: `.fastb/grid-overhead.sh`.

### Phase 7 · Meta model checks every lane (Muse Spark 1.3 via the Meta API) · done 2026-10-28, Codex review: 9 rounds, findings fixed
- [x] Commit check: at a gated click (send / pay / book), Muse Spark compares a checklist made from the task with what the page holds (field values, review page). A mismatch stops that lane with a short reason. (Held request bodies: not built.)
- [x] Lane report: `fastb lanes report`. Muse Spark groups all lanes' latest results into one short answer (which passed, which failed, the shared cause).
- **Done when:** it stops a lane with a planted wrong value, lets the correct lanes through, and the report groups planted failures by cause. **Met 2026-10-28** on REAL OpenDining, 6 lanes with a `task` line: 2 right bookings clicked; 2 wrong dates and 2 wrong party sizes stopped before the click, each with the exact value. Report (2.2 s, same in 2 runs): "2 ok; stopped (2), party size is not 4 people (2 people, 6 people); stopped (2), date is not July 20 (Jul 19, Jul 21)". Checks ~1.6 s each, run at the same time across lanes.
- Fixed on the way: "Complete reservation" was not a gated word; the API key was looked up only in the fastb home; a failed check was silent (now a `note:` line); a nameless field showed its value as its name (`textbox "+1"` is now `textbox = "+1"`); the report first made one group per lane (prompt now groups by the kind of problem).
- What goes to the Meta API: only when a person writes `on` to `~/.fastb/remote-check` (off by default; no fastb command writes it, and an agent limited to `Bash(fastb:*)` cannot). Then: the task text, the gated button's label, visible field values and up to 4,000 characters of visible text, with private values hidden first (fields labelled card / CVV / account / IBAN / password and similar; 6+ digit numbers and emails the task does not name; the URL query). Dates stay. Never password fields. Report: built only from each lane's structured outcome (OK / STOP, the step's kind and target, the reason), never from page text. The bench harnesses write it before a run and remove it after (REAL data is fake).
- Codex review, 9 rounds (2026-10-28): every finding fixed with a test. Stopped after round 9 by plan (A): the feature is off by default, only a person turns it on, and the bench data is fake. **Known limits** (for the README): (1) with the check on, visible page text is sent to the Meta API; hiding is by pattern (secret labels, card-like and long numbers, emails, tokens, URL queries, values after CVV / PIN / password / token words, values typed into secret fields), so private values without such a shape (names, addresses) can still be sent; (2) a few ms remain between the second page read and the click, and the real request is not held for checking; (3) long numbers are hidden, so the check cannot compare phone or account numbers.
- Codex review rounds 2 and 3 (2026-10-28) found more leak paths (lane report, URL path, button label, secrets repeated in page text) and second-read gaps (nameless fields, URL, page text, a failed second read). All fixed, with tests of the whole outgoing text and of the check flow with failing reads (`runCommitCheck`).
- Codex review (2026-10-28) found 4 issues, all fixed with tests: private data reached the Meta API (now opt-in + redaction); the watch stream had no access control (now a secret path, Host and Origin must be this server, typed values hidden in step text); a page change during the check was not seen (fields are read again after the verdict; a change stops the click; a few ms remain before the click, and held requests are not built); lanes starting together launched one browser each (now one shared launch).

### Phase 8 · Proof
- [x] Rerun baseline and fastb with the browser at US Pacific time, July 18, 2024 (the REAL v1 task era). Done 2026-10-28 (run 4): success 17/22 both, median 74 s -> 36 s (2.07x), turns 30 -> 10, cost -40%.
- [x] Parallel benchmark: K REAL tasks in one agent prompt. Claude Code + fastb lanes vs baseline doing them one by one. Metrics: total wall time, success, turns, cost. Done 2026-10-28: all 22 tasks in 3 batches: 18/22, 693 s, 138 turns, $2.52 vs baseline 17/22, 2301 s, 632 turns, $5.77 (3.3x faster). One run per batch.
- [ ] 3 runs per task, both setups. One run with Codex (`codex exec`).
- [ ] Race on one task, timed, for the video: Codex's own browser (screenshots and a moving cursor) vs Codex + fastb; Claude in Chrome by hand.

### Phase 9 · Video and docs
- [ ] Video script (3 min): the slow cursor -> one turn, many browsers, live grid -> the Meta model catches a wrong lane -> numbers.
- [ ] Record and edit. Show only work built during the event.
- [ ] README: install, commands, benchmark numbers, how the Meta model is used.

### Phase 10 · Ship
- [x] Participant guide moved out of the repo (`~/.fastb/private/`), removed from history 2026-10-27.
- [ ] Open the public repo logged out.
- [ ] Submit on the CV platform, well before the deadline.
- [ ] Post the demo on X (Most Viral prize, deadline Nov 8, 23:59 ET).

**Start phases 9 and 10 early enough to finish them calmly, whatever state the earlier phases are in.**

## If we fall behind (cut in this order)

1. MCP wrapper.
2. Claude in Chrome race.
3. 3 runs per task (keep 2).
4. Lane report (keep the commit check).
5. Element flash in the live grid.

Never cut: lanes, the live grid, the Meta model check, the benchmark numbers, the video.

## Meta model use (must be real, not decoration)

- Muse Spark 1.3 (Meta API, credits): commit check on every lane, and the lane report.
- Optional: Muse Glimmer (open weights, local) runs the same check, if a first test shows it is fast enough on the Mac. That would fit the open-weights prize.

## Open questions

- Partner inference for Muse Spark Open: which provider, any credits? (Discord)
- Judging weights: guide (equal) vs public rules (30/25/20/25)? (Discord)
