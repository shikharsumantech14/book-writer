# Dashboard

Next.js (App Router) + TypeScript + Tailwind + shadcn/ui + Recharts. It talks to the bookwriter API
(`uv run bookwriter serve` in `backend/`) and works fully against recorded runs, so it needs no API
spend to explore.

```bash
npm install
cp .env.example .env.local   # optional: NEXT_PUBLIC_API_URL, default http://localhost:8000
npm run dev                  # http://localhost:3000
```

| Screen | What it shows |
|---|---|
| Runs (`/`) | The product in one line, the latest book as a cover with its numbers, and every run with its status, scorecard, cost and time; a New run panel with routing per agent and a cost estimate |
| Run (`/runs/[id]`) | A mission-control console, live for a running run or replayed for a finished one: spend against the cost cap, model calls, tokens and progress; the assembly line, one lane per chapter, where the station at work glows and every send-back draws a counted loop; a timeline of who worked when; a feed filterable by chapter. Outline review appears here when a run waits for it |
| Book (`/runs/[id]/book`) | The book as a printed page; point at any `[n]` and its source opens in the margin with the verified quote, the link status and the fact-check result |
| Report (`/runs/[id]/report`) | A data dashboard: the verdict, every rule of the brief per chapter, the Editor's scores, fact-check verdicts and source mix, cost per agent and model, spend over time, rounds per chapter and the token mix; chapter details, usage tables and the Planner's outline in two more tabs |
| How it works (`/explain`) | The two pictures in the project README, drawn by the dashboard itself |

The design system is documented in [DESIGN.md](DESIGN.md).

```
src/
  app/              routes (all client-rendered; data comes from the API)
  components/       shared pieces, plus run/, live/, book/, report/, runs/, explain/
  components/ui/    shadcn/ui components
  hooks/            useApi (fetch + poll), useRunEvents (Server-Sent Events)
  lib/              API types, agent identities, the event-stream reducer, the timeline builder, formatting
```

Checks: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`.
