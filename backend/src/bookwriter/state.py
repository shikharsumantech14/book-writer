"""Graph state (the shared blackboard) and run-time dependencies.

State values are plain JSON-able dicts/lists (Pydantic models are dumped on
write and validated on read) so checkpoints serialise cleanly and a crashed
run can resume from the last completed step.
"""

from __future__ import annotations

import operator
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Any, TypedDict

from .config import AppConfig
from .llm import LLM
from .mcp_client import ResearchMCP


def merge_dicts(a: dict, b: dict) -> dict:
    return {**(a or {}), **(b or {})}


@dataclass
class Deps:
    """Run-time dependencies injected into every node (not checkpointed)."""

    cfg: AppConfig
    llm: LLM
    research: ResearchMCP
    run_dir: Path


class BookState(TypedDict, total=False):
    outline: dict  # Outline
    chapters: Annotated[dict[str, dict], merge_dicts]  # chapter number (str) -> ChapterResult
    chief_report: dict  # ChiefEditorReport + applied/rejected edits
    final_chapters: list[dict]  # FinalChapter
    book_markdown: str


class ChapterState(TypedDict, total=False):
    # inputs (from the Send fan-out)
    number: int
    plan: dict  # ChapterPlan
    outline: dict  # Outline (style guide + glossary + titles)

    # working memory
    evidence: list[dict]  # Evidence
    draft: dict  # ChapterDraft
    feedback: dict  # pending feedback for the writer: {"from": ..., "items": [...]}
    gaps: list[str]  # claims needing new sources (fact-check -> researcher)
    lint_issues: list[dict]
    editor_verdict: dict
    editor_approved: bool
    fact_report: dict
    writer_passes: int
    lint_rounds: int
    editor_rounds: int
    fact_check_rounds: int
    removed_sentences: list[str]
    log: Annotated[list[dict], operator.add]  # round-by-round history for the report

    # output to the parent graph
    chapters: Annotated[dict[str, dict], merge_dicts]


def get(state: dict[str, Any], key: str, default: Any = None) -> Any:
    v = state.get(key)
    return default if v is None else v
