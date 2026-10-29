# Research: speed ideas from Lightpanda (2026-10-29)

Lightpanda (github.com/lightpanda-io/browser) is a browser for agents, written in Zig, with no rendering. Its license is AGPL-3.0: we take **ideas only**, no code. We read the source (shallow clone, nothing built or run).

## Where fastb's time goes (bench, fastb with LIKELY DONE, run 3, 22 tasks)

- Total 1199 s. Agent model (Claude) about 750 s, browser steps about 290 s, Meta checks about 140 s.
- 221 agent calls, 42 STOPs, only 4 "not found within 5s" timeouts (about 20 s).
- **135 of 201 page outputs were full pages, only 66 were diffs.** 605,000 characters went to the agent (about 150,000 tokens). Reading this is part of the 750 s.

So the big lever is the size of what the agent reads, then the waits. A faster browser engine alone saves little.

## What Lightpanda does that fits fastb

1. **Wait only for what the action caused** (`browser/tools.zig`, `Runner.zig`). After a click it waits only if the click queued a navigation; else it returns at once. "Done" is: no pending macrotasks and the network idle (0 requests for 500 ms). Repeating timers, deep `setTimeout` chains (requestAnimationFrame loops) and idle callbacks never block "done". When the page goes idle before the goal, the wait ends instead of running to the timeout.
2. **A ranked byte budget for the page view** (`SemanticTree.zig`). Lines are ranked: critical (alert, status, focused, `aria-invalid`) > heading > named > text > page chrome (navigation, aside, footer). The view is cut to a budget; cut parts become `[+N more @id]`, and the agent can expand one id later. Lists are filled round-robin, so every list shows some items.
3. **Drop what the agent does not need**: svg, hidden nodes, generic wrappers (children kept), text already in the parent's name, children of a named link or button, select options folded into one line.
4. **Block resources**: images, iframes, workers and beacons are not loaded by default; URL block lists. CSS stays on (visibility depends on it).
5. **Stable ids** tied to the live DOM node (fastb does the same with a page-side WeakMap).

What fastb has and Lightpanda does not: many steps in one call, and only-the-changes output.

## Plan candidates for fastb

- A. Budgeted view: rank lines, cut page chrome first, `[+N more @ref]` stubs, `fastb look @ref` to expand. Goal: fewer characters per output, more diffs and fewer full pages.
- B. Action-caused waits: after a step, wait only when it started a navigation or network requests; end the wait when the page is idle.
- C. Block images, fonts and media in Chrome.
