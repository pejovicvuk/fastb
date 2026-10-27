# Research notes (2026-10-26)

## Why computer use is slow

- OSWorld-Human (MLSys 2026): planning model calls take 50–75% of task time; screenshots < 2%. Agents take 2.7–4.3x more steps than needed. Later steps ~3x slower (growing history). https://arxiv.org/abs/2506.16042
- UFO2: ~10 s per LLM inference. https://arxiv.org/pdf/2504.14603
- Claude in Chrome 45 s `document_idle` waits: https://claudeissues.com/issue/74523-claude-in-chrome-actions-block-45s-on-document-idle-and-never-recover-on-spas-th , https://claudeissues.com/issue/63963-bug-claude-in-chrome-screenshot-capture-hangs-on-document-idle-timeout-despite-p

## Speculation / draft-and-verify

- Skim: speculative fast path for web agents with fixed URL patterns; 1.9x cost, 33% latency cut. https://arxiv.org/abs/2605.16565
- SpecAgent: weak model drafts tool-call trajectory, strong model verifies in one pass. Not GUI. https://arxiv.org/abs/2610.21463
- DualSpec: https://arxiv.org/html/2603.07416 · SpecEyes: https://arxiv.org/html/2603.23483v1
- Computer-Using World Model (predicts next UI state): https://arxiv.org/abs/2602.17365v1
- No tool found that does draft-and-verify for real browser GUI clicks.

## Existing browser tools for agents

Browser Use (+ Browser Harness), Stagehand, Lightpanda, Playwright MCP / Playwright CLI + skills, Chrome DevTools MCP, Vercel agent-browser, Browserbase.

## Benchmarks

- REAL (AGI SDK): 11 React/Next.js clones, 112 v1 tasks, deterministic, Apache-2.0. Chosen. https://github.com/agi-inc/agisdk , https://arxiv.org/pdf/2504.11543v1
- WebArena-Verified: backup for credibility. https://raw.githubusercontent.com/ServiceNow/webarena-verified/main/README.md
- Metrics idea (success, wall time median/p95, tool calls, tokens split by cache): https://github.com/nsosio/web-agent-bench

## Past hackathon winners

- Meta: OpenGlass ($20 smart glasses), Sussi (screen monitor for students), Pitch Perfect (real-time speaking coach), OrgLens (expert matching), Geo-ML (Best Llama API usage, geologist's own pain). https://ai.meta.com/blog/llamacon-hackathon/ , https://ai.meta.com/blog/llama-3-hackathon-recap-cerebral-valley/
- Cerebral Valley: many QA and computer-use agents (Auto QA, LaunchLens, rote, Veche, Gatekeeper...). A plain "AI QA agent" will not stand out. https://cerebralvalley.ai/e/aiewf-hackathon-2026/hackathon/gallery

## Platform policy

- Anthropic does not allow Claude subscription logins in third-party apps (Feb 2026); products must use API keys. https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/

## Meta models

- Muse Spark 1.1 / 1.3: agentic, tool calling, computer use, 1M context. https://ai.meta.com/blog/introducing-muse-spark-meta-model-api/
- Muse Glimmer: 30B, quantized ~17–20 GB, MLX needs 48 GB+ unified memory. https://dev.meta.ai/docs/muse-glimmer

## Energy merge research (2026-10-26)

### Pipeline notices aggregators (already exist)

- Wood Mackenzie Natural Gas Notices & Maintenance (ex-Genscape): 190+ pipelines, severity, alerts. https://www.woodmac.com/archived-pages/commodity-trading-analytics/natural-gas-notices-and-maintenance/
- SynMax Hyperion: ~150 interstate pipelines scraped ~hourly; ~35 small operators by **LLM agent scraping** on request; API + NL agent. https://blog.synmax.com/hyperion-client/save-agent-credits-for-pipeline-notices
- NatGasHub via ICE: 150+ pipelines, notices, maintenance, capacity; ICE API. https://developer.ice.com/fixed-income-data-services/catalog/natural-gas-hub
- PipeRiv (2024): ~150–168 pipelines critical notices. https://www.piperiv.com/
- Capacity Center (Skipping Stone): email alerts, 100+ pipelines. https://capacitycenter.skippingstone.com/wp-content/uploads/2026/08/CCI-Newsletter-August-2026.pdf
- Enercast: Telegram alerts ~5 min, AI trading note. https://www.producthunt.com/products/enercast
- NGinsight (Argonne): NAESB EDI + scraping, severity 1–5. https://www.naesb.org/pdf4/geh061623w2.pdf
- Verdict: "one clean notices feed" is solved. Open angles: compile-once engine (cost, self-healing), seconds-level latency, long-tail capacity tables, shipper-specific impact.

### EBB sites (curl checks 2026-10-26, non-US IP)

- Open, no login, old server pages: Kinder Morgan (pipeline2.kindermorgan.com, ASP.NET), Enbridge (infopost.enbridge.com, classic ASP), TC Energy (ebb.tceconnects.com/infopost, iframes), Energy Transfer (ipost), Boardwalk (gasquest.com/informational-posting), Williams Northwest.
- Blocked: Transco 1Line (403 WAF), Tallgrass/REX (Incapsula), Iroquois (403).
- Formats: NAESB WGQ allows CSV/RTF downloads; no common JSON API. FERC Order 587-AB effective 2027-01-01 adds geographic info standard for critical notices.

### Ideas from the TIES docs (company repo, ideas only)

1. EBB Sentinel (fastb + EBBs + impact on a synthetic nomination book).
2. Field Ticket Vision: run tickets / BOL / lab reports → SAM 3.1 + Muse Spark + Voice; physics checks (API gravity, temperature correction, BS&W).
3. Meter Station Inspector: photos of gauges / chart recorders / flow computers → simplified AGA-3/AGA-7 volume, drift detection. No SCADA/chromatograph integration exists in TIES today.
4. Nomination Exception Copilot: fix NatGasHub "Failed Validation" mapping issues with approval chain.
5. Voice Gas Control: spoken nomination changes → checked dry-run diff.
- Existing TIES AI (do not duplicate): Tessa chat, Query Builder, confirmation PDF matching, MCP server.
