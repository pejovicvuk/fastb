# fastb: build plan

Decision (2026-10-26): **general fastb core + a small gas pipeline pack as the showcase.**

Hard deadline: **Wed Nov 4, 9:00 PM ET = Thu Nov 5, 03:00 Belgrade.** Submit well before it.

Judged on: creativity, technical ambition, whether it works. Judges score from the 3-minute video.

## Baseline to beat (docs/baseline-2026-10-26.md)

Claude Code + Playwright MCP on 22 REAL tasks: 62 s, 27 turns, $0.25 per task (median), 59% success. Model time is 83% of the total.

**Goal:** 2–3x faster and 2–3x fewer turns, same or better success.

## Phases

Each phase ends with a "done when" check. Do not start the next phase before it passes, except where noted.

### Phase 1 · Engine skeleton
- [ ] Background engine + thin CLI, talking over a local socket. CLI starts the engine if it is not running.
- [ ] Browser link: launch Chromium, or connect to a running Chrome over CDP (`--cdp http://127.0.0.1:9222`).
- [ ] `fastb open <url>`, `fastb look` (page as short text with refs: `@e3 button "Save"`), `fastb look --shot`.
- **Done when:** `fastb open` + `fastb look` work on a REAL site from the terminal.

### Phase 2 · Chunks
- [ ] Line-format parser: `goto`, `fill "X" = v`, `click "X"`, `select "X" = v`, `press Enter`, `check "X"`, `wait for text|gone "X"`, `expect text|url|value`.
- [ ] Target resolution: ref (`@e3`) → exact role + name → label/placeholder → fuzzy text. Ambiguous → stop and report the choices.
- [ ] Smart waits: after each step wait for the expected change or a short quiet window, never "page idle".
- [ ] Stop on surprise: report step number, expected, seen.
- **Done when:** a 5-step form chunk runs in one call and stops correctly when a step fails.

### Phase 3 · Changes-only feedback and agent link
- [ ] Snapshot diff: after a chunk, return only what changed (added / removed / changed lines).
- [ ] Safety gate: delete / pay / send / submit-order words stop the chunk unless `allow`.
- [ ] Stats log (`~/.fastb/stats.jsonl`) and `fastb stats`.
- [ ] Skill file for Claude Code (and AGENTS.md text for Codex).
- **Done when:** Claude Code finishes a REAL task using only fastb.

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
- [ ] Remove `docs/participant-guide.txt` (private). Make the repo public. Open it logged out.
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
