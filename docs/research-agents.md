# Research: speed ideas from other browser agents (2026-10-30)

Three research passes read open-source browser agents, agent browser tools and recent papers. Ideas only: no code is copied. Clones are in `~/Developer/_research/` (shallow, nothing built or run).

Licenses: browser-use MIT, Stagehand MIT, dev-browser MIT, Playwright MCP Apache-2.0, Chrome DevTools MCP Apache-2.0, agent-browser Apache-2.0, nanobrowser Apache-2.0. Skyvern and workflow-use AGPL-3.0, Notte SSPL-1.0: ideas only, never their code.

## Where fastb's time goes now (final5, fastb x3)

- About 1074 s and 236 agent turns per run of 22 tasks. Claude model time is about 60%, browser steps about 25%, Meta checks about 12%.
- 27 STOPs per run (82 in 3 runs). Top causes: element not found within 5 s (13), read-only field (9), ref not found (13), timeouts (5), the page changed during the check (5), text not on the page (5).

## Ideas, ranked for fastb

| # | Idea | Seen in | fastb has it | Cost |
|---|---|---|---|---|
| 1 | Steps that branch or may be skipped: `optional click "Accept cookies"`, `if text "Sold out"`, `try A or B`. Some STOPs become steps that run on. | dev-browser (agent writes scripts that loop and branch), Playwright MCP `browser_run_code`, plan-then-execute programs (arXiv 2605.14290: 81% of WebArena tasks run as a fixed program) | No: chunks are a straight line | Small to medium |
| 2 | Ask for the answer, not the page: `fastb ask "total price?"`, answered by the Meta model from the page text. Claude reads one line, not a page. | browser-use `extract` (cheaper page model), Notte structured scraping, AgentQL | No | Small to medium |
| 3 | Start the Meta check early, at the same time as the earlier steps; use the result only if the checked fields did not change before the click. | Skyvern `forge/agent.py` (speculative plan and parallel goal check) | No: the check waits in line with the click | Small to medium |
| 4 | Fix a failed step in the engine before it STOPs: a cheap match first, then one Meta pick of the element, then STOP. | Stagehand `selfHealAction`, browser-use `rerun_history` element matching | Partly: ref re-find by role and name (final5) | Medium |
| 5 | One step for dropdowns and autocomplete: open, then pick the option among the new lines only. | Stagehand two-step act, Skyvern custom-select handlers | Partly: `select` opens custom dropdowns | Small to medium |
| 6 | Handle native dialogs (`confirm`, `alert`) and report them; today Playwright closes them in silence. | Chrome DevTools MCP `WaitForHelper.ts`, dev-browser `extend.ts` | No (checked: no dialog handler in `src/`) | Small |
| 7 | Chrome settings that stop pop-ups which eat input (password leak warning, save-password, autofill). | dev-browser `launch.ts` | No (checked: no Chrome settings in `src/browser`) | Small |
| 8 | Search the page: `fastb find "Souvla"` returns matching lines with their section, not the page. | Playwright MCP `browser_find` | Partly: view budget, `look --all` | Small |
| 9 | Scoped views: interactive lines only, one section, or the viewport only. | agent-browser snapshot flags, dev-browser `snapshot` options | Partly | Small |
| 10 | Big output to a file plus its path, so the agent greps it with its own shell. | dev-browser, Chrome DevTools MCP | Partly | Small |

## Not for fastb, or not now

- Cached actions and site recipes (Stagehand cache, Midscene cache, workflow-use replay, AWM, SkillWeaver). Real gains in their papers, but on our bench they help only on repeat runs, which grades us on tasks we already saw. A budget-matched study (arXiv 2606.15017) also found a plain agent as good or better. Fits the gas pack routines, not the bench.
- Speculative next actions (arXiv 2510.04371: 20% faster end to end). Hides browser and check time only, not Claude turns; earlier draft-and-verify was set aside.
- Planner and executor split (nanobrowser, Plan-and-Act): Claude already plans and the engine executes.
- Shorter settle windows: fastb already waits 200 ms after an action (Chrome DevTools MCP uses 100 ms). Measure with `FASTB_TRACE` before any change.

## Not verified

The gains above are guesses until a `~/Desktop/fastb-bench` run measures them.
