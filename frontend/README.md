# Dashboard

Next.js (App Router) + TypeScript + Tailwind + shadcn/ui + React Flow + Recharts. It talks to the
bookwriter API (`uv run bookwriter serve` in `backend/`) and works fully against recorded runs, so it
needs no API spend to explore.

```bash
npm install
cp .env.example .env.local   # optional: NEXT_PUBLIC_API_URL, default http://localhost:8000
npm run dev                  # http://localhost:3000
```

| Screen | What it shows |
|---|---|
| Runs (`/`) | Run history with status, scorecard, cost and time; a New run panel with routing per agent and a cost estimate |
| Run (`/runs/[id]`) | The agent graph lighting up as agents work, send-back loops animating, chapter lanes, an activity feed and a cost ticker. Live for a running run, replayable for a finished one. Outline review appears here when a run waits for it |
| Book (`/runs/[id]/book`) | The book in a reading layout; hover any `[n]` for the source, the verified quote, the link status and the fact-check result |
| Report (`/runs/[id]/report`) | The scorecard against the brief, cost per agent, model and chapter, and the Planner's outline and style guide |

The design system is documented in [DESIGN.md](DESIGN.md).

```
src/
  app/              routes (all client-rendered; data comes from the API)
  components/       shared pieces, plus live/, book/, report/, runs/, run/
  components/ui/    shadcn/ui components
  hooks/            useApi (fetch + poll), useRunEvents (Server-Sent Events)
  lib/              API types, agent identities, the event-stream reducer, formatting
```

Checks: `npm run lint`, `npm run typecheck`, `npm run build`.
