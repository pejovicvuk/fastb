# Video script (3 minutes), draft 2026-10-29

Theme: Push the Frontier, give a machine a new capability. Story: AI agents use the browser one slow click at a time; fastb lets one agent turn drive many browsers at code speed, and a Meta model checks the work. Show only what was built during the event. Numbers only from `~/Desktop/fastb-bench` (fill in the final phase 8 numbers before recording).

## 0:00 to 0:20 · The pain

- Screen: Codex's own browser doing a simple task. The cursor creeps, screenshot, think, move, click. A timer in the corner.
- Voice: "This is how AI agents use a browser today. One screenshot, one model call, one click. Again and again."

## 0:20 to 0:45 · Why it is slow

- Screen: one chart. Baseline task: 30 model turns, about 88 tokens written per turn, about 2 s per turn.
- Voice: "The model barely thinks. It is asked too often. Every round trip re-reads the whole conversation. The cost is the number of round trips."

## 0:45 to 1:20 · fastb: many steps, one call

- Screen: terminal next to the browser. Claude Code sends one `fastb run` with 6 steps (compose an email). The page fills at code speed. The answer: `OK 6/6 steps 0.9s`, then only the changed lines.
- Voice: "fastb is a browser for coding agents. The agent sends many steps at once, fastb runs them as code and answers with only what changed."
- Overlay: per task, median time and turns vs the baseline (phase 8 numbers).

## 1:20 to 2:00 · Lanes and the live grid

- Screen: `fastb watch`. Claude Code gets 8 tasks in one prompt. 8 tiles light up at once (DashDish, GoMail, Staynb, OpenDining...). Orange flashes show each element fastb touches. Tiles turn green.
- Voice: "And not one browser. Many. One agent turn drives eight isolated browsers at the same time, and you can watch every one."
- Overlay: all 22 tasks, lanes vs baseline one by one (phase 8 numbers: total time, turns, cost).

## 2:00 to 2:35 · The Meta model checks the work

- Screen: three lanes book a table. One is right, two have a wrong date and a wrong party size. Before "Complete reservation", two lanes stop: `CHECK ... date is "Jul 19", task wants "July 20, 2024"`. Then `fastb lanes report`: "2 ok; stopped (2), date is not July 20".
- Voice: "Agents often say done when the result is wrong. Before anything irreversible, Muse Spark compares the page with the task, and stops the click with the reason. Private values are hidden first, and only a person can turn it on."

## 2:35 to 3:00 · Both agents, the numbers, close

- Screen: the same task with Codex + fastb, then the summary table: baseline, Claude Code + fastb, Codex + fastb, lanes.
- Voice: "Works with Claude Code and Codex. Faster, fewer turns, cheaper, and checked by a Meta model. fastb: let the agent think, let code click."
- End card: GitHub link, "Built with Muse Spark 1.3".

## Shots to record

1. Codex's own browser on one REAL task, timed (the slow cursor).
2. Claude Code + fastb on the same task, timed, terminal and browser side by side.
3. `fastb watch` with 8 lanes from `run_lanes.py` (headed Chrome, or the grid page full screen).
4. The OpenDining check demo (3 lanes, 2 wrong) and `fastb lanes report`.
5. Codex + fastb on one task.
