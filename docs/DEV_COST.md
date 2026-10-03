# Development cost

Tokens spent by Claude Code building this project, measured from the session transcripts (`scripts/dev_usage.py`) and priced with the same `pricing.py` and `config.yaml` prices the runtime uses. Cost is the API-list-price equivalent; the work ran on a Claude subscription plan, so no per-token charge was incurred.

Why cumulative tokens are much larger than the context window: the model is stateless, so every step re-sends the whole conversation. The context window is the size of one request; the totals below are the sum over all requests. Repeated context is served from the prompt cache at a fraction of the input price (0.05x on Opus 5.5, 0.025x on Fable 5.1).

_Generated 2026-10-03 09:31 UTC · sessions from 2026-10-03T07:11:03.285Z to 2026-10-03T09:31:48.956Z_

## By session

| Session | Calls | Input | Cache write | Cache read | Output | API-equivalent cost |
|---|---:|---:|---:|---:|---:|---:|
| AI Engineer take-home assignment brief (claude-opus-5-5) | 55 | 110 | 224,854 | 10,536,956 | 97,442 | $5.18 |
| Assignment plan review and architecture (claude-fable-5-1) | 26 | 652 | 217,814 | 5,172,243 | 73,128 | $7.68 |
| Patel Group book writer M1 core engine (claude-opus-5-5) | 94 | 188 | 338,813 | 25,966,682 | 150,205 | $9.89 |
| **Total** | 175 | 950 | 781,481 | 41,675,881 | 320,775 | **$22.75** |

## By model

| Model | Calls | Input | Cache write | Cache read | Output | API-equivalent cost |
|---|---:|---:|---:|---:|---:|---:|
| claude-fable-5-1 | 26 | 652 | 217,814 | 5,172,243 | 73,128 | $7.68 |
| claude-opus-5-5 | 149 | 298 | 563,667 | 36,503,638 | 247,647 | $15.07 |
| **Total** | 175 | 950 | 781,481 | 41,675,881 | 320,775 | **$22.75** |

Model calls: **175** · Peak context in a single call: **382,409** tokens
Total tokens processed (sum over all calls): **42,779,087**, of which 97% were cheap cache reads.
