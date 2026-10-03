"""Deterministic chapter checks. No LLM: rules that code can guarantee are
enforced by code, so the LLM reviewers can spend their attention on judgement."""

from __future__ import annotations

import re

from ..config import Brief
from ..models import ChapterDraft, LintIssue

CITE = re.compile(r"\[(E\d+)\]")
ANY_BRACKET = re.compile(r"\[[^\]]*\]")
LIST_MARKER = re.compile(r"^\s*([-*•▪◦]|\d+[.)]|[a-z][.)])\s+", re.M)
URL = re.compile(r"https?://|www\.", re.I)
CITE_AFTER_STOP = re.compile(r"[.!?]\s*\[E\d+\]")
_SENT_SPLIT = re.compile(r"(?<=[.!?])[\"”’)]?\s+(?=[A-Z\"“‘(₹0-9])")


def strip_citations(text: str) -> str:
    return re.sub(r"\s*\[E\d+\]", "", text)


def word_count(draft: ChapterDraft) -> int:
    body = " ".join(draft.paragraphs + [draft.takeaway])
    return len(strip_citations(body).split())


def split_sentences(paragraphs: list[str]) -> list[tuple[int, int, str]]:
    """Return (sentence_id, paragraph_index, sentence) for every sentence."""
    out, sid = [], 0
    for pi, p in enumerate(paragraphs):
        for s in _SENT_SPLIT.split(p.strip()):
            if s.strip():
                out.append((sid, pi, s.strip()))
                sid += 1
    return out


def cited_ids(text: str) -> list[str]:
    return CITE.findall(text)


def lint(draft: ChapterDraft, evidence_ids: set[str], brief: Brief) -> list[LintIssue]:
    issues: list[LintIssue] = []

    def add(rule: str, detail: str) -> None:
        issues.append(LintIssue(rule=rule, detail=detail))

    n = word_count(draft)
    if not brief.words_min <= n <= brief.words_max:
        direction = "Cut" if n > brief.words_max else "Add"
        add(
            "length",
            f"Chapter has {n} words; it must be {brief.words_min}-{brief.words_max}. {direction} about "
            f"{abs(n - (brief.words_min + brief.words_max) // 2)} words.",
        )

    if len(draft.paragraphs) < 4:
        add("structure", f"Only {len(draft.paragraphs)} paragraphs; write 6-10 flowing paragraphs.")

    for i, p in enumerate(draft.paragraphs, 1):
        if LIST_MARKER.search(p) or "\n" in p.strip():
            add("no_lists", f"Paragraph {i} contains a list or line breaks; rewrite as flowing prose.")
        if p.lstrip().startswith("#") or "**" in p or "__" in p:
            add("no_headings", f"Paragraph {i} contains heading or bold markup; use plain prose.")
        if URL.search(p):
            add("no_urls", f"Paragraph {i} contains a URL; links belong only in the reference list.")
        for b in ANY_BRACKET.findall(p):
            if not CITE.fullmatch(b):
                add("citation_format", f"Paragraph {i} has '{b}'. Cite as separate markers like [E1][E2].")
        if CITE_AFTER_STOP.search(p):
            add(
                "citation_placement",
                f"Paragraph {i} has a citation after the full stop; put it before: '... 2016 [E2].'",
            )
        if p.strip().lower().startswith("takeaway:"):
            add("takeaway", "The takeaway must be only in the `takeaway` field, not in the paragraphs.")

    t = draft.takeaway.strip()
    if not t.startswith("Takeaway:"):
        add("takeaway", "The takeaway must be one sentence starting with 'Takeaway:'.")
    if "\n" in t or len(_SENT_SPLIT.split(t)) > 2:
        add("takeaway", "The takeaway must be a single line (one sentence).")
    if CITE.search(t) or re.search(r"\d", t):
        add("takeaway", "The takeaway must not contain citations or figures; it is advice, not a fact.")

    used = {c for p in draft.paragraphs for c in cited_ids(p)}
    unknown = sorted(used - evidence_ids, key=lambda x: int(x[1:]))
    if unknown:
        add("unknown_citation", f"Citations {', '.join(unknown)} are not in the evidence pack. Use only existing ids.")
    if len(used & evidence_ids) < 3:
        add("too_few_citations", "Use at least 3 different pieces of evidence from the pack.")

    for _sid, pi, s in split_sentences(draft.paragraphs):
        if re.search(r"\d", strip_citations(s)) and not CITE.search(s):
            add(
                "uncited_figure",
                f'Paragraph {pi + 1}: "{_short(s)}" contains a number but no citation. '
                "Cite it from the pack or remove the figure.",
            )

    return issues


def _short(s: str, n: int = 90) -> str:
    return s if len(s) <= n else s[: n - 1] + "…"
