"""Live event stream.

Agents call `emit(...)` to report what they are doing. Inside a LangGraph run
the event goes out on the graph's "custom" stream; the runner numbers it,
appends it to data/runs/<run_id>/events.jsonl and hands it to any live viewer
(the CLI now, the dashboard over SSE later). Outside a graph run (unit tests,
calling an agent directly) `emit` is a no-op.

The recording is the source of truth for a run's cost: `usage_summary` rolls
the `llm_call` events up per agent, model and chapter.
"""

from __future__ import annotations

import json
import time
from collections import defaultdict
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any

from langgraph.config import get_stream_writer

TOKEN_KINDS = ("input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens")


def make_event(
    kind: str,
    message: str,
    *,
    agent: str | None = None,
    chapter: int | None = None,
    **data: Any,
) -> dict:
    return {"ts": time.time(), "kind": kind, "agent": agent, "chapter": chapter, "message": message, "data": data}


def emit(
    kind: str,
    message: str,
    *,
    agent: str | None = None,
    chapter: int | None = None,
    **data: Any,
) -> None:
    event = make_event(kind, message, agent=agent, chapter=chapter, **data)
    try:
        writer = get_stream_writer()
    except Exception:  # not inside a graph run
        return
    writer(event)


class EventLog:
    """Numbers events, appends them to events.jsonl as they happen, and fans them out."""

    def __init__(self, path: Path, run_id: str, on_event: Callable[[dict], None] | None = None):
        self.path = path
        self.run_id = run_id
        self.on_event = on_event
        self.events: list[dict] = []
        path.parent.mkdir(parents=True, exist_ok=True)
        self._file = open(path, "a", encoding="utf-8", newline="")  # noqa: SIM115 - closed in close()

    def record(self, event: dict) -> dict:
        event = {"seq": len(self.events) + 1, "run_id": self.run_id, **event}
        self.events.append(event)
        self._file.write(json.dumps(event, ensure_ascii=False, default=str) + "\n")
        self._file.flush()
        if self.on_event:
            self.on_event(event)
        return event

    def close(self) -> None:
        self._file.close()


def read_events(path: Path) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def _bucket() -> dict[str, float]:
    return {"calls": 0, **{k: 0 for k in TOKEN_KINDS}, "cost_usd": 0.0}


def usage_summary(events: Iterable[dict]) -> dict:
    """Tokens and cost per agent, model and chapter, from a run's `llm_call` events."""
    total = _bucket()
    by: dict[str, dict[str, dict]] = {"agent": defaultdict(_bucket), "model": defaultdict(_bucket)}
    by["chapter"] = defaultdict(_bucket)
    searches = extracts = 0
    for e in events:
        d = e.get("data") or {}
        if e["kind"] == "tool_call" and d.get("tool") == "web_search":
            searches += 1
        if e["kind"] == "source_read" and d.get("via") == "extract":
            extracts += 1
        if e["kind"] != "llm_call":
            continue
        keys = {"agent": e.get("agent") or "?", "model": d.get("model", "?")}
        keys["chapter"] = f"chapter {e['chapter']}" if e.get("chapter") else "book"
        for b in [total, *(by[dim][k] for dim, k in keys.items())]:
            b["calls"] += 1
            for k in TOKEN_KINDS:
                b[k] += d.get(k, 0) or 0
            b["cost_usd"] += d.get("cost_usd", 0.0) or 0.0

    def rounded(b: dict) -> dict:
        return {**b, "cost_usd": round(b["cost_usd"], 4)}

    prompt = total["input_tokens"] + total["cache_read_tokens"] + total["cache_write_tokens"]
    return {
        "total": rounded(total),
        "cache_read_share": round(total["cache_read_tokens"] / prompt, 3) if prompt else 0.0,
        **{
            f"by_{dim}": {k: rounded(v) for k, v in sorted(rows.items(), key=lambda kv: -kv[1]["cost_usd"])}
            for dim, rows in by.items()
        },
        # Tavily: an advanced search costs 2 credits; an extract costs 1 credit per 5 URLs (rounded up here).
        "tavily": {"searches": searches, "extract_reads": extracts, "credits_estimate": 2 * searches + extracts},
    }
