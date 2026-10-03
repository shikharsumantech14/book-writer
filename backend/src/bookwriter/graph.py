"""The agent graph: a book graph that fans out to one chapter subgraph per chapter.

    planner -> (Send x N) chapter -> chief_editor -> assembler

    chapter: researcher -> writer -> lint -> editor -> fact_checker -> safety_net
             with send-back loops chosen by routers.py

Nodes are thin: they read typed state, call one agent or check, and write
their result back. Where work goes next is decided by routers.py, never by an
agent. Dependencies arrive as LangGraph runtime context (`Deps`).
"""

from __future__ import annotations

from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.runtime import Runtime, get_runtime
from langgraph.types import Send

from . import routers
from .agents.chief_editor import harmonize
from .agents.editor import review_chapter
from .agents.fact_checker import fact_check
from .agents.planner import plan_book
from .agents.researcher import missing_fact_needs, research_chapter
from .agents.writer import write_chapter
from .checks.lint import lint
from .checks.safety import apply_safety_net
from .events import emit
from .llm import BudgetExceeded, LLMError
from .models import (
    ChapterDraft,
    ChapterPlan,
    ChapterResult,
    EditorVerdict,
    Evidence,
    FactCheckReport,
    FactNeed,
    Outline,
)
from .render import book_html, book_markdown, finalize_chapter
from .state import BookState, ChapterInput, ChapterOutput, ChapterState, Deps, get

# ------------------------------------------------------------------ chapter nodes


def _plan(s: ChapterState) -> ChapterPlan:
    return ChapterPlan.model_validate(s["plan"])


def _outline(s: ChapterState) -> Outline:
    return Outline.model_validate(s["outline"])


def _evidence(s: ChapterState) -> list[Evidence]:
    return [Evidence.model_validate(e) for e in get(s, "evidence", [])]


def _draft(s: ChapterState) -> ChapterDraft:
    return ChapterDraft.model_validate(s["draft"])


async def researcher(s: ChapterState, runtime: Runtime[Deps]) -> dict:
    plan, gaps = _plan(s), get(s, "gaps", [])
    evidence = await research_chapter(runtime.context, plan, _outline(s), existing=_evidence(s), gaps=gaps or None)
    missing = missing_fact_needs(plan, evidence)
    if missing:
        emit(
            "coverage",
            f"No evidence for {len(missing)} of {len(plan.fact_needs)} planned questions; "
            "the Writer will write around them",
            agent="researcher",
            chapter=plan.number,
            missing=[f.question for f in missing],
        )
    return {
        "evidence": [e.model_dump() for e in evidence],
        "coverage": [f.model_dump() for f in missing],
        "gaps": [],
        "log": [{"node": "researcher", "mode": "gaps" if gaps else "initial", "evidence": len(evidence)}],
    }


async def writer(s: ChapterState, runtime: Runtime[Deps]) -> dict:
    passes = get(s, "writer_passes", 0) + 1
    previous = ChapterDraft.model_validate(s["draft"]) if s.get("draft") else None
    feedback = routers.writer_feedback(s) if previous else None
    draft = await write_chapter(
        runtime.context,
        _plan(s),
        _outline(s),
        _evidence(s),
        missing=[FactNeed.model_validate(f) for f in get(s, "coverage", [])],
        previous=previous,
        feedback=feedback,
        pass_no=passes,
    )
    update: dict = {
        "draft": draft.model_dump(),
        "writer_passes": passes,
        "feedback": feedback or {},
        "log": [{"node": "writer", "pass": passes, "for": feedback["from"] if feedback else None}],
    }
    if previous and get(s, "last_review") != "lint":
        update["lint_rounds"] = 0  # a reviewer's send-back opens a fresh lint budget
    return update


def lint_node(s: ChapterState, runtime: Runtime[Deps]) -> dict:
    n = s["number"]
    ids = {e["id"] for e in get(s, "evidence", [])}
    issues = lint(_draft(s), ids, runtime.context.cfg.brief)
    rounds = get(s, "lint_rounds", 0) + 1 if issues else 0
    emit(
        "review",
        "Lint passed" if not issues else f"Lint: {len(issues)} issue(s): " + "; ".join(i.rule for i in issues),
        agent="lint",
        chapter=n,
        approved=not issues,
        issues=[i.model_dump() for i in issues],
    )
    return {
        "lint_issues": [i.model_dump() for i in issues],
        "lint_rounds": rounds,
        "last_review": "lint",
        "log": [{"node": "lint", "issues": [i.rule for i in issues]}],
    }


async def editor(s: ChapterState, runtime: Runtime[Deps]) -> dict:
    previous = EditorVerdict.model_validate(s["editor_verdict"]) if s.get("editor_verdict") else None
    verdict = await review_chapter(runtime.context, s["number"], _outline(s), _draft(s), previous=previous)
    return {
        "editor_verdict": verdict.model_dump(),
        "editor_rounds": get(s, "editor_rounds", 0) + 1,
        "last_review": "editor",
        "log": [{"node": "editor", "approved": verdict.approved, "issues": len(verdict.issues)}],
    }


async def fact_checker(s: ChapterState, runtime: Runtime[Deps]) -> dict:
    report = await fact_check(runtime.context, s["number"], _draft(s), _evidence(s))
    data = report.model_dump()
    return {
        "fact_report": data,
        "fact_check_rounds": get(s, "fact_check_rounds", 0) + 1,
        "gaps": [] if report.passed else routers.gaps_from_report(data),
        "last_review": "fact_checker",
        "log": [{"node": "fact_checker", "passed": report.passed, "summary": report.summary}],
    }


def safety_net(s: ChapterState, runtime: Runtime[Deps]) -> dict:
    """Remove anything still unverified, then package the chapter result."""
    n, cfg = s["number"], runtime.context.cfg
    draft = _draft(s)
    report = FactCheckReport.model_validate(s["fact_report"])
    removed = []
    if not report.passed:
        draft, removed = apply_safety_net(draft, report)
        if removed:
            emit(
                "safety_net",
                f"Removed {len(removed)} unverified sentence(s)",
                agent="safety_net",
                chapter=n,
                removed=[c.model_dump() for c in removed],
            )
    evidence = _evidence(s)
    issues = lint(draft, {e.id for e in evidence}, cfg.brief)
    verdict = EditorVerdict.model_validate(s["editor_verdict"]) if s.get("editor_verdict") else None
    approved = bool(verdict and verdict.approved)

    warnings = []
    if not approved:
        warnings.append("The Editor did not approve the final draft (send-back budget spent).")
    if not report.passed:
        warnings.append(f"Fact-check budget spent; the safety net removed {len(removed)} unverified sentence(s).")
    warnings += [f"Lint ({i.rule}): {i.detail}" for i in issues]

    result = ChapterResult(
        number=n,
        status="shipped_with_warnings" if warnings else "ok",
        draft=draft,
        evidence=evidence,
        missing_fact_needs=[FactNeed.model_validate(f) for f in get(s, "coverage", [])],
        editor_verdict=verdict,
        editor_approved=approved,
        fact_report=report,
        removed_sentences=removed,
        lint_issues=issues,
        rounds={k: get(s, k, 0) for k in ("writer_passes", "editor_rounds", "fact_check_rounds")},
        warnings=warnings,
        log=get(s, "log", []),
    )
    emit(
        "chapter_done",
        f"Chapter {n} done ({result.status.replace('_', ' ')}) after {result.rounds['writer_passes']} writer pass(es)",
        agent="safety_net",
        chapter=n,
        status=result.status,
        warnings=warnings,
    )
    return {"chapters": {str(n): result.model_dump()}}


def _limits():
    return get_runtime(Deps).context.cfg.limits


def build_chapter_graph() -> CompiledStateGraph:
    g = StateGraph(ChapterState, context_schema=Deps, input_schema=ChapterInput, output_schema=ChapterOutput)
    g.add_node("researcher", researcher)
    g.add_node("writer", writer)
    g.add_node("lint", lint_node)
    g.add_node("editor", editor)
    g.add_node("fact_checker", fact_checker)
    g.add_node("safety_net", safety_net)

    g.add_edge(START, "researcher")
    g.add_edge("researcher", "writer")
    g.add_edge("writer", "lint")
    g.add_conditional_edges("lint", lambda s: routers.after_lint(s, _limits()), ["writer", "editor", "fact_checker"])
    g.add_conditional_edges("editor", lambda s: routers.after_edit(s, _limits()), ["writer", "fact_checker"])
    g.add_conditional_edges(
        "fact_checker", lambda s: routers.after_fact_check(s, _limits()), ["writer", "researcher", "safety_net"]
    )
    g.add_edge("safety_net", END)
    return g.compile(name="chapter")


# --------------------------------------------------------------------- book nodes


async def planner(s: BookState, runtime: Runtime[Deps]) -> dict:
    deps = runtime.context
    outline = await plan_book(deps.cfg, deps.llm)
    return {"outline": outline.model_dump()}


def fan_out(s: BookState) -> list[Send]:
    """One chapter subgraph per chapter, run in parallel (bounded by `parallel_chapters`)."""
    outline = s["outline"]
    count = get(s, "chapters_to_write", len(outline["chapters"]))
    return [
        Send("chapter", {"number": ch["number"], "plan": ch, "outline": outline}) for ch in outline["chapters"][:count]
    ]


async def chief_editor(s: BookState, runtime: Runtime[Deps]) -> dict:
    deps = runtime.context
    results = {int(k): ChapterResult.model_validate(v) for k, v in s["chapters"].items()}
    drafts = {n: r.draft for n, r in results.items()}
    ids = {n: {e.id for e in r.evidence} for n, r in results.items()}
    try:
        edited, report = await harmonize(deps, Outline.model_validate(s["outline"]), drafts, ids)
    except BudgetExceeded:
        raise
    except LLMError as e:  # the chapters are already reviewed; ship them unharmonised rather than fail
        emit("warning", f"Chief Editor skipped: {e}", agent="chief_editor")
        edited, report = drafts, {"notes": [], "applied": [], "rejected": [], "error": str(e)}
    changed = {
        str(n): {**results[n].model_dump(), "draft": edited[n].model_dump()} for n in results if edited[n] != drafts[n]
    }
    return {"chief_report": report, "chapters": changed}


def assembler(s: BookState, runtime: Runtime[Deps]) -> dict:
    deps = runtime.context
    outline = Outline.model_validate(s["outline"])
    finals = []
    for key in sorted(s["chapters"], key=int):
        r = ChapterResult.model_validate(s["chapters"][key])
        removed_ids = {c.sentence_id for c in r.removed_sentences}
        checks = [c for c in (r.fact_report.checks if r.fact_report else []) if c.sentence_id not in removed_ids]
        stats = {
            "status": r.status,
            "warnings": r.warnings,
            "rounds": r.rounds,
            "editor_approved": r.editor_approved,
            "editor_scores": r.editor_verdict.scores.model_dump() if r.editor_verdict else None,
            "fact_check": r.fact_report.summary if r.fact_report else None,
            "fact_check_passed": bool(r.fact_report and r.fact_report.passed),
            "links": [lk.model_dump() for lk in r.fact_report.links] if r.fact_report else [],
            "removed_sentences": [c.sentence for c in r.removed_sentences],
            "missing_fact_needs": [f.question for f in r.missing_fact_needs],
        }
        finals.append(finalize_chapter(r.number, r.draft, r.evidence, checks, stats))

    md = book_markdown(outline.book_title, finals)
    deps.run_dir.mkdir(parents=True, exist_ok=True)
    (deps.run_dir / "book.md").write_text(md, encoding="utf-8")
    (deps.run_dir / "book.html").write_text(book_html(outline.book_title, finals), encoding="utf-8")
    emit(
        "book_ready",
        f"Book assembled: {len(finals)} chapter(s), {sum(c.word_count for c in finals)} words",
        agent="assembler",
    )
    return {"final_chapters": [c.model_dump() for c in finals], "book_markdown": md}


def build_graph() -> CompiledStateGraph:
    g = StateGraph(BookState, context_schema=Deps)
    g.add_node("planner", planner)
    g.add_node("chapter", build_chapter_graph())
    g.add_node("chief_editor", chief_editor)
    g.add_node("assembler", assembler)

    g.add_edge(START, "planner")
    g.add_conditional_edges("planner", fan_out, ["chapter"])
    g.add_edge("chapter", "chief_editor")
    g.add_edge("chief_editor", "assembler")
    g.add_edge("assembler", END)
    return g.compile(name="book")


def mermaid() -> str:
    """The architecture diagram, generated from the graph itself."""
    return build_graph().get_graph(xray=True).draw_mermaid()
