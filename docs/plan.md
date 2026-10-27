# fastb: build plan

Decision (2026-10-26): **general fastb core + a small gas pipeline pack as the showcase.**

Hard deadline: **Wed Nov 4, 9:00 PM ET = Thu Nov 5, 03:00 Belgrade.** Submit well before it.

Judged on: creativity, technical ambition, whether it works. Judges score from the 3-minute video.

## Baseline to beat (docs/baseline-2026-10-26.md)

Claude Code + Playwright MCP on 22 REAL tasks: 62 s, 27 turns, $0.25 per task (median), 59% success. Model time is 83% of the total.

**Goal:** 2–3x faster and 2–3x fewer turns, same or better success.

## Phases

Each phase ends with a "done when" check. Do not start the next phase before it passes, except where noted.

### Phase 1 · Engine skeleton · done 2026-10-27 (review pending)
- [x] Background engine + thin CLI, talking over a local socket. CLI starts the engine if it is not running.
- [x] Browser link: launch Chrome (own profile, `--headless` optional), or connect to a running Chrome over CDP (`--cdp http://127.0.0.1:9222`). Options stick until changed.
- [x] `fastb open <url>` (prints the page, `--quiet` to skip), `fastb look` (page as short text with refs: `@e3 button "Save"`), `look --shot`, `look --full`, `status`, `stop`.
- [x] Settle: wait for no DOM changes for 300 ms and no visible loading indicator (max 8 s on open, 3 s on look). No "network idle".
- [x] Compactor: DashDish home page 109,542 → 18,168 chars (6.0x). 10 unit tests.
- **Done when:** `fastb open` + `fastb look` work on a REAL site from the terminal. **Met 2026-10-27** (GoMail, DashDish; own Chrome, headless, CDP).
- Notes: GoMail has a built-in ~6.5 s fake loading screen. `look` on a settled page: ~0.4 s. CLI start (node, built): ~25 ms.

### Phase 2 · Chunks · done 2026-10-27 (review pending)
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

### Phase 3 · Changes-only feedback and agent link · done 2026-10-27 (review pending)
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

### Phase 4 · First measurement and tuning (checkpoint)
- [ ] `fastb-bench`: new setup "claude-code + fastb". Run the 22 tasks.
- [ ] Read every failed and slow run. Fix the engine and the skill text. Re-run.
- **Checkpoint:** at least 1.5x faster with the same success. If not, stay in phases 2–4 until it is.

### Phase 5 · Draft and verify (Meta model at the core)
- [ ] Drafter: Meta open-weight model (Muse Spark Open via partner inference, or Muse Glimmer local) gets goal + page text and proposes the next chunk.
- [ ] `fastb look` returns the draft with the page. The big agent approves, edits, or ignores it in the same turn.
- [ ] Measure: turns saved, draft acceptance rate.
- **Done when:** draft-and-verify runs on the 22 tasks with numbers.

### Phase 6 · Gas pipeline pack
Can start in parallel with phase 5 once phase 4 passes.
- [ ] Learn once: Muse Spark visits a pipeline site and writes a routine (chunk) to reach its critical notices / capacity page. fastb saves it.
- [ ] Replay at code speed. If the page changed and the routine fails, the model repairs it (self-healing).
- [ ] 5–8 open sites: Kinder Morgan, Enbridge, TC Energy, Energy Transfer, Boardwalk (GasQuest), Williams Northwest.
- [ ] Deadline race: normal agent vs fastb across the sites, with a cycle cutoff timer.
- **Done when:** one command checks all sites and prints new notices.

### Phase 7 · Proof
- [ ] Full benchmark: 3 runs per task, both setups.
- [ ] Ablation chart: smart waits → + chunks → + diffs → + draft-and-verify.
- [ ] One run with Codex (`codex exec`), to show it works with both agents.
- [ ] Claude in Chrome on 3 tasks by hand, timed, for the video.
- [ ] MCP wrapper, only if everything above is done.

### Phase 8 · Video and docs
- [ ] Video script (3 min): pain → how it works → benchmark race → gas deadline race → numbers + Meta model role.
- [ ] Record and edit. Show only work built during the event.
- [ ] README: install, commands, benchmark numbers, how the Meta model is used.

### Phase 9 · Ship
- [x] Participant guide moved out of the repo (`~/.fastb/private/`), removed from history 2026-10-27.
- [ ] Open the public repo logged out.
- [ ] Submit on the CV platform, well before the deadline.
- [ ] Post the demo on X (Most Viral prize, deadline Nov 8, 23:59 ET).

**Start phases 8 and 9 early enough to finish them calmly, whatever state the earlier phases are in.**

## If we fall behind (cut in this order)

1. MCP wrapper.
2. Codex run.
3. Self-healing in the gas pack (keep replay only).
4. Gas pack down to 3 sites.
5. Draft-and-verify (fall back to chunks + diffs only; then the Meta model drafts routines in the gas pack, so it stays at the core).

Never cut: the benchmark numbers and the video.

## Meta model use (must be real, not decoration)

- Draft-and-verify drafter: Meta open-weight model (open-weights prize).
- Gas pack: Muse Spark learns and repairs routines and reads notices.
- Optional: Muse Spark as the big planner in one benchmark run, to show a full Meta pipeline.

## Open questions

- Partner inference for Muse Spark Open: which provider, any credits? (Discord)
- Judging weights: guide (equal) vs public rules (30/25/20/25)? (Discord)
