"""Editor: grammar, tone, jargon and readability review with a structured verdict."""

from __future__ import annotations

from ..events import emit
from ..models import ChapterDraft, EditorVerdict, Outline
from ..prompts import render
from ..state import Deps
from .writer import chapter_terms, draft_text, style_guide_text


async def review_chapter(
    deps: Deps,
    number: int,
    outline: Outline,
    draft: ChapterDraft,
    *,
    previous: EditorVerdict | None = None,
) -> EditorVerdict:
    new_terms, _ = chapter_terms(outline, number)
    history = ""
    if previous:
        raised = "\n".join(f'- [{i.severity}] {i.problem} ("{i.quote}")' for i in previous.issues)
        history = f"\nThis is a re-review. Issues you raised last round:\n{raised}"
    system = render(
        "editor",
        audience=deps.cfg.brief.audience,
        tone=deps.cfg.brief.tone,
        style_guide=style_guide_text(outline),
        new_terms=new_terms,
        history=history,
    )
    emit("agent_start", "Reviewing language and tone", agent="editor", chapter=number)
    verdict = await deps.llm.structured(
        "editor",
        system=system,
        user=f"Chapter {number}: {draft.title}\n\n{draft_text(draft)}",
        output=EditorVerdict,
        chapter=number,
    )
    s = verdict.scores
    scores = [s.tone, s.clarity, s.grammar, s.jargon_free, s.flow, s.style_guide]
    must_fix = [i for i in verdict.issues if i.severity == "must_fix"]
    # Enforce the approval rule in code rather than trusting the flag alone.
    verdict.approved = verdict.approved and not must_fix and min(scores) >= 4
    emit(
        "review",
        (
            "Approved"
            if verdict.approved
            else f"Sent back: {len(must_fix)} must-fix, {len(verdict.issues) - len(must_fix)} polish"
        )
        + f" — {verdict.summary[:160]}",
        agent="editor",
        chapter=number,
        approved=verdict.approved,
        scores=s.model_dump(),
        issues=[i.model_dump() for i in verdict.issues],
    )
    return verdict
