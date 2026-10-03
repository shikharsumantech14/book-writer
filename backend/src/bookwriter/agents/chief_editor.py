"""Chief editor: a whole-book consistency pass with guarded, exact-match edits.

The model proposes find/replace edits; code applies them only if they keep the
chapter's citations and figures intact and add no new lint issues.
"""

from __future__ import annotations

import re
from collections import Counter

from ..checks.lint import CITE, lint
from ..events import emit
from ..models import ChapterDraft, ChiefEdit, ChiefEditorReport, Outline
from ..prompts import render
from ..state import Deps
from .writer import draft_text, style_guide_text


def _figures(text: str) -> Counter:
    return Counter(re.findall(r"\d[\d,.]*", text))


def _lint_keys(draft: ChapterDraft, evidence_ids: set[str], brief) -> set[tuple[str, str]]:
    # Word-count details change with every edit; compare the length rule by name only.
    return {(i.rule, "" if i.rule == "length" else i.detail) for i in lint(draft, evidence_ids, brief)}


def guarded_apply(
    draft: ChapterDraft, edit: ChiefEdit, evidence_ids: set[str], brief
) -> tuple[ChapterDraft | None, str]:
    """Apply one edit if it passes every guard: unique text, same citations, same figures,
    and no lint issue the chapter didn't already have."""
    new, why = apply_edit(draft, edit)
    if new is None:
        return None, why
    if _lint_keys(new, evidence_ids, brief) - _lint_keys(draft, evidence_ids, brief):
        return None, "edit would introduce a lint issue"
    return new, "applied"


def apply_edit(draft: ChapterDraft, edit: ChiefEdit) -> tuple[ChapterDraft | None, str]:
    fields = [*draft.paragraphs, draft.takeaway]
    hits = [i for i, f in enumerate(fields) if edit.find and edit.find in f]
    if len(hits) != 1 or fields[hits[0]].count(edit.find) != 1:
        return None, "find text is missing or not unique"
    if Counter(CITE.findall(edit.find)) != Counter(CITE.findall(edit.replace)):
        return None, "edit would change citation markers"
    if _figures(edit.find) != _figures(edit.replace):
        return None, "edit would change figures"
    i = hits[0]
    fields[i] = fields[i].replace(edit.find, edit.replace)
    return ChapterDraft(title=draft.title, paragraphs=fields[:-1], takeaway=fields[-1]), "applied"


async def harmonize(
    deps: Deps, outline: Outline, drafts: dict[int, ChapterDraft], evidence_ids: dict[int, set[str]]
) -> tuple[dict[int, ChapterDraft], dict]:
    emit("agent_start", "Reading the whole book for one consistent voice", agent="chief_editor")
    book = "\n\n".join(f"=== Chapter {n}: {d.title} ===\n{draft_text(d)}" for n, d in sorted(drafts.items()))
    report = await deps.llm.structured(
        "chief_editor",
        system=render("chief_editor", style_guide=style_guide_text(outline)),
        user=book,
        output=ChiefEditorReport,
    )
    out = dict(drafts)
    applied, rejected = [], []
    for edit in report.edits[:8]:
        if edit.chapter not in out:
            rejected.append({**edit.model_dump(), "why": "unknown chapter"})
            continue
        new, why = guarded_apply(out[edit.chapter], edit, evidence_ids[edit.chapter], deps.cfg.brief)
        if new is None:
            rejected.append({**edit.model_dump(), "why": why})
            continue
        out[edit.chapter] = new
        applied.append(edit.model_dump())
    emit(
        "review",
        f"{len(applied)} consistency edits applied, {len(rejected)} rejected by guards",
        agent="chief_editor",
        notes=report.consistency_notes,
        applied=applied,
        rejected=rejected,
    )
    return out, {"notes": report.consistency_notes, "applied": applied, "rejected": rejected}
