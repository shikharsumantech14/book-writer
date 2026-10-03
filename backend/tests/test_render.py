"""Citation renumbering and reference lists."""

from __future__ import annotations

from bookwriter.models import ChapterDraft, Evidence
from bookwriter.render import book_html, book_markdown, finalize_chapter


def ev(i: int, url: str, title: str = "A page") -> Evidence:
    return Evidence(id=f"E{i}", claim="c", quote="q", url=url, source_name="Reuters", title=title, source_type="news")


def test_renumbers_in_order_of_first_appearance_and_merges_same_url():
    evidence = [ev(1, "https://a.example/1"), ev(2, "https://b.example/2"), ev(3, "https://a.example/1")]
    draft = ChapterDraft(
        title="T",
        paragraphs=["Second source first [E2]. Then the first [E1][E3].", "Again [E3]."],
        takeaway="Takeaway: done.",
    )
    ch = finalize_chapter(1, draft, evidence, [], {})
    # E2 is cited first -> [1]; E1 and E3 share a URL -> one reference [2], duplicate markers collapse
    assert ch.paragraphs == ["Second source first [1]. Then the first [2].", "Again [2]."]
    assert [(r.number, r.url, r.evidence_ids) for r in ch.references] == [
        (1, "https://b.example/2", ["E2"]),
        (2, "https://a.example/1", ["E1", "E3"]),
    ]


def test_unused_evidence_is_dropped_and_titles_cleaned():
    evidence = [ev(1, "https://www.reuters.com/x", "UPI hits a record | Reuters"), ev(2, "https://unused.example")]
    draft = ChapterDraft(title="T", paragraphs=["Only one [E1]."], takeaway="Takeaway: done.")
    ch = finalize_chapter(1, draft, evidence, [], {})
    assert [e.id for e in ch.evidence] == ["E1"]
    assert ch.references[0].title == "UPI hits a record"
    assert ch.references[0].source_type == "news"


def test_markdown_and_html_place_takeaway_before_references():
    evidence = [ev(1, "https://a.example/1")]
    draft = ChapterDraft(title="Getting paid", paragraphs=["A fact [E1]."], takeaway="Takeaway: done.")
    ch = finalize_chapter(1, draft, evidence, [], {})
    md = book_markdown("Book", [ch])
    assert md.index("Takeaway: done.") < md.index("### References")
    assert '1. Reuters. "A page". https://a.example/1' in md
    html = book_html("Book", [ch])
    assert '<sup class="cite">[1]</sup>' in html and '<a href="https://a.example/1">' in html
