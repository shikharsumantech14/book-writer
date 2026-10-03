"""Routing for the chapter subgraph: plain Python over the chapter state.

Agents never decide where work goes next. Each review node records its result;
these functions read the results and the round counters and pick the next node.
Every loop is bounded (docs/PLAN.md section 4.4):

| Loop                          | Budget (config.yaml limits) | When exhausted                              |
|-------------------------------|-----------------------------|---------------------------------------------|
| Lint -> Writer                | lint_rounds in a row        | go on; remaining issues ride along as        |
|                               |                             | should-fix feedback on the next send-back    |
| Editor -> Writer              | editor_rounds send-backs    | go to the Fact-checker, not approved         |
| Fact-checker -> Writer/Rsrch  | fact_check_rounds           | the safety net runs                          |
| Writer passes in total        | max_writer_passes           | no more rewrites: fact-check, then safety net|
"""

from __future__ import annotations

from typing import Literal

from .config import Limits
from .state import ChapterState, get

AfterLint = Literal["writer", "editor", "fact_checker"]
AfterEdit = Literal["writer", "fact_checker"]
AfterFactCheck = Literal["writer", "researcher", "safety_net"]


def writer_budget_spent(s: ChapterState, limits: Limits) -> bool:
    return get(s, "writer_passes", 0) >= limits.max_writer_passes


def editor_done(s: ChapterState, limits: Limits) -> bool:
    """The editorial phase is over: approved, or out of send-backs."""
    verdict = get(s, "editor_verdict", {})
    return bool(verdict.get("approved")) or get(s, "editor_rounds", 0) > limits.editor_rounds


def after_lint(s: ChapterState, limits: Limits) -> AfterLint:
    if get(s, "lint_issues") and get(s, "lint_rounds", 0) <= limits.lint_rounds and not writer_budget_spent(s, limits):
        return "writer"
    # Lint passed, or its budget is spent. A rewrite the Fact-checker asked for skips the
    # Editor (it already signed off); with no rewrites left, the Editor's notes can't be used.
    if editor_done(s, limits) or writer_budget_spent(s, limits):
        return "fact_checker"
    return "editor"


def after_edit(s: ChapterState, limits: Limits) -> AfterEdit:
    if editor_done(s, limits) or writer_budget_spent(s, limits):
        return "fact_checker"
    return "writer"


def after_fact_check(s: ChapterState, limits: Limits) -> AfterFactCheck:
    report = get(s, "fact_report", {})
    if report.get("passed") or get(s, "fact_check_rounds", 0) > limits.fact_check_rounds:
        return "safety_net"
    if writer_budget_spent(s, limits):
        return "safety_net"
    return "researcher" if get(s, "gaps") else "writer"


def gaps_from_report(report: dict) -> list[str]:
    """Claims the Fact-checker says no evidence in the pack can support."""
    return [
        f'"{c["sentence"]}" ({c.get("reason", "").strip()})'
        for c in report.get("checks", [])
        if c.get("needs_new_source") and c["verdict"] != "SUPPORTED"
    ]


def writer_feedback(s: ChapterState) -> dict:
    """What the Writer must fix, from whoever sent the draft back."""
    who = get(s, "last_review", "")
    lint_items = [i["detail"] for i in get(s, "lint_issues", [])]
    if who == "lint":
        return {"from": "lint checks", "items": lint_items}

    items: list[str] = []
    if who == "editor":
        for i in get(s, "editor_verdict", {}).get("issues", []):
            items.append(f'[{i["severity"]}] "{i["quote"]}": {i["problem"]} Fix: {i["fix"]}')
        source = "Editor"
    elif who == "fact_checker":
        for c in get(s, "fact_report", {}).get("checks", []):
            if c["verdict"] == "SUPPORTED":
                continue
            hint = f" Fix: {c['fix_hint']}" if c.get("fix_hint") else ""
            items.append(f'[{c["verdict"]}] "{c["sentence"]}": {c.get("reason", "")}{hint}')
        for lk in get(s, "fact_report", {}).get("links", []):
            if not lk.get("ok"):
                items.append(f"Source link is broken: {lk['url']}. Do not cite evidence from it.")
        source = "Fact-checker"
    else:
        return {"from": "reviewers", "items": lint_items}
    # Lint issues left over when the lint budget ran out travel with the next send-back.
    items += [f"[should_fix] {d}" for d in lint_items]
    return {"from": source, "items": items}
