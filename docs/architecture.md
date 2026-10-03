# Architecture

![System architecture](architecture.png)

## System

<!-- system-diagram:start -->
```mermaid
flowchart TB
    subgraph UI["Dashboard · Next.js + shadcn/ui"]
        direction LR
        RUNS[Runs] ~~~ LIVE[Run: live or replay] ~~~ BOOK[Book] ~~~ REPORT[Report]
    end
    subgraph SVC["HTTP API · FastAPI"]
        direction LR
        REST["/runs · /graph · /config · /estimate"] ~~~ SSE["/runs/{id}/events · Server-Sent Events, resumable"]
    end
    CLI["CLI · bookwriter run / replay / report"]
    subgraph ENGINE["Agent engine · LangGraph"]
        direction LR
        BG["Book graph · Planner, outline review, Chief Editor, Assembler"] --> CH["Chapter subgraph × 3, in parallel · Researcher, Writer, Lint, Editor, Fact-checker, Safety net"]
    end
    subgraph MCPS["Research MCP server · stdio"]
        TOOLS["web_search · read_page · verify_quote · check_links"]
    end
    CLAUDE[("Claude API · Opus 5.5, Sonnet 5.5, Haiku 4.5")]
    WEB[("Tavily search and Extract · live pages · disk cache")]
    RUNDIR[("data/runs/&lt;id&gt; · events.jsonl, run_report.json, book")]
    CKPT[("checkpoints.sqlite")]
    HOST["Claude Desktop / Claude Code"]

    UI -- "REST + SSE" --> SVC
    SVC --> ENGINE
    CLI --> ENGINE
    ENGINE -- "Messages API" --> CLAUDE
    ENGINE -- "MCP" --> MCPS
    ENGINE --> RUNDIR
    ENGINE --> CKPT
    MCPS --> WEB
    HOST -. "MCP" .-> MCPS
    SVC -. "reads back" .-> RUNDIR
```
<!-- system-diagram:end -->

| Layer | Code | What it does |
|---|---|---|
| Agent engine | `backend/src/bookwriter/graph.py`, `routers.py`, `agents/` | Runs the agents as a LangGraph state machine. Agents read and write typed state; plain-Python routers choose the next step |
| Research MCP server | `mcp_servers/research.py`, `tools/web.py` | Search, page reading with fallback, quote verification and link checks, served over MCP to the Researcher, the Fact-checker and any MCP host |
| LLM layer | `llm.py`, `pricing.py` | The one place that calls Claude: routing per role, structured outputs, the tool loop, prompt caching, metering and the cost cap |
| Runner and store | `runner.py`, `store.py`, `events.py` | Runs a book, records every event, writes the report; a run is its folder |
| HTTP API | `api/app.py`, `api/runs.py` | Starts, follows, reviews and cancels runs; streams events; serves outputs, the graph, config and estimates |
| Dashboard | `frontend/` | Runs, live run and replay, book reader, report |

## Agent graph

Generated from the compiled LangGraph graph (`uv run bookwriter graph`); a test fails if it drifts from the code.

![Agent graph](agent-graph.png)

<!-- agent-graph:start -->
```mermaid
---
config:
  flowchart:
    curve: linear
---
graph TD;
	__start__([<p>__start__</p>]):::first
	planner(planner)
	outline_review(outline_review)
	chief_editor(chief_editor)
	assembler(assembler)
	__end__([<p>__end__</p>]):::last
	__start__ --> planner;
	chapter\3asafety_net --> chief_editor;
	chief_editor --> assembler;
	outline_review -.-> chapter\3a__start__;
	planner --> outline_review;
	assembler --> __end__;
	subgraph chapter
	chapter\3a__start__(<p>__start__</p>)
	chapter\3aresearcher(researcher)
	chapter\3awriter(writer)
	chapter\3alint(lint)
	chapter\3aeditor(editor)
	chapter\3afact_checker(fact_checker)
	chapter\3asafety_net(safety_net)
	chapter\3a__start__ --> chapter\3aresearcher;
	chapter\3aeditor -.-> chapter\3afact_checker;
	chapter\3aeditor -.-> chapter\3awriter;
	chapter\3afact_checker -.-> chapter\3aresearcher;
	chapter\3afact_checker -.-> chapter\3asafety_net;
	chapter\3afact_checker -.-> chapter\3awriter;
	chapter\3alint -.-> chapter\3aeditor;
	chapter\3alint -.-> chapter\3afact_checker;
	chapter\3alint -.-> chapter\3awriter;
	chapter\3aresearcher --> chapter\3awriter;
	chapter\3awriter --> chapter\3alint;
	end
	classDef default fill:#f2f0ff,line-height:1.2
	classDef first fill-opacity:0
	classDef last fill:#bfb6fc
```
<!-- agent-graph:end -->

## What happens in a run

1. **Plan.** The Planner turns the brief into an outline: three chapters, five to seven fact questions each, a style
   guide and a glossary. With review switched on, the run pauses here until a person approves or edits it.
2. **Fan out.** One chapter subgraph per chapter starts, all in parallel (`run.parallel_chapters`).
3. **Research.** The Researcher searches (official sources first), reads pages and records evidence. Code accepts a
   quote only if it appears on the page, and a claim only if every number in it is in the quote.
4. **Write and review.** The Writer drafts from the evidence ids; lint (code) checks the rules code can check; the
   Editor reviews language; the Fact-checker checks links, then whether each cited quote supports its sentence.
   Each can send the chapter back, within its budget; a missing source sends it back to the Researcher.
5. **Safety net.** When the budgets run out, code removes anything still unverified.
6. **Harmonise and assemble.** The Chief Editor proposes guarded edits for one voice across chapters; the
   Assembler numbers citations and builds the reference lists; the scorecard grades the book against the brief.

Every step is an event in `events.jsonl`. The CLI prints them, the API streams them, the dashboard draws them, and
replay plays them back.
