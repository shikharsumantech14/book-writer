"""Runs started through the API: one background task each, with a live event feed.

A live run keeps its events in memory as well as in events.jsonl, so any number
of dashboard tabs can follow it, and a refreshed tab catches up from where it
left off. Human review is a handshake: the runner awaits a future that
`resume()` resolves.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from ..config import AppConfig
from ..mcp_client import ResearchMCP
from ..runner import new_run_id, run_book


class RunBusy(Exception):
    """One run at a time: parallel runs would share rate limits and the budget."""


class NotAwaitingReview(Exception):
    pass


@dataclass
class LiveRun:
    run_id: str
    profile: str
    chapters: int
    started_at: str
    status: str = "running"  # running | awaiting_review | completed | stopped_budget | cancelled | failed
    events: list[dict] = field(default_factory=list)
    changed: asyncio.Event = field(default_factory=asyncio.Event)
    pending_outline: dict | None = None
    error: str | None = None
    task: asyncio.Task | None = None
    _decision: asyncio.Future | None = None

    @property
    def done(self) -> bool:
        return self.task is not None and self.task.done()

    def publish(self, event: dict) -> None:
        self.events.append(event)
        self.notify()

    def notify(self) -> None:
        """Wake everyone following this run; followers wait on the next `changed`."""
        self.changed.set()
        self.changed = asyncio.Event()

    async def review(self, payload: dict) -> dict:
        """Called by the runner when the graph pauses after the Planner."""
        self.pending_outline, self.status = payload["outline"], "awaiting_review"
        self._decision = asyncio.get_running_loop().create_future()
        self.notify()
        try:
            return await self._decision
        finally:
            self.pending_outline, self._decision, self.status = None, None, "running"


class RunManager:
    def __init__(self, *, client_factory: Callable[[], Any] | None = None, research: ResearchMCP | None = None):
        # Test hooks: a fake Anthropic client per run, and an already-open research session.
        self.client_factory = client_factory
        self.research = research
        self.live: dict[str, LiveRun] = {}

    def active(self) -> LiveRun | None:
        return next((r for r in self.live.values() if not r.done), None)

    def start(
        self,
        cfg: AppConfig,
        *,
        chapters: int,
        human_review: bool,
        max_cost_usd: float | None,
        parallel_chapters: int | None,
    ) -> LiveRun:
        if self.active():
            raise RunBusy(f"Run {self.active().run_id} is still going.")
        run = LiveRun(new_run_id(), cfg.profile, chapters, datetime.now().isoformat(timespec="seconds"))

        async def go() -> None:
            try:
                result = await run_book(
                    cfg,
                    chapters=chapters,
                    max_cost_usd=max_cost_usd,
                    parallel_chapters=parallel_chapters,
                    run_id=run.run_id,
                    client=self.client_factory() if self.client_factory else None,
                    research=self.research,
                    on_event=run.publish,
                    review=run.review if human_review else None,
                )
                run.status, run.error = result.status, result.report.get("error")
            except Exception as e:  # failed before the run began, e.g. bad settings
                run.status, run.error = "failed", f"{type(e).__name__}: {e}"
            finally:
                run.notify()

        run.task = asyncio.create_task(go(), name=f"run-{run.run_id}")
        self.live[run.run_id] = run
        return run

    def resume(self, run_id: str, decision: dict) -> None:
        run = self.live.get(run_id)
        if run is None or run._decision is None or run._decision.done():
            raise NotAwaitingReview(f"Run {run_id} is not waiting for a review.")
        run._decision.set_result(decision)

    async def cancel(self, run_id: str) -> LiveRun:
        run = self.live[run_id]
        if run.task and not run.task.done():
            run.task.cancel()
            await asyncio.wait({run.task})  # the runner writes its report on the way out
        return run

    async def shutdown(self) -> None:
        for run_id, run in list(self.live.items()):
            if not run.done:
                await self.cancel(run_id)
