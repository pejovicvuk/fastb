# Research: open gaps in agent browser and computer use (2026-10-27)

Question: what is still unsolved in how Claude Code, Codex and computer-use agents use the browser and the computer, that one developer can build on fastb in the build time left, with a Meta model doing real work?

Method: read our REAL run 3 results and transcripts, then searched papers, official docs and repos for each candidate. Where a claim comes only from an abstract or a search summary, it says so.

## 0. First finding: most "both fail" tasks are probably our test setup, not the agent

Read from `~/Desktop/fastb-bench/results/*-fastb-20261027-17*.json` (state + final answer) and the task files in the agisdk package.

| Task | What happened | Likely cause |
|---|---|---|
| opendining-3 | Booking saved with date `2024-07-19T22:00:00.000Z`; check wants `2024-07-20` | Browser runs in Europe/Belgrade (UTC+2). Local midnight of July 20 is July 19 in UTC. Strong evidence. |
| opendining-4 | Saved `2024-09-01T22:00:00.000Z`; check wants `2024-09-02` | Same timezone shift. Strong evidence. |
| fly-unified-2, -4 | Site rejects card expiry 12/25 and 06/26 | Browser clock is Oct 2026, tasks were written for 2024. Likely. A missing "12:00" flight is not explained yet. |
| fly-unified-9 | Task gives no CVV; agent stops and asks | Task data gap. |
| topwork-1 | Title saved as "Frontend Developer needed (React and TypeScript)"; check wants "Frontend Developer"; agent said DONE | Agent error, false DONE. |

Supporting evidence: REAL's own v2 eval scripts were later made "robust to different separators/timezones" (`agisdk/REAL/browsergym/webclones/v2/eval_scripts/eval_opendining_6.py`, line 32, in the bench venv; repo: https://github.com/agi-inc/agisdk). The v1 expected values (12:00 flight = `20:00Z`) imply US Pacific time.

Fix (both setups, same Chrome, so it stays fair): set the browser timezone to America/Los_Angeles (Playwright `timezoneId`, https://playwright.dev/docs/emulation, or `TZ` on the Chrome process) and fix the clock to the task era (Playwright clock, https://playwright.dev/docs/clock). Not verified by a rerun. Rerun both setups before using any new success number.

A second finding feeds idea 1: **most failures are confident false DONEs.** Run 3: 4 of 7 failures ended with "DONE." while the state was wrong (opendining-3, opendining-4, staynb-9 with 12 infants instead of the maximum 16, topwork-1). Baseline: 6 of 9 (gomail-8, opendining-3, opendining-4, staynb-9, topwork-1, zilloft-6). This matches research: false success is 45 to 48% of failures on tau2-bench and 75.8% on AppWorld, and LLM judges that read transcripts reach only AUROC 0.65 (https://arxiv.org/abs/2606.09863, abstract).

## 1. What exists (do not propose)

Listed by Vuk, links not re-checked: Skyvern code caching, Stagehand caching, Browser Use workflow-use; Agent Workflow Memory, SkillWeaver, WebXSkill, ASI, WALT, MuscleMemory; Playwright CLI + skills, Playwright MCP, Vercel agent-browser, Browser Use, Chrome DevTools MCP; Skim (https://arxiv.org/abs/2605.16565); draft-and-verify (rejected).

Found in this pass, near the gaps below:

- **Human confirm before risky actions.** Claude for Chrome "asks users before taking high-risk actions like publishing, purchasing, or sharing personal data" (https://claude.com/blog/claude-for-chrome). A person checks, not a machine.
- **Assertions written by the user or agent.** Skyvern validation blocks: `complete_criterion` / `terminate_criterion`, "works like an assertion", placed "after login and before submitting" (https://skyvern.com/docs/developers/going-to-production/error-handling). Playwright MCP `--caps=testing`: `browser_verify_value`, `browser_verify_text_visible` (https://github.com/microsoft/playwright-mcp). fastb `expect` lines are the same kind.
- **Self-reported success.** Browser Use: "is_successful is the agent-reported outcome; verify important external actions independently" (https://docs.browser-use.com/llms.txt).
- **Judges after the run, for evaluation.** WebJudge, about 85% agreement with humans (https://arxiv.org/abs/2504.01382). AgentRewardBench: no judge is best on all benchmarks (https://arxiv.org/abs/2504.08942).
- **Pre-action checks in research.** VeriSafe Agent: turns the user instruction into a formal spec and checks actions before they run; mobile GUI, GPT-4o, 98.33% accuracy (https://arxiv.org/abs/2503.18492, abstract). Supervisor / AgentBait: intention check against bait attacks, a security tool (https://arxiv.org/abs/2601.07263). VIGIL: verify-before-commit against tool injection (https://arxiv.org/abs/2601.05755). "Look Before You Leap": validity checks for shell commands and code edits, not intent (https://arxiv.org/abs/2609.11957).
- **Privacy layers.** Minim: a local broker filters and abstracts accessibility trees before a remote web agent sees them; ICML 2026; code at github.com/yyyyhx/MINIM (https://arxiv.org/abs/2606.13949, abstract). MemPrivacy: reversible typed placeholders, for agent memory (https://arxiv.org/abs/2605.09530). PAPILLON: a local model rewrites chat queries for a cloud model (https://arxiv.org/abs/2410.17127). PII Shield: browser extension, local redaction for chat (https://arxiv.org/abs/2603.24895). Browser Use `sensitive_data`: the user lists secrets ahead of time; "The LLM only sees placeholders"; values go into fields after the model call (https://docs.browser-use.com/open-source/examples/templates/sensitive-data.md). AgentDAM (Meta FAIR): measures leaks by web agents (https://arxiv.org/abs/2503.09780).
- **Vision for UI with no accessibility data.** Midscene.js: vision `aiAct` / `aiAssert`, names HTML canvas (https://midscenejs.com/). Playwright MCP `--caps=vision`: coordinate click and drag.
- **Screen video for coding agents.** vidin: keyframes plus a timeline over MCP (https://github.com/teunlao/vidin). Clipy: frames, transcript, pointer data (https://clipy.online/).
- **Wait for a meaningful change.** changedetection.io "AI change detection rules" in plain English, any LLM, also local (https://github.com/dgtlmoon/changedetection.io).

## 2. Candidate ideas, ranked

### Idea 1: Commit check. fastb proves the task is right before the point of no return

**The gap.** Agents say DONE when the state is wrong (section 0). Today a person confirms (Claude for Chrome), or someone writes the assertions by hand (Skyvern, Playwright MCP, fastb `expect`), or a judge reads the transcript after the fact (WebJudge). Judges that read transcripts are weak at this (AUROC 0.65, https://arxiv.org/abs/2606.09863). Missing: a check that the browser tool runs **by itself** at the irreversible click, that derives the checks **from the task text**, and that compares them with **state evidence** (field values, the review page, the request about to be sent), not with the agent's own words.

**Searched:** "verify intent before irreversible action web agent", "check form values against instruction before submit", Browser Use and Skyvern docs, Playwright MCP README, false-success papers. **Closest:** VeriSafe Agent (same idea of intent-to-spec, but per action, mobile, research code only, and it gates actions, not end state). Skyvern validation blocks (criteria written by the user, inside Skyvern's own agent). No tool found that does this for Claude Code or Codex.

**Meta model's job.** Muse Spark 1.3 (API). Job 1: turn the task into a checklist of end-state facts, for example `title == "Frontend Developer"`, `infants = max allowed`, `date = 2024-07-20`, `time = 7:00 PM`. Job 2: at the gate, read the evidence and return OK, or a short list of mismatches with the field to fix. Benchmark data is fake, so the API is allowed. For private pages, the same prompts run on Muse Glimmer locally.

**What we build on fastb** (each part has a done-when):
1. `fastb task "<text>"` stores the goal; Muse Spark returns the checklist (JSON, cached). Done when it gives sensible checklists for the 22 REAL goals.
2. Evidence at the safety gate: label + value of every input, select, checkbox and stepper on the page (from the snapshot, plus min/max/disabled), the visible review text, and any held request. Hold-and-release: `page.route` holds POST/PUT/PATCH/DELETE after a gated click and shows the body. REAL clones keep state in the page, so DOM evidence is the main source there.
3. Verdict in the stop message, short: `CHECK step 7 click "Book": infants 12, task wants max (16)`. The agent fixes it in the next chunk, or overrides with `allow unchecked`.
4. Receipt after commit: three lines from the confirmation page, each checklist item with its evidence.
5. Bench: a false-DONE column in `compare.py` (agent ended with DONE, checker failed).

**How we measure it.** REAL, same 22 tasks (plus more v1 form tasks if time allows), after the timezone/clock fix, both setups. Metrics: success, false-DONE rate, gate false alarms (blocks on runs that would pass), added seconds per task, Meta API cost per task. Today: 4 false DONEs in run 3. Honest expectation: staynb-9 and topwork-1 look catchable; opendining-3/4 only if the saved value is in the evidence, and the timezone fix should solve them anyway. So the REAL lift may be small. More form tasks give a fairer count.

**3-minute demo.**
- 0:00 Hook: "Browser agents say DONE when they are wrong. In our benchmark, 4 of 7 failures were confident DONEs."
- 0:20 Baseline (Claude Code + Playwright MCP) books a stay, says "DONE.", the REAL checker shows 12 infants, not 16.
- 0:50 fastb, same task: the chunk stops at "Book": `CHECK: infants 12, task wants max (16)`. The agent fixes it in one turn. The checker passes. A receipt prints.
- 1:40 A real public site form: the held request body on screen, checked, then released.
- 2:10 Numbers: success, false DONE, speed, cost (from fastb-bench only).
- 2:40 How Muse Spark does the checking. Close.

**Main risk.** Too few false DONEs on REAL to show a clear gain, and false alarms that cost turns. Also novelty is "VeriSafe idea, first tool form for coding agents, on end state", not a brand-new concept. Say that plainly in the video and README.

### Idea 2: Privacy-blind browsing. The cloud agent acts on private pages without seeing private data

**The gap.** fastb connects to the user's real, logged-in Chrome. Every `look` then sends mail, names, addresses and account numbers to the cloud agent. The hackathon rules themselves say: send no private data to the Meta API. Missing: a local layer that replaces private values in page text with stable placeholders (`PERSON_3`, `EMAIL_2`) in snapshots and diffs, and puts the real values back when the agent's chunk uses them (`fill "To" = EMAIL_2`, `click "PERSON_3"`, `expect text PERSON_3`).

**Searched:** "browser agent local model redact page content placeholders restore on action", "privacy-preserving web agent accessibility tree local model", Playwright MCP / agent-browser / Chrome DevTools MCP redaction, Browser Use docs. **Closest:** Minim (local broker filters accessibility trees for a remote web agent; research with code; filters and abstracts, does not say how actions on hidden values work). Browser Use `sensitive_data` (only secrets the user lists in advance, outbound only). MemPrivacy and PAPILLON (same placeholder idea, for memory and chat). No tool found that does reversible placeholders on page snapshots and resolves them inside actions. **Warning:** Minim is close. This idea exists as research; only the tool form is new.

**Meta model's job.** Muse Glimmer 30B, local (Apache 2.0, "built for local agentic workflows", https://dev.meta.ai/docs/muse-glimmer). It finds private spans in each snapshot and diff (names, addresses, free-text message bodies) after a regex pass for emails, phones and card numbers, and keeps the placeholder map consistent. The data never leaves the machine. Fits the $10K open-weights prize.

**What we build on fastb:**
1. `src/model/` client for a local runtime (llama.cpp or Ollama). Done when Glimmer answers on this Mac, or on a GPU we rent and control.
2. Pseudonymizer on `look` output and diffs, with a per-session map. Values from the task text pass through (the cloud agent already knows them).
3. Placeholder resolution in the chunk parser for `fill`, `click`, `select`, `expect`.
4. Leak counter: count the site's personal strings that reach the Claude transcript (`~/.claude/projects/<work_dir>/*.jsonl`).

**How we measure it.** REAL tasks with personal data (gomail, gocalendar, networkin): success with the layer on vs off, leak rate (personal strings in the transcript), added seconds per look. Second check: Minim's public code and data for a direct comparison, if it runs.

**3-minute demo.** Split screen: the real browser shows a (fake) inbox with names; the agent's view shows `PERSON_1 ... PERSON_7`. Claude Code replies to and archives mails, and fills a form with a real address it never saw. End: leak counter 0 vs N for Playwright MCP, success on vs off, "all private work on Meta's open-weights model, on this laptop."

**Main risk.** Speed: Glimmer 30B on a 24 GB Mac is heavily quantized and slow on full pages, which fights fastb's speed story (diffs help, the first full page does not). Second: Minim overlap. Third: tasks whose answer is a private value need a local reveal step.

### Idea 3 (weak, listed so it is not re-proposed): motion checks with SAM 3.1

Turn a short screen recording of a chunk into text tracks ("card 'Fix bug' moved from To do to Done", "spinner visible 2.1 s") with SAM 3.1 video tracking, and allow `expect` lines on them. SAM 3 finds and tracks objects in video from text prompts (https://arxiv.org/abs/2511.16719). Measure on WebGames visual and real-time tasks (150 tasks, password on success, https://arxiv.org/abs/2502.18356, https://github.com/convergence-ai/webgames). **Why weak:** Midscene already does vision targets and asserts on canvas, vidin and Clipy already turn screen video into agent-readable frames, and SAM is not trained on UI elements (untested). The new part is narrow. SAM 3.1 facts come from secondary coverage only (Meta's own SAM 3.1 page not read).

### Dropped after search

- Semantic waits ("wake the agent when X happens"): changedetection.io has plain-English AI rules.
- Visual refs for canvas UI: Midscene, Playwright MCP vision mode.
- Desktop chunks over the macOS accessibility tree: tools exist (not re-checked in depth in this pass).
- Look-ahead exploration while the agent thinks: close to Skim, speculative actions, and SkillWeaver exploration; also dropped earlier ("pre-run clicks").

## 3. Recommendation

**Build idea 1 (Commit check), after the timezone/clock fix.**

Why:
- It hits the largest measured failure mode in our own data (4 of 7 failures in run 3, 6 of 9 in the baseline are false DONEs), and research says LLM judges on transcripts cannot catch these well. Our check uses state evidence instead.
- It grows out of what fastb already has (safety gate, snapshot with values, chunk stop message). No new dependency.
- The Meta model's job is clear and visible in the demo: it writes the checklist and finds the mismatch.
- The demo story is simple and fits "give a machine a new capability": the agent can no longer lie about being done.

Keep idea 2 as the open-weights angle only if Glimmer runs fast enough on the Mac in a first test; otherwise drop it. Do the timezone/clock fix first in any case: it changes the baseline too, and both setups must be rerun.

## Not verified

- Timezone and clock as the cause of 4 failures: inferred from saved state and task files, not confirmed by a rerun.
- Whether the commit check would catch staynb-9 and topwork-1: a hypothesis.
- VeriSafe, Minim, MemPrivacy, false-success numbers: read from abstracts, not full papers. VeriSafe code release: not confirmed.
- Glimmer memory needs and speed on a 24 GB Mac: the Meta docs page does not give them.
- SAM 3.1 details: secondary sources only.
- Firecrawl `/monitor` was seen in search results but not opened.
