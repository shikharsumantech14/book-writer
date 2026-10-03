"""Graph state (the shared blackboard) and run-time dependencies.

State values are plain JSON-able dicts/lists (Pydantic models are dumped on
write and validated on read) so checkpoints serialise cleanly and a crashed
run can resume from the last completed step.

Dependencies (config, LLM client, MCP session, run folder) are not state: they
reach every node, including the chapter subgraphs, as LangGraph runtime
context, so they are never checkpointed.
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
    chapters_to_write: int  # input: write the first N planned chapters (debug runs use 1)
    outline: dict  # Outline
    chapters: Annotated[dict[str, dict], merge_dicts]  # chapter number (str) -> ChapterResult
    chief_report: dict  # consistency notes + applied/rejected edits
    final_chapters: list[dict]  # FinalChapter
    book_markdown: str


class ChapterInput(TypedDict):
    """What the fan-out sends to each chapter subgraph."""

    number: int
    plan: dict  # ChapterPlan
    outline: dict  # Outline (style guide + glossary + titles)


class ChapterOutput(TypedDict):
    """What a chapter subgraph hands back: its result, merged into BookState.chapters."""

    chapters: Annotated[dict[str, dict], merge_dicts]


class ChapterState(TypedDict, total=False):
    # inputs (from the Send fan-out)
    number: int
    plan: dict
    outline: dict

    # working memory, keyed by who writes it (see docs/PLAN.md section 4.3)
    evidence: list[dict]  # Evidence                      <- Researcher
    coverage: list[dict]  # fact needs with no evidence   <- Researcher
    gaps: list[str]  # claims needing new sources         <- Fact-checker, cleared by Researcher
    draft: dict  # ChapterDraft                           <- Writer
    feedback: dict  # what the last send-back asked for   <- Writer (built by routers.writer_feedback)
    lint_issues: list[dict]  # LintIssue                  <- Lint
    editor_verdict: dict  # EditorVerdict                 <- Editor
    fact_report: dict  # FactCheckReport                  <- Fact-checker
    last_review: str  # "lint" | "editor" | "fact_checker": who looked at the draft last

    # counters read by the routers' stop conditions
    writer_passes: int
    lint_rounds: int  # consecutive lint failures since the last reviewer send-back
    editor_rounds: int  # editor reviews so far
    fact_check_rounds: int  # fact-checks so far

    log: Annotated[list[dict], operator.add]  # round-by-round history for the report

    # output to the parent graph
    chapters: Annotated[dict[str, dict], merge_dicts]


def get(state: dict[str, Any], key: str, default: Any = None) -> Any:
    v = state.get(key)
    return default if v is None else v
