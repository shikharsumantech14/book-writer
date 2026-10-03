"""Routers and stop conditions (docs/PLAN.md section 4.4), plus the safety net."""

from __future__ import annotations

import pytest

from bookwriter import routers
from bookwriter.checks.safety import apply_safety_net
from bookwriter.config import Limits
from bookwriter.models import ChapterDraft, ClaimCheck, FactCheckReport

L = Limits(lint_rounds=3, editor_rounds=2, fact_check_rounds=2, max_writer_passes=7)
LINT_ISSUE = {"rule": "length", "detail": "Too short."}


def state(**kw):
    return {"writer_passes": 1, **kw}


# ------------------------------------------------------------------ after lint


def test_lint_failure_goes_back_to_writer_until_budget_spent():
    assert routers.after_lint(state(lint_issues=[LINT_ISSUE], lint_rounds=1), L) == "writer"
    assert routers.after_lint(state(lint_issues=[LINT_ISSUE], lint_rounds=3), L) == "writer"
    # fourth failure in a row: proceed to the Editor with the issues riding along
    assert routers.after_lint(state(lint_issues=[LINT_ISSUE], lint_rounds=4), L) == "editor"


def test_lint_pass_goes_to_editor_then_skips_it_once_editing_is_done():
    assert routers.after_lint(state(lint_issues=[]), L) == "editor"
    approved = {"approved": True}
    assert routers.after_lint(state(lint_issues=[], editor_verdict=approved), L) == "fact_checker"
    assert routers.after_lint(state(lint_issues=[], editor_rounds=3), L) == "fact_checker"


def test_writer_budget_spent_stops_rewrites():
    s = state(writer_passes=7, lint_issues=[LINT_ISSUE], lint_rounds=1)
    assert routers.after_lint(s, L) == "fact_checker"  # no rewrite possible, and no point asking the Editor


# ------------------------------------------------------------------ after editor


@pytest.mark.parametrize(
    ("rounds", "approved", "expected"),
    [(1, False, "writer"), (2, False, "writer"), (3, False, "fact_checker"), (1, True, "fact_checker")],
)
def test_editor_send_backs_are_bounded(rounds, approved, expected):
    s = state(editor_rounds=rounds, editor_verdict={"approved": approved})
    assert routers.after_edit(s, L) == expected


def test_editor_cannot_send_back_without_writer_passes_left():
    s = state(writer_passes=7, editor_rounds=1, editor_verdict={"approved": False})
    assert routers.after_edit(s, L) == "fact_checker"


# ------------------------------------------------------------------ after fact-check


def test_fact_check_routes():
    failed = {"passed": False}
    assert routers.after_fact_check(state(fact_report={"passed": True}, fact_check_rounds=1), L) == "safety_net"
    assert routers.after_fact_check(state(fact_report=failed, fact_check_rounds=1), L) == "writer"
    assert routers.after_fact_check(state(fact_report=failed, fact_check_rounds=1, gaps=["x"]), L) == "researcher"
    assert routers.after_fact_check(state(fact_report=failed, fact_check_rounds=2), L) == "writer"
    assert routers.after_fact_check(state(fact_report=failed, fact_check_rounds=3), L) == "safety_net"
    assert routers.after_fact_check(state(fact_report=failed, fact_check_rounds=1, writer_passes=7), L) == "safety_net"


def test_gaps_only_for_claims_needing_new_sources():
    report = {
        "checks": [
            {"sentence": "A.", "verdict": "UNSUPPORTED", "reason": "no source", "needs_new_source": True},
            {"sentence": "B.", "verdict": "PARTIAL", "reason": "too strong", "needs_new_source": False},
            {"sentence": "C.", "verdict": "SUPPORTED", "reason": "", "needs_new_source": True},
        ]
    }
    assert routers.gaps_from_report(report) == ['"A." (no source)']


# ------------------------------------------------------------------ feedback


def test_feedback_from_each_reviewer_carries_leftover_lint_issues():
    lint_fb = routers.writer_feedback(state(last_review="lint", lint_issues=[LINT_ISSUE]))
    assert lint_fb == {"from": "lint checks", "items": ["Too short."]}

    verdict = {"issues": [{"severity": "must_fix", "quote": "q", "problem": "p", "fix": "f"}]}
    ed = routers.writer_feedback(state(last_review="editor", editor_verdict=verdict, lint_issues=[LINT_ISSUE]))
    assert ed["from"] == "Editor"
    assert ed["items"] == ['[must_fix] "q": p Fix: f', "[should_fix] Too short."]

    report = {
        "checks": [
            {"sentence": "S.", "verdict": "PARTIAL", "reason": "r", "fix_hint": "h"},
            {"sentence": "T.", "verdict": "SUPPORTED"},
        ],
        "links": [{"url": "https://dead.example", "ok": False}],
    }
    fc = routers.writer_feedback(state(last_review="fact_checker", fact_report=report))
    assert fc["from"] == "Fact-checker"
    assert fc["items"][0] == '[PARTIAL] "S.": r Fix: h'
    assert "https://dead.example" in fc["items"][1]


# ------------------------------------------------------------------ safety net


def check(sid: int, sentence: str, verdict: str) -> ClaimCheck:
    return ClaimCheck(sentence_id=sid, sentence=sentence, cited=[], verdict=verdict)


def test_safety_net_removes_unverified_sentences_only():
    draft = ChapterDraft(
        title="T",
        paragraphs=["Good claim [E1]. Partial claim [E2].", "Uncited figure of 5 shops. Uncited advice.", "Bad [E3]."],
        takeaway="Takeaway: keep going.",
    )
    report = FactCheckReport(
        passed=False,
        checks=[
            check(0, "Good claim [E1].", "SUPPORTED"),
            check(1, "Partial claim [E2].", "PARTIAL"),
            check(2, "Uncited figure of 5 shops.", "UNCITED"),
            check(3, "Uncited advice.", "UNCITED"),
            check(4, "Bad [E3].", "UNSUPPORTED"),
        ],
        links=[],
        summary="",
    )
    new, removed = apply_safety_net(draft, report)
    assert new.paragraphs == ["Good claim [E1].", "Uncited advice."]
    assert [c.sentence_id for c in removed] == [1, 2, 4]
    assert new.takeaway == draft.takeaway


def test_safety_net_is_a_no_op_on_a_clean_report():
    draft = ChapterDraft(title="T", paragraphs=["Fine [E1]."], takeaway="Takeaway: ok.")
    report = FactCheckReport(passed=True, checks=[check(0, "Fine [E1].", "SUPPORTED")], links=[], summary="")
    assert apply_safety_net(draft, report) == (draft, [])
