# Research: outside view and ideas for the last stretch (2026-10-29)

Question: where is fastb strong, where is it ordinary, and what are the 3 to 5 best ways to make it clearly stronger in the time left (deadline Thu Nov 5, 03:00 Belgrade)?

Method: read README.md, docs/plan.md, docs/bench-2026-10-27.md, docs/research-gaps.md, docs/hackathon.md, docs/video-script.md, docs/meta-models.md and skimmed src/. Then searched the web, GitHub issues (`gh search issues`) and official docs. "Secondary" means a blog or news summary, not the vendor's own page. "Unverified" means I could not confirm it from a primary source.

## 1. Honest assessment

**Strengths**

- **Real numbers on a public benchmark.** Few hackathon entries measure anything. fastb has 22 REAL tasks, the same Chrome and the same checker for every setup, several runs, and written caveats. Per task: 74 s -> 36 s, 30 -> 10 turns, -40% cost, success 17/22 both. Lanes: 3.3x faster for all 22 tasks. This is the strongest asset.
- **A clear, true insight.** "The model barely thinks, it is asked too often" (88 tokens per turn, 2 s per turn) is simple, surprising and backed by data. Good video material.
- **Engineering discipline.** 92 tests, 9-round adversarial reviews, privacy redaction, opt-in remote check, written known limits. Judges who open the repo will see care.
- **The commit check is the most original part.** A Meta model compares the task with the page before an irreversible click, and stops it with the exact wrong value. I found no shipping browser tool for coding agents that does this (see section 3).

**Weaknesses (what a skeptical judge will see)**

- **The mechanics are not new in late 2026.** Vercel agent-browser has `batch` with `--bail` (many steps, stop at first error), `--session` (isolated parallel browsers), `diff snapshot`, a live dashboard and `--confirm-actions` ([repo](https://github.com/vercel-labs/agent-browser)). Microsoft's Playwright CLI has named sessions and `playwright-cli show`, a "session grid" with "live screencast" of all sessions, plus take-over ([docs](https://playwright.dev/agent-cli/sessions)). So chunks, lanes, the live grid and the safety gate each have a close copy. A judge who knows these tools will ask "how is this different?"
- **The baseline is the tool Microsoft itself tells coding agents to leave.** The Playwright MCP README says coding agents "might benefit from using the CLI+SKILLS instead" ([README](https://github.com/microsoft/playwright-mcp)). Beating Playwright MCP is real and fair (it is the common default), but it is not the strongest baseline.
- **Faster, not better.** Success is 17/22 in both setups. The biggest failure type (false DONE) is not solved. gomail-3 is the proof: the agent filled the email and said DONE without clicking Send, so the commit check never ran.
- **The Meta model does little real work in normal use.** It runs only when (a) a person turned it on, (b) the agent wrote a `task` line, and (c) a gated word was clicked. The demo uses planted wrong values. If the check rarely fires in the 22-task runs, the "Meta tooling" score (25% in the public rules) is weak. Count how often it fired in phase 8 before you claim it.
- **The benchmark proof is not reproducible from the repo.** The README points to `~/Desktop/fastb-bench`, which is not public. A judge cannot check a number.
- **The domain is booking and shopping clones.** Coding agents mostly use a browser to check the web app they just changed. The REAL tasks are fine as a benchmark, but say why they matter for coding agents.

**How a judge will likely see it today:** "A solid, well-measured speed tool for agent browsing, with a nice live grid. Similar to agent-browser and Playwright CLI. The Meta model is a safety add-on." That is a top-quarter entry, probably not a winner. The way up is to make the Meta model's job central and visible, and to show success going up, not only speed.

## 2. What developers complain about

| Pain | Evidence | fastb today |
|---|---|---|
| Page snapshots fill the context window | playwright-mcp [#1329](https://github.com/microsoft/playwright-mcp/issues/1329) "snapshot can fill the entire context", [#1274](https://github.com/microsoft/playwright-mcp/issues/1274), [#889](https://github.com/microsoft/playwright-mcp/issues/889); [Checkly](https://www.checklyhq.com/blog/mcp-vs-cli-token-efficiency/) on schema overhead | Solved (compact text, changes only). Playwright CLI and agent-browser also solve it. |
| One tool call per field or click | playwright-mcp [#197](https://github.com/microsoft/playwright-mcp/issues/197) "Fill multiple fields at once"; a Claude Code user: login takes 4 s+ ([forum, secondary](https://yomotherboard.com/question/how-can-i-speed-up-browser-interactions-with-playwright-in-claude-code/)) | Solved (chunks). agent-browser `batch` also. |
| Parallel agents fight over one browser | playwright-mcp [#893](https://github.com/microsoft/playwright-mcp/issues/893) "multiple parallel claude-code agents ... interference", [#769](https://github.com/microsoft/playwright-mcp/issues/769) profile lock | Solved (lanes). Sessions in agent-browser and Playwright CLI also. |
| Want to save, restore or clone a session | playwright-mcp [#1530](https://github.com/microsoft/playwright-mcp/issues/1530) "save/restore/clone" | Not solved (idea 4). |
| Screenshot-based browsing breaks or is slow | claude-code [#45695](https://github.com/anthropics/claude-code/issues/45695) screenshots over 2000 px on HiDPI, [#24695](https://github.com/anthropics/claude-code/issues/24695) oversized screenshot kills the session; Claude in Chrome "noticeable delays between each action" ([tutorial, secondary](https://buildermethods.com/library/claude-code-chrome-browser-integration)) | Solved (text first, no screenshots needed). |
| Agent says done when it is not | Browser Use docs: "is_successful is the agent-reported outcome; verify important external actions independently" ([docs](https://docs.browser-use.com/llms.txt)); false success is 45 to 76% of failures in agent benchmarks ([arXiv 2606.09863](https://arxiv.org/abs/2606.09863), abstract only); our own runs: most failures are false DONEs | Partly. Commit check covers only gated clicks with a `task` line. gomail-3 shows the gap (idea 1). |
| Prompt injection from page text | Claude for Chrome: 23.6% attack success without mitigations, 11.2% with ([Anthropic](https://www.anthropic.com/news/claude-for-chrome)); WASP (Meta FAIR): agents start the attacker's instruction in 16 to 86% of cases ([arXiv 2504.18575](https://arxiv.org/abs/2504.18575)) | Untested. The commit check compares the page with the task, so it may catch injected sends. Not measured (idea 3). |

I found no single large GitHub thread about browser speed in anthropics/claude-code; the top threads there are about usage limits. Browser pain shows up as many small issues and blog posts, mostly about tokens and context.

## 3. Competitor landscape

Y = yes, documented. P = partly. N = not found. ? = not checked.

| Tool | Many steps per call | Parallel isolated browsers | Live view of many | Changes-only output | Gate on risky actions | Model checks task vs page before commit | Public numbers vs a baseline |
|---|---|---|---|---|---|---|---|
| **fastb** | Y (`run`, stop at first surprise, `expect`) | Y (`lanes`, one input) | Y (`watch` grid) | Y (automatic after each run) | Y (word list, `allow`) | **Y (Muse Spark, opt-in)** | **Y (REAL, 22 tasks)** |
| [agent-browser](https://github.com/vercel-labs/agent-browser) (Vercel) | Y (`batch`, `--bail`, stdin) | Y (`--session`) | P (dashboard with live viewport; grid unverified) | P (`diff snapshot`, manual) | Y (`--confirm-actions`, human approval) | N | N |
| [Playwright CLI](https://playwright.dev/agent-cli/sessions) (Microsoft) | P (`run-code`, code not steps) | Y (`-s=name`) | **Y (`show`: session grid, live screencast, take-over)** | N (snapshots to files) | N | N | N |
| [Playwright MCP](https://github.com/microsoft/playwright-mcp) | N (one tool per action) | P (`--isolated`) | N | N | N | N (verify tools written by the agent, `--caps=testing`) | N |
| [Chrome DevTools for agents](https://developer.chrome.com/blog/new-in-devtools-149) (MCP + CLI, stable 2026) | ? | ? | N | ? | ? | N | N |
| [Claude in Chrome](https://www.anthropic.com/news/claude-for-chrome) / Claude Code browser pane ([secondary](https://dev.classmethod.jp/en/articles/reona-claude-desktop-browser-function/)) | N (screenshot loop) | N | N | N | Y (asks the human) | N | P (injection rates only) |
| Codex in-app browser and computer use ([secondary](https://pasqualepillitteri.it/en/news/1568/codex-native-browser-openai-april-2026)) | ? (a June update claims "2x faster", [secondary, unverified](https://codex.danielvaughan.com/2026/06/12/codex-browser-use-developer-mode-cdp-dom-snapshots-2x-performance-cli-frontend-workflows/)) | P (parallel agents) | N | ? | ? | N | N |
| [Browser Use](https://browser-use.com/showcase/run-parallel-browsers) | own agent | Y (cloud) | Y (cloud) | N | P | P (judge for its benchmark, 87% human agreement, [docs](https://docs.browser-use.com/open-source/bu-2-0-model-card)) | Y (own bench) |
| [Stagehand](https://browserbase.com/changelog/stagehand-v3) / Browserbase | own SDK, action caching | Y (cloud) | Y (live view, replay) | N | N | N | N |
| [Steel](https://docs.steel.dev/overview/guides/view-and-embed-live-sessions) | N | Y (cloud) | Y (live view, WebRTC) | N | N | N | N |
| [Skyvern](https://skyvern.com/docs/developers/going-to-production/error-handling) | own agent | Y (cloud) | Y | N | P | P (`complete_criterion` written by the user) | ? |
| [Invariant guardrail](https://invariantlabs.ai/blog/enhancing-browser-agent-safety) (research blog) | n/a | n/a | n/a | n/a | P | P (checks harmful intent of `fill`, not task match) | P |

**Genuinely different in fastb:** (1) a model that derives the check from the task text and compares it with page state, inside the coding agent's own browser tool, before the click; (2) one input that runs many lanes and returns one answer; (3) public, careful numbers. **A copy (do not claim as new):** batching, sessions, the live grid, snapshot diffs, a keyword gate.

## 4. What winning demos share

- **A concrete pain with a big number.** Anthropic "Built with Opus 4.6" winners: CrossBeam (California housing permits), PostVisit.ai (patients), TARA (road appraisals: "9 to 14 months" and "$1-4 million" down to hours) ([Anthropic](https://claude.com/blog/meet-the-winners-of-our-built-with-opus-4-6-claude-code-hackathon)).
- **A domain, not a tool.** LlamaCon hackathon winners: OrgLens (expert finding), Compliance Wizards (fraud), Llama CCTV Operator ([Meta](https://ai.meta.com/blog/llamacon-hackathon/)). Llama 4 NYC: Pitch Perfect, AthletIQ, and a developer tool (Centaur SRE) in third ([Meta for Developers on Reddit, secondary](https://redlib.hbubli.cc/user/MetaforDevelopers/submitted)). Developer tools rarely take first place at these events.
- **A one-sentence pitch first, numbers, visual polish.** Browser Use's founding engineer (YC hackathon first place): "Lead with one clear pitch sentence", script one user flow, use numbers, "judges respond well to strong UI/UX" ([Browser Use](https://browser-use.com/posts/how-to-win-hackathons)).
- **The model is the hero, visibly.** In each winner above, the model's output is the thing on screen (the report, the appraisal, the detected event). In fastb's current script the Meta model appears at 2:00 for 35 seconds.

For fastb this means: open with the race (a slow cursor vs a grid of lanes), keep one number on screen, and make the Meta model's verdict the climax, not a side note.

## 5. Ideas, ranked

### Idea 1: Proof of done. The Meta model checks the end state before the agent may say DONE

- **Pain:** false DONE is the biggest failure type in your runs and in the literature (section 2). gomail-3 failed because the agent never reached a gated click, so today's check never ran.
- **Similar things (strict):** LLM judges that read the trace after the run exist for evaluation (WebJudge, [arXiv 2504.01382](https://arxiv.org/abs/2504.01382); Browser Use's benchmark judge). "Verifier" is a known pattern ([Notte glossary](https://www.notte.cc/glossary/ai-browser-agents/what-is-a-verifier-in-browser-agents)). Skyvern has criteria written by the user. **Not found:** a check that a coding agent's browser tool runs in the loop, derived from the task, on page state (not the transcript), with every lane checked at once. So: the concept exists, the placement and the measurement are new. Say that plainly.
- **Build:** `fastb done` (and `fastb lanes done`): read the evidence you already read for the commit check (fields, visible text, URL) from each lane; Muse Spark returns PASS, or FAIL with the missing fact ("email not sent: compose window still open"). Skill text: "Before you answer DONE, run `fastb done`; on FAIL, fix and run it again." Add a false-DONE column to `compare.py`. Must use only what a user can see, never the REAL `/finish` state (that would be cheating).
- **Proof:** rerun the 22 tasks (fastb and lanes) with it. Targets to watch: gomail-3, topwork-1, staynb-9. Report success, false DONEs, false alarms, added seconds and Meta cost per task. If success goes 17 -> 19, the story becomes "2x faster and more right".
- **Video:** the same task twice. Without: "DONE." and a red checker result. With: `fastb done` -> `FAIL: email not sent`, one more chunk, green. In the grid: one tile turns amber "FAIL", then green.
- **Risk:** small sample (5 failures); false alarms cost turns; the model may say PASS on a wrong page. Medium build effort (most parts exist). It changes agent behavior, so the fastb rows of phase 8 must be rerun.

### Idea 2: The check runs on Muse Glimmer, on this laptop (open-weights prize)

- **Pain:** the check is off by default because page facts go to a cloud API; the hackathon rules themselves forbid private data on the free credits. A local model lets it be on by default for logged-in browsing.
- **Similar things:** local guard models are common (Meta's own Llama Guard; Minim and PAPILLON in research, see `docs/research-gaps.md`). Local task-vs-page commit checks in a browser tool: not found.
- **Facts:** Glimmer is 30B dense, text and image in, 128K context; runtimes vLLM, SGLang, llama.cpp, Ollama; launch partners include Fireworks AI, OpenRouter, Together AI ([Meta docs](https://dev.meta.ai/docs/muse-glimmer)). A 4-bit build is under 20 GB ([secondary](https://rits.shanghai.nyu.edu/ai/meta-releases-muse-glimmer-a-30b-agent-model-for-a-single-gpu/)). Speed on an M5 Pro with 24 GB: **unverified**, and Chrome with 12 lanes needs memory too.
- **Build:** an OpenAI-compatible client switch (`spark` or `glimmer`); run the planted OpenDining cases and the idea 1 checks on both; report agreement and latency. If the Mac is too slow, use partner inference (the prize allows it).
- **Video:** "Now the same check, on Meta's open-weights model, on this laptop", with a network monitor showing no call to the Meta API.
- **Risk:** speed and memory on the Mac (do a short spike first, done when Glimmer answers one OpenDining check correctly and you know the seconds). Prize verification by an infra partner: rules not read in detail.

### Idea 3: Injection test. Show the commit check stops a hijacked send

- **Pain:** prompt injection is the top fear in browser agents (Anthropic 23.6% -> 11.2%; WASP 16 to 86%, section 2).
- **Similar things:** Anthropic uses classifiers plus human approval; Invariant checks harmful `fill` values; VIGIL and Supervisor do verify-before-commit in research (`docs/research-gaps.md`). A task-bound check at the click, inside a coding agent's browser tool: not found. It is a new use of what you built, not a new feature.
- **Build:** 6 to 10 small local test pages with hidden text that tries to change the recipient, amount or address before "Send" or "Pay". Run Claude Code + fastb with the check on and off. Count attacks that reach the click. Check first that email redaction does not hide the attacker's address in a way that breaks the comparison.
- **Video:** 20 seconds: a hidden line on the page, the agent follows it, `CHECK before "Send": recipient is not in the task`.
- **Risk:** a small, self-made test set (say so); attacks that do not use a gated click (for example navigating to a URL with data) are not covered. Running WASP itself needs VisualWebArena servers: too heavy for the time left.

### Idea 4 (only if 1 to 3 are done): Fork a lane, try paths at once, keep the one that matches the task

- **Pain:** agents explore by trial and error, one path at a time; users ask for session clone ([#1530](https://github.com/microsoft/playwright-mcp/issues/1530)).
- **Similar things:** TClone forks live GUI workspaces for computer-use agents, 1.9x lower latency, research only ([arXiv 2605.17320](https://arxiv.org/abs/2605.17320)); tree search for web agents exists in research. No browser tool for coding agents found. Treat as "known idea, new tool form".
- **Build:** `fastb fork <lane> <n>`: replay the lane's step log into n new contexts, then run a different chunk in each; Muse Spark picks the branch that matches the task.
- **Video:** one tile splits into four; three go red, one green.
- **Risk:** high. Replay is not exact on stateful pages; hard to measure in time.

### Idea 5 (credibility, not a feature): one stronger baseline row

Run 6 to 8 tasks with Claude Code + agent-browser (or Playwright CLI), same harness. If fastb still wins, it answers the judge's first question. **Risk:** the gap may be small; costs bench time. If skipped, say in the README why Playwright MCP is the baseline.

### Drop from the story (keep in the product)

- The live grid as a novelty (Playwright CLI `show` has a live session grid). Keep it as the visual, do not call it new.
- The keyword safety gate (agent-browser `--confirm-actions`, Claude in Chrome approvals).
- "Changes only" and the 6x compactor as headline features (agent-browser `diff`, Playwright CLI files).
- `fastb stats` (anti-project list warns against dashboards).
- "Chunks" as a new concept. The new part is the measured result, not the batch.

## 6. README advice

1. **First screen:** one sentence ("Your coding agent drives 8 browsers in one turn, and a Meta model checks each one before it clicks Pay"), a 15 to 20 s GIF of the grid with one tile stopped by `CHECK`, then the video link. No install text above the fold.
2. **Results as an image:** a small bar chart (time, turns, cost, success) plus the table. One caveat line, then a link to details.
3. **Make the proof checkable:** put the harness and raw `results/*.jsonl` in the repo (for example `bench/`) and link the REAL benchmark ([agisdk](https://github.com/agi-inc/agisdk)). Remove `~/Desktop/...` paths and "phase 8" wording.
4. **"How it compares" table:** a short, honest version of section 3. Judges trust a project that names its neighbors.
5. **The Meta model section with a real transcript:** task, page evidence, verdict, seconds, cost, and how often it fired in the benchmark.
6. **A 60-second try:** one command against a public demo site, so a judge can see output without setup.
7. **Keep "Safety and privacy" and "Known limits".** They are a strength.
8. **A small diagram** (Mermaid renders on GitHub): agent -> CLI -> engine -> lanes -> Meta check.

## 7. Recommendation

**Build idea 1 (proof of done), and retell the story as "fast and checked".** It hits the measured failure, makes the Meta model run on every task instead of only on planted errors, and can move success, the one number that does not improve today. Order, each with a done-when:

1. Let the running phase 8 runs finish. Done when the numbers are in. Also count how often the commit check fired.
2. Build `fastb done` / `fastb lanes done` and the false-DONE column. Done when gomail-3's end state gives FAIL and a correct run gives PASS.
3. In parallel, a worker in its own worktree runs the Glimmer spike (idea 2). Done when you know if Glimmer gives the same verdict, and in how many seconds, locally or via a partner.
4. Rerun the fastb and lanes rows (3 runs if time allows). Done when success and false DONEs are in `docs/bench`.
5. Rewrite the README first screen and the video around "fast and checked". Freeze features well before Nov 4 so the video gets calm time.

Skip idea 4. Do idea 3 only if steps 1 to 4 are done.

## Not verified

- Glimmer speed and memory on the M5 Pro 24 GB; partner inference terms for the prize.
- agent-browser: whether its dashboard shows many sessions in a grid, whether one `batch` can span sessions, and the full `--confirm-actions` category list.
- Codex browser "2x faster" claim and its parallel agents (secondary sources only).
- Claude Code browser pane date (secondary source).
- arXiv 2606.09863, WebJudge, TClone: abstracts only.
- Whether idea 1 would catch topwork-1 and staynb-9: a hypothesis until rerun.
- How often the commit check fired in the phase 8 runs: not checked (runs in progress).
- Llama 4 NYC winners: from a Reddit repost of a Meta account, not Meta's own page.
