"""HTTP API for the dashboard: start runs, follow them live, review the outline, read the results.

    uv run bookwriter serve      # then open http://localhost:8000/docs

The event stream is Server-Sent Events. Every event carries its sequence number
as the SSE id, so a reconnecting browser (Last-Event-ID) or a page that passes
?after=N picks up exactly where it left off. Finished runs stream from their
recording; ?speed=N replays a recording with its original pacing, sped up N times,
so the dashboard can be built and demonstrated without spending anything.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any, Literal

from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from .. import __version__, store
from ..config import ROLES, get_settings, load_config
from ..estimate import estimate
from ..events import usage_summary
from ..graph import build_graph, mermaid
from .runs import LiveRun, NotAwaitingReview, RunBusy, RunManager

KEEPALIVE_S = 15.0
MAX_REPLAY_GAP_S = 2.0


class StartRun(BaseModel):
    profile: str | None = Field(None, description="Routing profile from config.yaml; default: the config's profile.")
    chapters: int | None = Field(None, ge=1, description="Write only the first N planned chapters.")
    human_review: bool | None = Field(None, description="Pause after the Planner for outline approval.")
    max_cost_usd: float | None = Field(None, gt=0, description="Stop the run at this spend.")
    parallel_chapters: int | None = Field(None, ge=1)
    brief: dict[str, Any] | None = Field(None, description="Fields of the brief to override.")
    limits: dict[str, int] | None = Field(None, description="Loop budgets to override.")


class ReviewDecision(BaseModel):
    action: Literal["approve", "edit", "cancel"]
    outline: dict[str, Any] | None = Field(None, description="The edited outline, for action 'edit'.")


def create_app(manager: RunManager | None = None) -> FastAPI:
    manager = manager or RunManager()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        yield
        await manager.shutdown()

    app = FastAPI(title="bookwriter", version=__version__, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=get_settings().cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.manager = manager

    # ---------------------------------------------------------------- reference data

    @app.get("/health")
    def health() -> dict:
        return {"ok": True, "version": __version__}

    @app.get("/config")
    def config() -> dict:
        """The default brief, routing per profile, budgets and prices, for the New run form."""
        cfg = load_config()
        return {
            "brief": cfg.brief.model_dump(),
            "default_profile": cfg.profile,
            "profiles": {name: cfg.with_profile(name).routing() for name in cfg.profiles},
            "limits": cfg.limits.model_dump(),
            "run": cfg.run.model_dump(),
            "human_in_the_loop": cfg.human_in_the_loop,
            "models": {k: v.model_dump() for k, v in cfg.models.items()},
            "roles": list(ROLES),
        }

    @app.get("/estimate")
    def get_estimate(profile: str | None = None, chapters: int | None = Query(None, ge=1)) -> dict:
        cfg = load_config()
        profile = profile or cfg.profile
        reports = [r for d in store.run_dirs().values() if (r := store.read_report(d))]
        return estimate(profile, chapters or cfg.brief.chapters, reports)

    @app.get("/graph")
    def graph() -> dict:
        """The agent graph, exported from the compiled LangGraph graph."""
        g = build_graph().get_graph(xray=True)
        nodes = [
            {"id": n.id, "name": n.name, "group": "chapter" if n.id.startswith("chapter:") else "book"}
            for n in g.nodes.values()
        ]
        edges = [{"source": e.source, "target": e.target, "conditional": e.conditional} for e in g.edges]
        return {"nodes": nodes, "edges": edges, "mermaid": mermaid()}

    # -------------------------------------------------------------------- runs

    def live_summary(run: LiveRun) -> dict:
        return {
            "run_id": run.run_id,
            "sample": False,
            "status": run.status,
            "profile": run.profile,
            "chapters": run.chapters,
            "started_at": run.started_at,
            "duration_s": None,
            "cost_usd": usage_summary(run.events)["total"]["cost_usd"],
            "scorecard_passed": None,
            "title": None,
            "error": run.error,
        }

    @app.get("/runs")
    def list_runs() -> list[dict]:
        rows = {rid: store.summary(rid, d) for rid, d in store.run_dirs().items()}
        for rid, run in manager.live.items():
            if not run.done:  # finished live runs are read back from their report
                rows[rid] = live_summary(run)
        return sorted(rows.values(), key=lambda r: r["run_id"], reverse=True)

    # async on purpose: starting and resuming runs touch tasks and futures on the server's event loop.
    @app.post("/runs", status_code=202)
    async def start_run(req: StartRun) -> dict:
        settings = get_settings()
        if manager.client_factory is None and not (settings.anthropic_api_key and settings.tavily_api_key):
            raise HTTPException(400, "Set ANTHROPIC_API_KEY and TAVILY_API_KEY in backend/.env first.")
        try:
            cfg = load_config(profile=req.profile)
            if req.brief or req.limits:
                data = cfg.model_dump()
                data["brief"] |= req.brief or {}
                data["limits"] |= req.limits or {}
                cfg = cfg.model_validate(data)
        except ValueError as e:
            raise HTTPException(422, str(e)) from e
        chapters = req.chapters or cfg.brief.chapters
        if chapters > cfg.brief.chapters:
            raise HTTPException(422, f"chapters must be at most {cfg.brief.chapters}")
        try:
            run = manager.start(
                cfg,
                chapters=chapters,
                human_review=cfg.human_in_the_loop if req.human_review is None else req.human_review,
                max_cost_usd=req.max_cost_usd,
                parallel_chapters=req.parallel_chapters,
            )
        except RunBusy as e:
            raise HTTPException(409, str(e)) from e
        return {"run_id": run.run_id, "status": run.status}

    @app.get("/runs/{run_id}")
    def get_run(run_id: str) -> dict:
        run = manager.live.get(run_id)
        if run and not run.done:
            return live_summary(run) | {"pending_outline": run.pending_outline, "usage": usage_summary(run.events)}
        run_dir = _run_dir(run_id)
        report = store.read_report(run_dir) or {}
        return store.summary(run_id, run_dir) | {
            "pending_outline": None,
            "usage": report.get("usage") or usage_summary(store.events(run_dir)),
            "scorecard": report.get("scorecard"),
            "chapter_status": report.get("chapters"),
            "routing": report.get("routing"),
        }

    @app.get("/runs/{run_id}/events")
    async def run_events(
        run_id: str,
        after: int = Query(0, ge=0, description="Send events after this sequence number."),
        speed: float | None = Query(None, gt=0, description="Replay a recording with its pacing, N times faster."),
        last_event_id: str | None = Header(None),
    ) -> StreamingResponse:
        after = max(after, int(last_event_id)) if last_event_id and last_event_id.isdigit() else after
        run = manager.live.get(run_id)
        if run is None or run.done:
            source = _replay(store.events(_run_dir(run_id), after), speed)
        else:
            source = _follow(run, after)
        headers = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
        return StreamingResponse(_sse(source), media_type="text/event-stream", headers=headers)

    @app.post("/runs/{run_id}/resume")
    async def resume(run_id: str, decision: ReviewDecision) -> dict:
        if decision.action == "edit" and not decision.outline:
            raise HTTPException(422, "An 'edit' needs the edited outline.")
        try:
            manager.resume(run_id, decision.model_dump())
        except NotAwaitingReview as e:
            raise HTTPException(409, str(e)) from e
        return {"run_id": run_id, "action": decision.action}

    @app.post("/runs/{run_id}/cancel")
    async def cancel(run_id: str) -> dict:
        if run_id not in manager.live:
            raise HTTPException(404, f"Run {run_id} is not running in this server.")
        run = await manager.cancel(run_id)
        return {"run_id": run_id, "status": run.status}

    @app.get("/runs/{run_id}/book.md")
    def book_md(run_id: str) -> FileResponse:
        return _file(run_id, "book.md", "text/markdown; charset=utf-8")

    @app.get("/runs/{run_id}/book.html")
    def book_html(run_id: str) -> FileResponse:
        return _file(run_id, "book.html", "text/html; charset=utf-8")

    @app.get("/runs/{run_id}/report")
    def report(run_id: str) -> FileResponse:
        return _file(run_id, "run_report.json", "application/json")

    return app


def _run_dir(run_id: str):
    run_dir = store.find_run(run_id)
    if run_dir is None:
        raise HTTPException(404, f"No run {run_id}.")
    return run_dir


def _file(run_id: str, name: str, media_type: str) -> FileResponse:
    path = _run_dir(run_id) / name
    if not path.exists():
        raise HTTPException(404, f"Run {run_id} has no {name} (it may still be running, or it stopped early).")
    return FileResponse(path, media_type=media_type)


async def _follow(run: LiveRun, after: int) -> AsyncIterator[dict | None]:
    """A live run's events from `after` on, then new ones as they happen. None means keep-alive."""
    i = after  # seq is 1-based, so events[after] is the first one after `after`
    while True:
        changed = run.changed  # take it before reading, so nothing published in between is missed
        while i < len(run.events):
            yield run.events[i]
            i += 1
        if run.done:
            return
        try:
            await asyncio.wait_for(changed.wait(), KEEPALIVE_S)
        except TimeoutError:
            yield None


async def _replay(events: list[dict], speed: float | None) -> AsyncIterator[dict | None]:
    """A recorded run's events; with `speed`, paced like the original run, N times faster."""
    previous = None
    for event in events:
        if speed and previous is not None:
            await asyncio.sleep(min((event["ts"] - previous) / speed, MAX_REPLAY_GAP_S))
        previous = event["ts"]
        yield event


async def _sse(source: AsyncIterator[dict | None]) -> AsyncIterator[str]:
    async for event in source:
        if event is None:
            yield ": keep-alive\n\n"
        else:
            yield f"id: {event['seq']}\ndata: {json.dumps(event, ensure_ascii=False, default=str)}\n\n"
    # Tell the browser the stream is over; otherwise EventSource reconnects forever.
    yield "event: end\ndata: {}\n\n"


app = create_app()
