"""The system grades its own output against the brief.

Hard checks are the brief's rules; any failure fails the scorecard. Metrics
(official-source share, editor scores, revision rounds) are reported but do
not fail it. Works on rendered chapters alone, so it can grade a committed
sample book in CI as well as a fresh run.
"""

from __future__ import annotations

import re

from .checks.lint import LIST_MARKER, URL, has_figure, split_sentences
from .config import Brief
from .models import FinalChapter
from .render import chapter_markdown

NUM_CITE = re.compile(r"\[(\d+)\]")


def _check(rule: str, passed: bool, detail: str = "") -> dict:
    return {"rule": rule, "passed": bool(passed), "detail": detail}


def grade_chapter(ch: FinalChapter, brief: Brief) -> dict:
    checks: list[dict] = []
    body = "\n\n".join(ch.paragraphs)

    checks.append(
        _check(
            "word_count",
            brief.words_min <= ch.word_count <= brief.words_max,
            f"{ch.word_count} words (brief: {brief.words_min}-{brief.words_max})",
        )
    )
    bad_format = [
        i + 1
        for i, p in enumerate(ch.paragraphs)
        if LIST_MARKER.search(p) or p.lstrip().startswith("#") or "**" in p or "\n" in p.strip()
    ]
    checks.append(_check("flowing_prose", not bad_format, f"list/heading markup in paragraphs {bad_format}"))
    checks.append(_check("no_urls_in_text", not URL.search(body), "links belong only in the reference list"))

    t = ch.takeaway.strip()
    md = chapter_markdown(ch)
    takeaway_ok = (
        t.startswith("Takeaway:")
        and "\n" not in t
        and not NUM_CITE.search(t)
        and md.index(t) < md.index("### References")
    )
    checks.append(_check("takeaway_line", takeaway_ok, "one line starting 'Takeaway:', before the references"))

    cited = {int(n) for n in NUM_CITE.findall(body)}
    numbers = {r.number for r in ch.references}
    checks.append(
        _check(
            "citations_resolve",
            cited == numbers and numbers == set(range(1, len(numbers) + 1)),
            f"cited {sorted(cited)}; references {sorted(numbers)}",
        )
    )
    complete = all(r.source_name.strip() and r.title.strip() and r.url.startswith("http") for r in ch.references)
    checks.append(_check("reference_format", complete and bool(ch.references), "source name, title and link"))

    uncited = [s for _, _, s in split_sentences(ch.paragraphs) if has_figure(s) and not NUM_CITE.search(s)]
    checks.append(_check("figures_cited", not uncited, f"{len(uncited)} sentence(s) with a figure but no citation"))

    verdicts = [c.verdict for c in ch.claim_checks]
    unverified = [c for c in ch.claim_checks if c.verdict in ("UNSUPPORTED", "PARTIAL")]
    checks.append(_check("claims_supported", not unverified, f"{len(unverified)} claim(s) not fully supported"))

    links = {lk["url"]: lk for lk in ch.stats.get("links", [])}
    ref_links = [links.get(r.url) for r in ch.references]
    broken = [r.url for r, lk in zip(ch.references, ref_links, strict=True) if lk is not None and not lk["ok"]]
    unchecked = [r.url for r, lk in zip(ch.references, ref_links, strict=True) if lk is None]
    checks.append(
        _check("links_working", not broken, f"{len(broken)} broken, {len(unchecked)} not checked by the Fact-checker")
    )

    official = sum(r.source_type == "official" for r in ch.references)
    metrics = {
        "word_count": ch.word_count,
        "references": len(ch.references),
        "official_sources": official,
        "official_share": round(official / len(ch.references), 2) if ch.references else 0.0,
        "claims_checked": len(verdicts),
        "claims_supported": verdicts.count("SUPPORTED"),
        "editor_approved": ch.stats.get("editor_approved"),
        "editor_scores": ch.stats.get("editor_scores"),
        "rounds": ch.stats.get("rounds"),
        "removed_sentences": len(ch.stats.get("removed_sentences", [])),
        "status": ch.stats.get("status"),
    }
    return {
        "number": ch.number,
        "title": ch.title,
        "passed": all(c["passed"] for c in checks),
        "checks": checks,
        "metrics": metrics,
        "warnings": ch.stats.get("warnings", []),
    }


def grade(chapters: list[FinalChapter], brief: Brief, *, expected_chapters: int | None = None) -> dict:
    expected = expected_chapters or brief.chapters
    graded = [grade_chapter(c, brief) for c in chapters]
    book_checks = [
        _check("chapter_count", len(chapters) == expected, f"{len(chapters)} of {expected} chapters"),
    ]
    refs = [r for c in chapters for r in c.references]
    return {
        "passed": all(c["passed"] for c in book_checks) and all(g["passed"] for g in graded),
        "partial_run": expected < brief.chapters,
        "book": {
            "checks": book_checks,
            "metrics": {
                "words": sum(c.word_count for c in chapters),
                "references": len(refs),
                "official_share": round(sum(r.source_type == "official" for r in refs) / len(refs), 2) if refs else 0.0,
            },
        },
        "chapters": graded,
    }
