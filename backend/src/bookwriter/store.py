"""Where runs live, and how to read them back.

A run is a folder, data/runs/<run_id>/, holding events.jsonl, run_report.json and
the book. The folder is the record: the CLI, the API and the dashboard all read
the same files, and a committed sample is just another run folder. The sample in
docs/sample-output is listed too, so a fresh clone has a finished run to show.
"""

from __future__ import annotations

import json
from pathlib import Path

from .config import BACKEND_ROOT, get_settings
from .events import read_events, usage_summary

SAMPLE_DIR = BACKEND_ROOT.parent / "docs" / "sample-output"


def read_report(run_dir: Path) -> dict | None:
    path = run_dir / "run_report.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def run_dirs() -> dict[str, Path]:
    """Every recorded run, by id. Runs under data/ win over a sample with the same id."""
    dirs: dict[str, Path] = {}
    sample = read_report(SAMPLE_DIR) if SAMPLE_DIR.exists() else None
    if sample:
        dirs[sample["run_id"]] = SAMPLE_DIR
    runs = get_settings().data_dir / "runs"
    if runs.exists():
        for d in sorted(runs.iterdir()):
            if (d / "events.jsonl").exists():
                dirs[d.name] = d
    return dirs


def find_run(run_id: str) -> Path | None:
    return run_dirs().get(run_id)


def events(run_dir: Path, after: int = 0) -> list[dict]:
    """Recorded events with seq > after."""
    return [e for e in read_events(run_dir / "events.jsonl") if e["seq"] > after]


def summary(run_id: str, run_dir: Path) -> dict:
    """One row of the runs list, from the report, or from the events if the run never finished."""
    report = read_report(run_dir)
    base = {"run_id": run_id, "sample": run_dir == SAMPLE_DIR}
    if report:
        card = report.get("scorecard") or {}
        return base | {
            "status": report["status"],
            "profile": report["profile"],
            "chapters": report["chapters_requested"],
            "started_at": report["started_at"],
            "duration_s": report["duration_s"],
            "cost_usd": report["usage"]["total"]["cost_usd"],
            "scorecard_passed": card.get("passed"),
            "title": (report.get("outline") or {}).get("book_title"),
            "error": report.get("error"),
        }
    # No report: the process stopped mid-run (the API restarted, or the machine did).
    evs = read_events(run_dir / "events.jsonl")
    start = (evs[0].get("data") or {}) if evs else {}
    return base | {
        "status": "interrupted",
        "profile": start.get("profile"),
        "chapters": start.get("chapters"),
        "started_at": None,
        "duration_s": None,
        "cost_usd": usage_summary(evs)["total"]["cost_usd"],
        "scorecard_passed": None,
        "title": None,
        "error": "The run stopped before it finished.",
    }
