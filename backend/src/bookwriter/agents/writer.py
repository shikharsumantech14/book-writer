"""Writer: chapter plan + style guide + evidence pack -> chapter draft.

The writer only ever sees evidence ids, claims and quotes, never URLs, so it
cannot invent or garble a link. Revisions get the previous draft plus the
exact, structured feedback that caused the send-back.
"""

from __future__ import annotations

import json

from ..events import emit
from ..models import ChapterDraft, ChapterPlan, Evidence, Outline
from ..prompts import render
from ..state import Deps


def format_evidence(evidence: list[Evidence]) -> str:
    lines = []
    for e in evidence:
        when = f", published {e.published}" if e.published else ""
        lines.append(f'[{e.id}] ({e.source_type}: {e.source_name}{when})\n  claim: {e.claim}\n  quote: "{e.quote}"')
    return "\n".join(lines) or "(no evidence found; write general guidance with no facts or figures)"


def style_guide_text(outline: Outline) -> str:
    sg = outline.style_guide
    return (
        f"Reader: {sg.reader_persona}\nVoice: {sg.voice}\n"
        f"Do: {'; '.join(sg.do)}\nDon't: {'; '.join(sg.dont)}\n"
        f"Sample paragraph (voice only, no facts):\n{sg.sample_paragraph}"
    )


def chapter_terms(outline: Outline, number: int) -> tuple[str, str]:
    new = [g for g in outline.style_guide.glossary if g.introduced_in_chapter == number]
    known = [g for g in outline.style_guide.glossary if g.introduced_in_chapter < number]
    fmt = lambda gs: "\n".join(f"- {g.term}: {g.plain_explanation}" for g in gs) or "(none)"  # noqa: E731
    return fmt(new), fmt(known)


def draft_text(draft: ChapterDraft) -> str:
    return "\n\n".join(draft.paragraphs + [draft.takeaway])


async def write_chapter(
    deps: Deps,
    plan: ChapterPlan,
    outline: Outline,
    evidence: list[Evidence],
    *,
    previous: ChapterDraft | None = None,
    feedback: dict | None = None,
    pass_no: int = 1,
) -> ChapterDraft:
    b = deps.cfg.brief
    new_terms, known_terms = chapter_terms(outline, plan.number)
    revision = ""
    if previous and feedback:
        items = "\n".join(f"- {i}" for i in feedback["items"])
        revision = (
            f"\n<revision>\nThis is revision pass {pass_no}. Your previous draft was sent back by the "
            f"{feedback['from']}. Fix every issue below. Keep what already works; change only what is needed. "
            f"Keep each citation attached to the claim it supports.\n\nIssues:\n{items}\n\n"
            f"Previous draft:\n{json.dumps(previous.model_dump(), ensure_ascii=False, indent=1)}\n</revision>"
        )
    plan_view = plan.model_dump(exclude={"fact_needs"})
    system = render(
        "writer",
        book_title=outline.book_title,
        audience=b.audience,
        tone=b.tone,
        style_guide=style_guide_text(outline),
        chapter_plan=json.dumps(plan_view, ensure_ascii=False, indent=1),
        new_terms=new_terms,
        known_terms=known_terms,
        evidence=format_evidence(evidence),
        words_min=b.words_min,
        words_max=b.words_max,
        words_target=(b.words_min + b.words_max) // 2,
        revision=revision,
    )
    emit(
        "agent_start",
        f"Writing draft (pass {pass_no})"
        if pass_no == 1
        else f"Revising for the {feedback['from'] if feedback else 'reviewers'} (pass {pass_no})",
        agent="writer",
        chapter=plan.number,
    )
    draft = await deps.llm.structured(
        "writer",
        system=system,
        user="Write the chapter now." if not revision else "Revise the chapter now.",
        output=ChapterDraft,
        chapter=plan.number,
    )
    draft.paragraphs = [p.strip() for p in draft.paragraphs if p.strip()]
    return draft
