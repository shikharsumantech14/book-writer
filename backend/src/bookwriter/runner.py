"""Run the book graph end to end and record everything a run produces.

data/runs/<run_id>/
    events.jsonl      every event, in order, as it happened (the replay source)
    book.md, book.html
    run_report.json   status, routing, cost per agent/model/chapter, scorecard

LangGraph checkpoints go to data/checkpoints.sqlite, one thread per run. They
let a run pause for a person to review the outline and continue exactly where
it stopped.
"""

from __future__ import annotations

import asyncio
import json
import secrets
import time
import traceback
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.types import Command

from .config import AppConfig, get_settings
from .events import EventLog, make_event, usage_summary
from .graph import build_graph
from .llm import LLM, BudgetExceeded
from .mcp_client import ResearchMCP, connect_research
from .models import FinalChapter
from .scorecard import grade
from .state import Deps

# Human review of the outline: receives {"outline": ...} and returns the decision,
# {"action": "approve" | "edit" | "cancel", "outline": <edited outline, for "edit">}.
Review = Callable[[dict], Awaitable[dict]]


@dataclass
class RunResult:
    run_id: str
    run_dir: Path
    status: str  # completed | stopped_budget | cancelled | failed
    report: dict


class RunCancelled(Exception):
    pass


def new_run_id() -> str:
    return f"{datetime.now():%Y%m%d-%H%M%S}-{secrets.token_hex(2)}"


def root_cause(e: BaseException) -> BaseException:
    """The MCP client runs inside an anyio task group, which wraps anything raised in its
    body in an ExceptionGroup. Unwrap single-exception groups to the error that happened."""
    while isinstance(e, BaseExceptionGroup) and len(e.exceptions) == 1:
        e = e.exceptions[0]
    return e


@asynccontextmanager
async def _research(injected: ResearchMCP | None) -> AsyncIterator[ResearchMCP]:
    if injected is not None:
        yield injected
        return
    async with connect_research("stdio") as research:
        yield research


async def run_book(
    cfg: AppConfig,
    *,
    chapters: int | None = None,
    max_cost_usd: float | None = None,
    parallel_chapters: int | None = None,
    run_id: str | None = None,
    client: Any = None,
    research: ResearchMCP | None = None,
    on_event: Callable[[dict], None] | None = None,
    review: Review | None = None,
) -> RunResult:
    """Plan, research, write, review and assemble the book.

    `chapters` writes only the first N planned chapters (cheap debug runs).
    `review`, when given, is awaited with the outline after the Planner (human in the loop).
    `client` and `research` let tests inject a fake Anthropic client and a fake
    research server, so the whole graph runs without network access.
    """
    count = chapters or cfg.brief.chapters
    if not 1 <= count <= cfg.brief.chapters:
        raise ValueError(f"--chapters must be between 1 and {cfg.brief.chapters}")
    cap = max_cost_usd if max_cost_usd is not None else cfg.run.max_cost_usd
    parallel = parallel_chapters or cfg.run.parallel_chapters

    run_id = run_id or new_run_id()
    settings = get_settings()
    run_dir = settings.data_dir / "runs" / run_id
    log = EventLog(run_dir / "events.jsonl", run_id, on_event)
    llm = LLM(cfg, client, max_cost_usd=cap)
    started = time.time()
    log.record(
        make_event(
            "run_start",
            f"Run {run_id}: {count} chapter(s) on the '{cfg.profile}' profile, cost cap ${cap:.2f}",
            profile=cfg.profile,
            routing=cfg.routing(),
            chapters=count,
            parallel_chapters=parallel,
            max_cost_usd=cap,
            human_review=review is not None,
            limits=cfg.limits.model_dump(),
        )
    )

    status, error, trace, final = "completed", None, None, {}
    try:
        checkpoints = str(settings.data_dir / "checkpoints.sqlite")
        async with _research(research) as rs, AsyncSqliteSaver.from_conn_string(checkpoints) as saver:
            deps = Deps(cfg=cfg, llm=llm, research=rs, run_dir=run_dir, human_review=review is not None)
            graph = build_graph(checkpointer=saver)
            config = {"configurable": {"thread_id": run_id}, "max_concurrency": parallel, "recursion_limit": 200}
            step: Any = {"chapters_to_write": count}
            while True:
                stream = graph.astream(step, config, context=deps, stream_mode=["custom", "values"], subgraphs=True)
                async for namespace, mode, chunk in stream:
                    if mode == "custom":
                        log.record(chunk)
                    elif not namespace:  # the book graph's own state, not a chapter subgraph's
                        final = {k: v for k, v in chunk.items() if k != "__interrupt__"}
                pending = (await graph.aget_state(config)).interrupts
                if not pending:
                    break
                step = Command(resume=await _ask_for_review(log, review, pending[0].value))
    except BaseException as e:  # classified below; anything unexpected is re-raised
        cause = root_cause(e)
        if isinstance(cause, BudgetExceeded):
            status, error = "stopped_budget", str(cause)
        elif isinstance(cause, RunCancelled | asyncio.CancelledError):
            status, error = "cancelled", str(cause) or "Stopped before it finished."
        elif isinstance(cause, Exception):  # recorded in the report; the CLI exits non-zero
            status, error = "failed", f"{type(cause).__name__}: {cause}"
            trace = "".join(traceback.format_exception(cause))
        else:
            raise

    finals = [FinalChapter.model_validate(c) for c in final.get("final_chapters", [])]
    report = {
        "run_id": run_id,
        "status": status,
        "error": error,
        "traceback": trace,
        "profile": cfg.profile,
        "routing": cfg.routing(),
        "chapters_requested": count,
        "human_review": review is not None,
        "started_at": datetime.fromtimestamp(started).isoformat(timespec="seconds"),
        "duration_s": round(time.time() - started, 1),
        "usage": usage_summary(log.events),
        "scorecard": grade(finals, cfg.brief, expected_chapters=count) if finals else None,
        "chapters": {
            k: {key: v.get(key) for key in ("status", "warnings", "rounds", "editor_approved")}
            for k, v in sorted((final.get("chapters") or {}).items())
        },
        "chief_editor": final.get("chief_report"),
        "final_chapters": [c.model_dump() for c in finals],
        "outline": final.get("outline"),
    }
    report_json = json.dumps(report, indent=2, ensure_ascii=False)
    (run_dir / "run_report.json").write_text(report_json, encoding="utf-8", newline="\n")
    total = report["usage"]["total"]["cost_usd"]
    log.record(
        make_event(
            "run_done",
            f"Run {status} in {report['duration_s']:.0f}s, ${total:.4f}" + (f": {error}" if error else ""),
            status=status,
            cost_usd=total,
            error=error,
        )
    )
    log.close()
    return RunResult(run_id, run_dir, status, report)


async def _ask_for_review(log: EventLog, review: Review | None, payload: dict) -> dict:
    """The graph paused after the Planner: ask a person, record the answer, and resume."""
    if review is None:  # cannot happen: the graph only pauses when a reviewer was given
        raise RuntimeError("The graph paused for review, but no reviewer was given.")
    log.record(
        make_event(
            "review_requested",
            "Waiting for a person to approve or edit the outline",
            agent="planner",
            outline=payload["outline"],
        )
    )
    decision = await review(payload)
    action = decision.get("action", "approve")
    if action == "cancel":
        raise RunCancelled("The outline was rejected, so the run was cancelled.")
    log.record(make_event("review_done", f"Outline {'edited' if action == 'edit' else 'approved'}", agent="planner"))
    return decision if action == "edit" else {"action": "approve"}
