"""Planner: brief -> outline (chapters, fact needs) + style guide."""

from __future__ import annotations

from ..config import AppConfig
from ..events import emit
from ..llm import LLM
from ..models import Outline
from ..prompts import render


async def plan_book(cfg: AppConfig, llm: LLM) -> Outline:
    b = cfg.brief
    emit("agent_start", "Designing the outline and style guide", agent="planner")
    system = render(
        "planner",
        title=b.title,
        audience=b.audience,
        chapters=b.chapters,
        words_min=b.words_min,
        words_max=b.words_max,
        tone=b.tone,
        citation_rules=b.citation_rules,
    )
    outline = await llm.structured(
        "planner", system=system, user="Create the outline and the style guide for this book.", output=Outline
    )
    outline = normalize_outline(outline, cfg)
    emit(
        "agent_done",
        "Outline ready: " + " · ".join(f"{c.number}. {c.title}" for c in outline.chapters),
        agent="planner",
        outline=outline.model_dump(),
    )
    return outline


def normalize_outline(outline: Outline, cfg: AppConfig) -> Outline:
    """Enforce invariants the rest of the graph relies on."""
    n = cfg.brief.chapters
    if len(outline.chapters) < n:
        raise ValueError(f"Planner returned {len(outline.chapters)} chapters; brief needs {n}.")
    outline.chapters = outline.chapters[:n]
    outline.book_title = cfg.brief.title  # the title is fixed by the brief
    for i, ch in enumerate(outline.chapters, 1):
        ch.number = i
        for j, f in enumerate(ch.fact_needs, 1):
            f.id = f"F{j}"
    seen: set[str] = set()
    glossary = []
    for g in outline.style_guide.glossary:
        key = g.term.strip().lower()
        if key in seen:
            continue
        seen.add(key)
        g.introduced_in_chapter = min(max(g.introduced_in_chapter, 1), n)
        glossary.append(g)
    outline.style_guide.glossary = glossary
    return outline
