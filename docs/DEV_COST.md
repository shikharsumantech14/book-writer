# Development cost

Tokens spent by Claude Code building this project, measured from the session transcripts (`scripts/dev_usage.py`). Cost is the API-list-price equivalent; the work actually ran on a Claude subscription plan, so no per-token charge was incurred.

Why cumulative tokens are much larger than the context window: the model is stateless, so every step re-sends the whole conversation. The context window is the size of one request; the totals below are the sum over all requests. Repeated context is served from the prompt cache at ~0.1x price.

_Generated 2026-10-03 07:39 UTC · sessions from 2026-10-03T07:11:01.776Z to 2026-10-03T07:39:44.663Z_

| Model | Calls | Input | Cache write | Cache read | Output | API-equivalent cost |
|---|---:|---:|---:|---:|---:|---:|
| claude-opus-5-5 | 51 | 102 | 210,228 | 9,479,836 | 85,958 | $6.56 |
| **Total** | 51 | 102 | 210,228 | 9,479,836 | 85,958 | **$6.56** |

Model calls: **51** · Peak context in a single call: **256,689** tokens
Total tokens processed (sum over all calls): **9,776,124**, of which 97% were cheap cache reads.
