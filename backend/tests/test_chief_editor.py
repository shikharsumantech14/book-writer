"""Chief Editor guards: an edit applies only if it is exact, unique and changes no facts."""

from __future__ import annotations

from fakes import make_draft

from bookwriter.agents.chief_editor import apply_edit, guarded_apply
from bookwriter.models import ChapterDraft, ChiefEdit

IDS = {"E1", "E2", "E3", "E4", "E5", "E6"}


def edit(find: str, replace: str) -> ChiefEdit:
    return ChiefEdit(chapter=1, find=find, replace=replace, reason="test")


def test_applies_unique_wording_change():
    draft = make_draft(1, sorted(IDS))
    new, why = apply_edit(draft, edit("Picture a quiet morning", "Imagine a quiet morning"))
    assert why == "applied"
    assert new.paragraphs[0].startswith("Imagine a quiet morning")
    assert new.paragraphs[1:] == draft.paragraphs[1:]


def test_rejects_missing_or_repeated_text():
    draft = make_draft(1, sorted(IDS))
    assert apply_edit(draft, edit("not in the chapter", "x"))[1] == "find text is missing or not unique"
    assert apply_edit(draft, edit("Here is another part", "x"))[1] == "find text is missing or not unique"


def test_rejects_citation_and_figure_changes():
    draft = ChapterDraft(title="T", paragraphs=["UPI started in 2016 [E1]. It grew."], takeaway="Takeaway: go.")
    assert apply_edit(draft, edit("2016 [E1]", "2016 [E2]"))[1] == "edit would change citation markers"
    assert apply_edit(draft, edit("2016 [E1]", "[E1]"))[1] == "edit would change figures"
    assert apply_edit(draft, edit("started in 2016", "began in 2017"))[1] == "edit would change figures"


def test_can_edit_the_takeaway():
    draft = make_draft(1, sorted(IDS))
    new, why = apply_edit(draft, edit("Start small, stay patient", "Start small and stay patient"))
    assert why == "applied" and new.takeaway.startswith("Takeaway: Start small and stay patient")


def test_rejects_edits_that_add_lint_issues(cfg):
    draft = make_draft(1, sorted(IDS))
    new, why = guarded_apply(draft, edit("Picture a quiet morning", "## Picture a quiet morning"), IDS, cfg.brief)
    assert new is None and why == "edit would introduce a lint issue"


def test_existing_lint_issues_do_not_block_harmless_edits(cfg):
    short = make_draft(1, sorted(IDS), paragraphs=3)  # already too short: length + structure issues
    new, why = guarded_apply(short, edit("Picture a quiet morning", "Imagine a quiet morning"), IDS, cfg.brief)
    assert why == "applied" and new is not None
