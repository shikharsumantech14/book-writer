# Development cost

Tokens spent by Claude Code building this project, measured from the session transcripts (`scripts/dev_usage.py`) and priced with the same `pricing.py` and `config.yaml` prices the runtime uses. Cost is the API-list-price equivalent; the work ran on a Claude subscription plan, so no per-token charge was incurred.

Why cumulative tokens are much larger than the context window: the model is stateless, so every step re-sends the whole conversation. The context window is the size of one request; the totals below are the sum over all requests. Repeated context is served from the prompt cache at a fraction of the input price (0.05x on Opus 5.5, 0.025x on Fable 5.1).

_Generated 2026-10-03 23:05 UTC · sessions from 2026-10-03T07:11:03.285Z to 2026-10-03T23:05:44.819Z_

## By session

| Session | Calls | Input | Cache write | Cache read | Output | API-equivalent cost |
|---|---:|---:|---:|---:|---:|---:|
| AI Engineer take-home assignment brief (claude-opus-5-5) | 55 | 110 | 224,854 | 10,536,956 | 97,442 | $5.18 |
| Assignment plan review and architecture (claude-fable-5-1) | 26 | 652 | 217,814 | 5,172,243 | 73,128 | $7.68 |
| Patel Group book writer M1 core engine (claude-opus-5-5) | 498 | 998 | 2,007,178 | 244,948,580 | 630,550 | $71.64 |
| **Total** | 579 | 1,760 | 2,449,846 | 260,657,779 | 801,120 | **$84.50** |

## By model

| Model | Calls | Input | Cache write | Cache read | Output | API-equivalent cost |
|---|---:|---:|---:|---:|---:|---:|
| claude-fable-5-1 | 26 | 652 | 217,814 | 5,172,243 | 73,128 | $7.68 |
| claude-opus-5-5 | 553 | 1,108 | 2,232,032 | 255,485,536 | 727,992 | $76.82 |
| **Total** | 579 | 1,760 | 2,449,846 | 260,657,779 | 801,120 | **$84.50** |

Model calls: **579** · Peak context in a single call: **966,829** tokens
Total tokens processed (sum over all calls): **263,910,505**, of which 99% were cheap cache reads.
