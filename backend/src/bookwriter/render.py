"""Assemble the final book: renumber citations per chapter, build reference
lists, and render Markdown and HTML."""

from __future__ import annotations

import html
import re

from .checks.lint import CITE, word_count
from .models import ChapterDraft, ClaimCheck, Evidence, FinalChapter, Reference
from .tools.web import clean_title


def finalize_chapter(
    number: int,
    draft: ChapterDraft,
    evidence: list[Evidence],
    claim_checks: list[ClaimCheck],
    stats: dict,
) -> FinalChapter:
    """Map [E#] markers to [1], [2]... in order of first appearance.

    Evidence items that share a URL share one reference number, so the
    reference list has one entry per source page.
    """
    by_id = {e.id: e for e in evidence}
    url_to_num: dict[str, int] = {}
    refs: dict[int, Reference] = {}

    for p in draft.paragraphs:
        for eid in CITE.findall(p):
            ev = by_id.get(eid)
            if not ev:
                continue
            if ev.url not in url_to_num:
                n = len(url_to_num) + 1
                url_to_num[ev.url] = n
                refs[n] = Reference(
                    number=n,
                    source_name=ev.source_name,
                    title=clean_title(ev.title, ev.url, ev.source_name),
                    url=ev.url,
                    source_type=ev.source_type,
                    evidence_ids=[],
                )
            ref = refs[url_to_num[ev.url]]
            if eid not in ref.evidence_ids:
                ref.evidence_ids.append(eid)

    def sub(m: re.Match) -> str:
        ev = by_id.get(m.group(1))
        return f"[{url_to_num[ev.url]}]" if ev else ""

    paragraphs = []
    for p in draft.paragraphs:
        p = CITE.sub(sub, p)
        p = re.sub(r"(\[\d+\])(\s*\1)+", r"\1", p)  # [2][2] -> [2]
        p = re.sub(r"\]\s+\[", "][", p)
        paragraphs.append(p)

    used_ids = {eid for r in refs.values() for eid in r.evidence_ids}
    return FinalChapter(
        number=number,
        title=draft.title,
        paragraphs=paragraphs,
        takeaway=draft.takeaway.strip(),
        references=[refs[n] for n in sorted(refs)],
        word_count=word_count(draft),
        evidence=[e for e in evidence if e.id in used_ids],
        claim_checks=claim_checks,
        stats=stats,
    )


def reference_line(r: Reference) -> str:
    return f'{r.number}. {r.source_name}. "{r.title}". {r.url}'


def chapter_markdown(ch: FinalChapter) -> str:
    parts = [f"## Chapter {ch.number}: {ch.title}", *ch.paragraphs, ch.takeaway, "### References"]
    parts.append("\n".join(reference_line(r) for r in ch.references))
    return "\n\n".join(parts)


def book_markdown(title: str, chapters: list[FinalChapter]) -> str:
    return f"# {title}\n\n" + "\n\n---\n\n".join(chapter_markdown(c) for c in chapters) + "\n"


def book_html(title: str, chapters: list[FinalChapter]) -> str:
    def para(p: str) -> str:
        esc = html.escape(p)
        return re.sub(r"\[(\d+)\]", r'<sup class="cite">[\1]</sup>', esc)

    body = [f"<h1>{html.escape(title)}</h1>"]
    for ch in chapters:
        body.append(f'<section class="chapter"><h2><span>Chapter {ch.number}</span>{html.escape(ch.title)}</h2>')
        body += [f"<p>{para(p)}</p>" for p in ch.paragraphs]
        body.append(f'<p class="takeaway">{html.escape(ch.takeaway)}</p>')
        body.append('<h3>References</h3><ol class="refs">')
        for r in ch.references:
            u = html.escape(r.url)
            body.append(f'<li>{html.escape(r.source_name)}. “{html.escape(r.title)}”. <a href="{u}">{u}</a></li>')
        body.append("</ol></section>")
    return HTML_TEMPLATE.replace("{{title}}", html.escape(title)).replace("{{body}}", "\n".join(body))


HTML_TEMPLATE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{title}}</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; max-width: 42rem; margin: 3rem auto; padding: 0 1rem;
         color: #1f2328; line-height: 1.75; font-size: 1.08rem; background: #fffdf8; }
  h1 { font-size: 2.1rem; line-height: 1.25; margin-bottom: 3rem; }
  h2 { font-size: 1.5rem; margin-top: 4rem; } h2 span { display:block; font-size: .8rem; letter-spacing: .12em;
       text-transform: uppercase; color: #0f766e; font-family: system-ui, sans-serif; }
  h3 { font-family: system-ui, sans-serif; font-size: .95rem; text-transform: uppercase;
       letter-spacing: .08em; color: #555; }
  .cite { color: #0f766e; font-size: .7em; }
  .takeaway { font-weight: bold; border-left: 3px solid #0f766e; padding-left: 1rem; }
  .refs { font-size: .9rem; } .refs a { color: #0f766e; word-break: break-all; }
  section.chapter { page-break-before: always; }
</style></head><body>
{{body}}
</body></html>
"""
