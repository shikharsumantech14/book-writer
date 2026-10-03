"""Checks on what the repository ships: the sample book and the generated diagram."""

from __future__ import annotations

import json
from pathlib import Path

from bookwriter.graph import GRAPH_END, GRAPH_START, mermaid_block, sync_diagram
from bookwriter.models import FinalChapter
from bookwriter.render import book_markdown
from bookwriter.scorecard import grade

REPO = Path(__file__).resolve().parents[2]
SAMPLE = REPO / "docs" / "sample-output"


def test_committed_sample_book_passes_the_scorecard(cfg):
    """The book in docs/sample-output follows the brief, graded by the current scorecard code."""
    report = json.loads((SAMPLE / "run_report.json").read_text(encoding="utf-8"))
    chapters = [FinalChapter.model_validate(c) for c in report["final_chapters"]]
    card = grade(chapters, cfg.brief, expected_chapters=report["chapters_requested"])
    failed = [(ch["number"], c) for ch in card["chapters"] for c in ch["checks"] if not c["passed"]]
    assert card["passed"], failed
    assert len(chapters) == cfg.brief.chapters
    # book.md is exactly the book the report describes
    book = (SAMPLE / "book.md").read_text(encoding="utf-8")
    assert book == book_markdown(report["outline"]["book_title"], chapters)


def test_readme_diagram_is_generated_from_the_graph():
    readme = (REPO / "README.md").read_text(encoding="utf-8")
    assert mermaid_block() in readme, "Regenerate it: uv run bookwriter graph --readme ../README.md"


def test_sync_diagram_replaces_only_the_marked_block():
    doc = f"intro\n{GRAPH_START}\nold diagram\n{GRAPH_END}\noutro\n"
    out = sync_diagram(doc)
    assert out.startswith("intro\n") and out.endswith("\noutro\n")
    assert "old diagram" not in out and "```mermaid" in out
