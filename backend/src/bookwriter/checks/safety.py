"""Safety net (code): the last line of defence before a chapter ships.

When the fact-check budget runs out, any sentence still judged UNSUPPORTED or
PARTIAL, or UNCITED while stating a figure, is removed. We never ship an
unverified fact; the report lists every removal.
"""

from __future__ import annotations

from ..models import ChapterDraft, ClaimCheck, FactCheckReport
from .lint import has_figure, split_sentences


def must_remove(check: ClaimCheck) -> bool:
    if check.verdict in ("UNSUPPORTED", "PARTIAL"):
        return True
    return check.verdict == "UNCITED" and has_figure(check.sentence)


def apply_safety_net(draft: ChapterDraft, report: FactCheckReport) -> tuple[ChapterDraft, list[ClaimCheck]]:
    """Return the draft without unverified sentences, and the checks that caused each removal.

    Sentence ids come from the same `split_sentences` the Fact-checker used on this draft.
    """
    doomed = {c.sentence_id: c for c in report.checks if must_remove(c)}
    if not doomed:
        return draft, []
    kept: dict[int, list[str]] = {}
    for sid, pi, sentence in split_sentences(draft.paragraphs):
        if sid not in doomed:
            kept.setdefault(pi, []).append(sentence)
    paragraphs = [" ".join(kept[pi]) for pi in sorted(kept)]
    return ChapterDraft(title=draft.title, paragraphs=paragraphs, takeaway=draft.takeaway), list(doomed.values())
