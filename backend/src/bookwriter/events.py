"""Live event stream.

Agents call `emit(...)` to report what they are doing. Inside a LangGraph run
the event goes out on the graph's "custom" stream (consumed by the runner,
persisted, and pushed to the dashboard over SSE). Outside a graph run (unit
tests, the CLI calling an agent directly) it is a no-op.
"""

from __future__ import annotations

import time
from typing import Any

from langgraph.config import get_stream_writer


def emit(
    kind: str,
    message: str,
    *,
    agent: str | None = None,
    chapter: int | None = None,
    **data: Any,
) -> None:
    event = {
        "ts": time.time(),
        "kind": kind,
        "agent": agent,
        "chapter": chapter,
        "message": message,
        "data": data,
    }
    try:
        writer = get_stream_writer()
    except Exception:  # not inside a graph run
        return
    writer(event)
