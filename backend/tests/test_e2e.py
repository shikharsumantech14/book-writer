"""The whole graph, end to end, with a scripted LLM and canned web pages: no API cost.

The research MCP server runs in-process over a real MCP session, so the
Researcher and Fact-checker reach their tools exactly as in production.
"""

from __future__ import annotations

import json

import pytest
from fakes import FakeAnthropic, install_fake_web

from bookwriter.events import read_events
from bookwriter.mcp_client import connect_research
from bookwriter.runner import run_book


async def _run(cfg, monkeypatch, **kw):
    install_fake_web(monkeypatch)
    client = FakeAnthropic()
    async with connect_research("inprocess") as research:
        result = await run_book(cfg, client=client, research=research, **kw)
    return result, client


async def test_full_book_runs_every_loop(cfg, monkeypatch):
    result, client = await _run(cfg, monkeypatch, parallel_chapters=3)
    report = result.report
    assert result.status == "completed", report["error"]

    ch = report["chapters"]
    # chapter 1: lint, editor and fact-checker each sent it back once
    assert ch["1"]["rounds"] == {"writer_passes": 4, "editor_rounds": 2, "fact_check_rounds": 2}
    assert ch["1"]["status"] == "ok"
    # chapter 2: a missing source triggered gap research, then it passed
    assert ch["2"]["rounds"]["fact_check_rounds"] == 2 and ch["2"]["status"] == "ok"
    # chapter 3: fact-check budget spent; the safety net shipped it with warnings
    assert ch["3"]["rounds"] == {"writer_passes": 3, "editor_rounds": 1, "fact_check_rounds": 3}
    assert ch["3"]["status"] == "shipped_with_warnings"

    card = report["scorecard"]
    assert card["passed"], json.dumps(card, indent=1)
    assert [c["number"] for c in card["chapters"]] == [1, 2, 3]

    # every agent was metered, priced from config.yaml
    usage = report["usage"]
    assert set(usage["by_agent"]) == {
        "planner",
        "researcher",
        "writer",
        "editor",
        "claim_tagger",
        "fact_checker",
        "chief_editor",
    }
    assert usage["total"]["cost_usd"] > 0
    assert usage["total"]["cache_write_tokens"] > 0 and usage["cache_read_share"] > 0

    # Writer effort: medium on first drafts, high on rewrites (showcase profile)
    writer_calls = [c for c in client.calls if c["what"] == "ChapterDraft"]
    efforts = {("<revision>" in c["system"], c["effort"]) for c in writer_calls}
    assert efforts == {(False, "medium"), (True, "high")}
    assert {c["model"] for c in writer_calls} == {"claude-opus-5-5"}

    # Researcher coverage reached the Writer: the unanswered question is listed as a gap
    first = next(c for c in writer_calls if "Unanswerable one?" in c["system"])
    assert "<evidence_gaps>" in first["system"]

    # Chief Editor: the safe edit applied, the citation-changing and unknown-chapter edits rejected
    chief = report["chief_editor"]
    assert len(chief["applied"]) == 1 and len(chief["rejected"]) == 2

    # outputs on disk
    book = (result.run_dir / "book.md").read_text(encoding="utf-8")
    assert book.count("## Chapter") == 3 and "Imagine a quiet morning" in book
    assert "### References" in book and "| Mint" not in book  # titles cleaned of site suffixes
    assert (result.run_dir / "book.html").exists()
    saved = json.loads((result.run_dir / "run_report.json").read_text(encoding="utf-8"))
    assert saved["status"] == "completed"


async def test_events_are_recorded_in_order(cfg, monkeypatch):
    result, _ = await _run(cfg, monkeypatch, chapters=1)
    events = read_events(result.run_dir / "events.jsonl")
    assert [e["seq"] for e in events] == list(range(1, len(events) + 1))
    kinds = {e["kind"] for e in events}
    assert {
        "run_start",
        "llm_call",
        "tool_call",
        "evidence_added",
        "evidence_rejected",
        "coverage",
        "review",
        "chapter_done",
        "book_ready",
        "run_done",
    } <= kinds
    assert events[0]["kind"] == "run_start" and events[-1]["kind"] == "run_done"
    assert all(e["run_id"] == result.run_id for e in events)


async def test_single_chapter_dev_profile(monkeypatch):
    from bookwriter.config import load_config

    cfg = load_config(profile="dev")
    result, client = await _run(cfg, monkeypatch, chapters=1)
    assert result.status == "completed"
    assert result.report["scorecard"]["partial_run"] is True
    assert list(result.report["chapters"]) == ["1"]
    models = {c["model"] for c in client.calls}
    assert models == {"claude-sonnet-5-5", "claude-haiku-4-5"}


async def test_cost_cap_stops_the_run(cfg, monkeypatch):
    result, _ = await _run(cfg, monkeypatch, chapters=1, max_cost_usd=0.01)
    assert result.status == "stopped_budget"
    assert "cost cap" in result.report["error"]
    assert (result.run_dir / "run_report.json").exists()


async def test_rejects_bad_chapter_count(cfg):
    with pytest.raises(ValueError):
        await run_book(cfg, chapters=4)
