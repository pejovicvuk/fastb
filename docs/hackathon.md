# Meta Global AI Developer Hackathon: notes

Source files: participant guide at `~/.fastb/private/participant-guide.txt` (private, not in the repo), `images/` (kickoff slides, Oct 26).

## Our entry

- Track: **Indie Developer** (solo).
- Theme: **Push the Frontier** (software). Story in the video: "Build for Your World" (my own pain with slow agents).
- Project: **fastb**.

## Dates (Belgrade time)

| Event | Time |
|---|---|
| Kickoff livestream, building starts | Mon Oct 26, 17:00 (confirmed at kickoff: building starts now) |
| Submission deadline | **Thu Nov 5, 03:00** (= Nov 4, 21:00 ET) |
| Judging | Nov 5–8 |
| Closing ceremony / final judging | Mon Nov 9, 18:00 |
| Most Viral deadline (X posts) | Nov 8, 23:59 ET |
| Community vote winner | Nov 16 |

## Judging

- Indie Developer track is judged on **creativity, technical ambition, and whether it works** (kickoff slide, `images/track-indie-developer.png`).
- Stage 1: pass/fail. Fits a theme and uses Meta models (Meta Model API and/or Meta open weights).
- Stage 2: scored. Guide says equal weights; public rules say 30% impact, 25% Meta tooling, 20% engineering, 25% demo. Ask in Discord `#questions` which one applies.
- Stage 3: top 5 per track go to finals. Judges watch the demo videos live.

## Themes (`images/themes.png`)

- **Build for Your World:** bring Meta's models into your domain. Solve a problem you know firsthand.
- **Push the Frontier:** use Meta's models on challenges in software, robotics, manufacturing, energy, materials. Give a machine a new capability.

## Meta models

- Meta Model API: Muse Spark series, Muse Wonder, Muse Image, Muse Voice Transcribe, SAM 3.1.
- Open weights (run yourself): **Muse Glimmer** (30B), **Muse Spark Open**.
  - Muse Spark Open is **816B total / 42B active** (MoE). Needs ~340 GB+ memory. Cannot run on my Mac (M5 Pro, 24 GB). Runtimes listed: SGLang, vLLM, TensorRT-LLM, Transformers, llama.cpp. https://huggingface.co/meta-models/Muse-Spark-Open-816B-A42B
  - Muse Glimmer 30B: quantized ~17–20 GB. Only just fits in 24 GB; likely slow.
  - The open-weights prize allows "own hardware **or partner inference**".
  - Ollama / llama.cpp / MLX are runtimes (programs), not models. The model is what must be Meta's.
- Coding agent: Muse Code (does not count as "using Meta models" in the project).
- Credits: $150 Meta Model API credits per person. Claim link in Discord. Credit card needed.
  - 2026-10-27: **claimed, $150 active** (personal account). Console sections: Chat, Image, Audio, Segment, API keys, Usage, Models, Billing.
  - While on free credits, content may be used for product improvement. **Send no company or customer data.**
  - After the credits run out, pay-as-you-go starts on the card (billed at $20 balance or on Nov 1). Watch Usage.
  - API key: keep outside the repo (env var `META_API_KEY` or `~/.fastb/secrets.env`), never commit it.

## Bonus prizes, $50K total (`images/bonus-prizes.png`)

| Prize | What it rewards | Fit for fastb |
|---|---|---|
| $20K Most Viral | Most likes/reposts/comments on X by Nov 8, 23:59 ET | Good: side-by-side speed video |
| $10K Best Build on Meta Open Weights | Best project on Muse Glimmer or Muse Spark Open, on own hardware or partner inference. Infra partner verifies. | **Strong**: local model = Muse Spark Open |
| $10K Community Vote | Most votes in public gallery | Possible |
| $5K Best Agentic Use-Case | Autonomy, effectiveness, practical usefulness | Good |
| $5K Best Creative Build | Built with Muse Image or Muse Wonder | No |

## Anti-projects: skip these (`images/anti-projects.png`)

AI medical advice (incl. mental health advisors, skin blemish detectors), basic RAG apps, simple image analyzers, Streamlit apps, dashboards as the main feature, "AI for Education" chatbots, AI job application screeners, AI nutrition coaches, personality analyzers, sports analyzers or coaches. Also nothing political or about war. Not a complete list.

For fastb: keep `fastb stats` a small extra (not a dashboard product). No Streamlit.

## Rules

- Team: max 4. Solo is allowed.
- **Public repository.**
- New work only. The demo must show what was built during the hackathon.
- You must have the rights to all code, data, and assets.
- Age 18+.

## Submission

Kickoff slide (`images/submissions.png`): "Submit four things by Nov 4, 9:00 PM ET".

1. Submit on the CV platform, with every teammate: https://cerebralvalley.ai/e/meta-ai-developer-hackathon/hackathon/submit
2. **A 3-minute demo video.** Show only what was built during the event. **Judges score from it.**
3. **A public GitHub repo.** Check that it opens in a logged-out browser before you submit.
4. Before the deadline: **Wed Nov 4, 9:00 PM ET = Thu Nov 5, 03:00 Belgrade.** Don't wait for the last hour.

From the guide: one project per team, one person submits, list all contributors, have a working live demo.

## Open questions (ask in Discord `#questions`)

- Which judging weights apply?
- Which partner inference providers can we use for Muse Spark Open, and are there credits?
