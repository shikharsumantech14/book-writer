"""The HTTP API, end to end, with the scripted fake LLM and canned web pages (no API cost)."""

from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager

import httpx
import pytest
from fakes import FakeAnthropic, install_fake_web

from bookwriter.api import app as app_module
from bookwriter.api.app import create_app
from bookwriter.api.runs import LiveRun, RunManager
from bookwriter.config import get_settings
from bookwriter.mcp_client import connect_research


@asynccontextmanager
async def api(monkeypatch):
    """An API client over a run manager that uses the fake LLM and an in-process research server.

    Opened inside each test (not as a fixture) because the MCP session must close in the task that opened it.
    """
    install_fake_web(monkeypatch)
    clients: list[FakeAnthropic] = []

    def client_factory() -> FakeAnthropic:
        clients.append(FakeAnthropic())
        return clients[-1]

    async with connect_research("inprocess") as research:
        manager = RunManager(client_factory=client_factory, research=research)
        transport = httpx.ASGITransport(app=create_app(manager))
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            client.fakes = clients
            yield client
        await manager.shutdown()


async def wait_for(client: httpx.AsyncClient, run_id: str, *statuses: str, timeout: float = 20) -> dict:
    for _ in range(int(timeout / 0.05)):
        run = (await client.get(f"/runs/{run_id}")).json()
        if run["status"] in statuses:
            return run
        await asyncio.sleep(0.05)
    raise AssertionError(f"run {run_id} never reached {statuses}; last status {run['status']}")


def sse_events(body: str) -> tuple[list[dict], bool]:
    """Parse an SSE body into (events, ended)."""
    events, ended = [], False
    for block in body.strip().split("\n\n"):
        if block.startswith("event: end"):
            ended = True
        elif "data: " in block:
            events.append(json.loads(block.split("data: ", 1)[1]))
    return events, ended


# ------------------------------------------------------------------ reference data


async def test_reference_endpoints(monkeypatch):
    async with api(monkeypatch) as client:
        assert (await client.get("/health")).json()["ok"] is True

        config = (await client.get("/config")).json()
        assert set(config["profiles"]) == {"showcase", "dev"}
        assert config["profiles"]["showcase"]["writer"] == {
            "model": "claude-opus-5-5",
            "tier": "strong",
            "effort": "medium",
            "revision_effort": "high",
        }

        # the committed showcase sample is the history behind the showcase estimate
        showcase = (await client.get("/estimate", params={"profile": "showcase", "chapters": 3})).json()
        assert showcase["basis"].startswith("median of 1 measured showcase") and showcase["estimate_usd"] > 2
        dev = (await client.get("/estimate", params={"profile": "dev", "chapters": 1})).json()
        assert dev["basis"].startswith("first measured runs") and dev["estimate_usd"] == 0.58

        graph = (await client.get("/graph")).json()
        ids = {n["id"] for n in graph["nodes"]}
        assert {"planner", "outline_review", "chapter:researcher", "chapter:fact_checker", "assembler"} <= ids
        loops = {(e["source"], e["target"]) for e in graph["edges"] if e["conditional"]}
        assert ("chapter:fact_checker", "chapter:researcher") in loops and "```" not in graph["mermaid"]


# ------------------------------------------------------------------ a run, start to finish


async def test_run_lifecycle(monkeypatch):
    async with api(monkeypatch) as client:
        started = await client.post("/runs", json={"chapters": 1, "profile": "dev"})
        assert started.status_code == 202
        run_id = started.json()["run_id"]

        run = await wait_for(client, run_id, "completed")
        assert run["scorecard"]["passed"] and run["usage"]["total"]["cost_usd"] > 0

        listed = (await client.get("/runs")).json()
        assert run_id in {r["run_id"] for r in listed}
        assert any(r["sample"] for r in listed)  # the committed sample is listed too

        events, ended = sse_events((await client.get(f"/runs/{run_id}/events")).text)
        assert ended and [e["seq"] for e in events] == list(range(1, len(events) + 1))
        assert events[0]["kind"] == "run_start" and events[-1]["kind"] == "run_done"

        # a reconnecting browser picks up after the last event it saw
        tail, _ = sse_events((await client.get(f"/runs/{run_id}/events", params={"after": len(events) - 2})).text)
        assert [e["seq"] for e in tail] == [len(events) - 1, len(events)]
        resumed = await client.get(f"/runs/{run_id}/events", headers={"Last-Event-ID": str(len(events) - 1)})
        assert [e["seq"] for e in sse_events(resumed.text)[0]] == [len(events)]

        book = await client.get(f"/runs/{run_id}/book.md")
        assert book.status_code == 200 and book.text.startswith("# Pay Me on UPI")
        assert (await client.get(f"/runs/{run_id}/report")).json()["status"] == "completed"
        assert "<html" in (await client.get(f"/runs/{run_id}/book.html")).text


async def test_unknown_runs_and_bad_requests(monkeypatch):
    async with api(monkeypatch) as client:
        assert (await client.get("/runs/nope")).status_code == 404
        assert (await client.get("/runs/nope/book.md")).status_code == 404
        assert (await client.post("/runs/nope/resume", json={"action": "approve"})).status_code == 409
        assert (await client.post("/runs", json={"chapters": 9})).status_code == 422
        assert (await client.post("/runs", json={"profile": "cheap"})).status_code == 422


async def test_starting_a_run_needs_keys(monkeypatch):
    monkeypatch.setattr(get_settings(), "anthropic_api_key", None)
    transport = httpx.ASGITransport(app=create_app(RunManager()))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        assert (await client.post("/runs", json={})).status_code == 400


# ------------------------------------------------------------------ human review


async def test_outline_review_over_the_api(monkeypatch):
    async with api(monkeypatch) as client:
        run_id = (await client.post("/runs", json={"chapters": 1, "human_review": True})).json()["run_id"]
        waiting = await wait_for(client, run_id, "awaiting_review")
        outline = waiting["pending_outline"]
        assert len(outline["chapters"]) == 3

        # one run at a time
        assert (await client.post("/runs", json={"chapters": 1})).status_code == 409
        # an edit must carry the outline
        assert (await client.post(f"/runs/{run_id}/resume", json={"action": "edit"})).status_code == 422

        outline["chapters"][0]["title"] = "Edited in the dashboard"
        ok = await client.post(f"/runs/{run_id}/resume", json={"action": "edit", "outline": outline})
        assert ok.status_code == 200
        await wait_for(client, run_id, "completed")
        writer_prompts = [c["system"] for c in client.fakes[0].calls if c["what"] == "ChapterDraft"]
        assert writer_prompts and all("Edited in the dashboard" in p for p in writer_prompts)


async def test_cancel_a_waiting_run(monkeypatch):
    async with api(monkeypatch) as client:
        run_id = (await client.post("/runs", json={"chapters": 1, "human_review": True})).json()["run_id"]
        await wait_for(client, run_id, "awaiting_review")
        cancelled = await client.post(f"/runs/{run_id}/cancel")
        assert cancelled.json()["status"] == "cancelled"
        run = await wait_for(client, run_id, "cancelled")
        assert run["error"] and (await client.get(f"/runs/{run_id}/report")).status_code == 200
        # the slot is free again
        assert (await client.post("/runs", json={"chapters": 1})).status_code == 202


# ------------------------------------------------------------------ streaming internals


async def test_follow_streams_a_live_run_until_it_ends(monkeypatch):
    monkeypatch.setattr(app_module, "KEEPALIVE_S", 0.05)
    run = LiveRun("r1", "dev", 1, "now")

    async def produce():
        for seq in (1, 2):
            run.publish({"seq": seq})
            await asyncio.sleep(0.12)  # long enough for a keep-alive in between

    run.task = asyncio.create_task(produce())
    run.task.add_done_callback(lambda _: run.notify())
    got = [e async for e in app_module._follow(run, after=0)]
    assert [e["seq"] for e in got if e] == [1, 2] and None in got


async def test_replay_keeps_the_pacing_and_caps_long_gaps(monkeypatch):
    slept: list[float] = []

    async def fake_sleep(seconds):
        slept.append(seconds)

    monkeypatch.setattr(app_module.asyncio, "sleep", fake_sleep)
    events = [{"seq": 1, "ts": 0.0}, {"seq": 2, "ts": 10.0}, {"seq": 3, "ts": 400.0}]
    got = [e async for e in app_module._replay(events, speed=10)]
    assert [e["seq"] for e in got] == [1, 2, 3]
    assert slept == [pytest.approx(1.0), app_module.MAX_REPLAY_GAP_S]
