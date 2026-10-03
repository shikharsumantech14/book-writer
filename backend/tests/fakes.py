"""Test doubles: a scripted Anthropic client and canned web pages.

The fake client answers `beta.messages.parse` by the requested output type and
`beta.messages.create` (the Researcher's tool loop) turn by turn, so the real
graph, routers, checks, MCP server and accounting all run without network
access. The script drives every loop at least once:

* chapter 1: lint sends the first (too short) draft back, the Editor sends the
  next one back, the Fact-checker flags a PARTIAL claim once; then it passes.
* chapter 2: the Fact-checker asks for a new source, so gap research runs.
* chapter 3: the Fact-checker never passes; the safety net removes the claim.
"""

from __future__ import annotations

import re
import time
from collections import defaultdict
from types import SimpleNamespace
from typing import Any

from bookwriter.models import (
    ChapterDraft,
    ChapterPlan,
    ChiefEdit,
    ChiefEditorReport,
    EditIssue,
    EditorScores,
    EditorVerdict,
    FactNeed,
    GlossaryTerm,
    Outline,
    SentenceTag,
    SentenceTags,
    StyleGuide,
    SupportJudgement,
    SupportJudgements,
)
from bookwriter.tools.web import PageDoc

WORD = {1: "one", 2: "two", 3: "three"}
NUM = {v: k for k, v in WORD.items()}

# ------------------------------------------------------------------ web pages


def chapter_urls(n: int) -> list[str]:
    return [
        f"https://www.npci.org.in/ch{n}/statistics",
        f"https://www.rbi.org.in/ch{n}/annual-report",
        f"https://www.livemint.com/ch{n}/upi-story",
    ]


def gap_url(n: int) -> str:
    return f"https://pib.gov.in/ch{n}/press-release"


def quotes(url: str) -> list[str]:
    n = int(re.search(r"/ch(\d)/", url).group(1))
    tag = url.split("/")[-1]
    return [
        f"Merchants in chapter {WORD[n]} accepted many more digital payments according to the {tag} page.",
        f"Small shops in chapter {WORD[n]} reported faster settlement of payments in the {tag} data.",
    ]


def page(url: str) -> PageDoc:
    filler = " ".join(
        "This page explains how small businesses across India receive money from customers." for _ in range(6)
    )
    text = f"{filler}\n\n" + "\n\n".join(quotes(url)) + f"\n\n{filler}"
    title = f"{url.split('/')[-1].replace('-', ' ').title()} | Mint"
    return PageDoc(url, url, 200, True, title, "", "2025-08-01", text, "text/html", time.time())


def install_fake_web(monkeypatch) -> None:
    """Swap the network primitives behind the research MCP server for canned pages."""
    from bookwriter.tools import web

    async def search(query, cfg, *, official_only=False, max_results=6):
        return [
            {"title": "Result", "url": u, "domain": web.domain_of(u), "source_type": "official", "snippet": ""}
            for u in chapter_urls(1)
        ]

    async def fetch_page(url, *, use_cache=True):
        return page(url)

    async def check_links(urls):
        return [
            {"url": u, "ok": True, "status": 200, "final_url": u, "error": None, "via": "direct"}
            for u in dict.fromkeys(urls)
        ]

    monkeypatch.setattr(web, "search", search)
    monkeypatch.setattr(web, "fetch_page", fetch_page)
    monkeypatch.setattr(web, "check_links", check_links)


# ------------------------------------------------------------------ drafts

ADVICE = [
    "Keep the code where every customer can see it without asking you for help.",
    "Check the confirmation on your own phone before you hand over the goods.",
    "Talk to your regular customers and ask which way of paying suits them best.",
    "Write down a simple habit for the end of each day and follow it every evening.",
]


def make_draft(n: int, ids: list[str], *, paragraphs: int = 9) -> ChapterDraft:
    paras = []
    for i in range(paragraphs):
        e = ids[i % len(ids)]
        opening = (
            "Picture a quiet morning at a small shop before the first customer arrives."
            if i == 0
            else "Here is another part of the same story worth knowing well."
        )
        cited = f"Payments on a phone have changed how a shop in chapter {WORD[n]} works each day [{e}]."
        paras.append(" ".join([opening, cited, *ADVICE]))
    return ChapterDraft(
        title=f"Chapter {WORD[n]} title",
        paragraphs=paras,
        takeaway="Takeaway: Start small, stay patient and let your customers pay the way they like.",
    )


# ------------------------------------------------------------------ fake client


def _usage(**kw: int) -> SimpleNamespace:
    base = {"input_tokens": 1000, "output_tokens": 400, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0}
    return SimpleNamespace(**(base | kw))


def _response(kw: dict, *, parsed: Any = None, content: list | None = None, stop: str = "end_turn", usage=None):
    return SimpleNamespace(
        model=kw["model"],
        usage=usage or _usage(),
        stop_reason=stop,
        stop_details=None,
        parsed_output=parsed,
        content=content or [],
    )


def _tool(name: str, **inp: Any) -> SimpleNamespace:
    _tool.n += 1
    return SimpleNamespace(type="tool_use", id=f"tu_{_tool.n}", name=name, input=inp)


_tool.n = 0


class FakeAnthropic:
    def __init__(self) -> None:
        self.calls: list[dict] = []
        self.reviews: dict[int, int] = defaultdict(int)
        self.fact_rounds: dict[int, int] = defaultdict(int)
        self.beta = SimpleNamespace(messages=SimpleNamespace(parse=self._parse, create=self._create))

    def _log(self, kind: str, kw: dict, what: str) -> None:
        effort = (kw.get("output_config") or {}).get("effort")
        self.calls.append({"kind": kind, "what": what, "model": kw["model"], "effort": effort, "system": kw["system"]})

    # -------------------------------------------------------- structured calls

    async def _parse(self, **kw: Any) -> SimpleNamespace:
        out = kw["output_format"]
        self._log("parse", kw, out.__name__)
        user = kw["messages"][0]["content"]
        system = kw["system"]
        handler = {
            Outline: self._outline,
            ChapterDraft: self._draft,
            EditorVerdict: self._editor,
            SentenceTags: self._tags,
            SupportJudgements: self._judge,
            ChiefEditorReport: self._chief,
        }[out]
        return _response(kw, parsed=handler(system, user))

    def _outline(self, system: str, user: str) -> Outline:
        chapters = [
            ChapterPlan(
                number=n,
                title=f"Chapter {WORD[n]} title",
                goal="Help the reader",
                narrative_arc="Open, explain, close.",
                key_points=["one point"],
                fact_needs=[
                    FactNeed(id="x", question=f"Question {k} for chapter {WORD[n]}?", why="w") for k in WORD.values()
                ]
                + [FactNeed(id="x", question=f"Unanswerable {WORD[n]}?", why="w")],
                takeaway_idea="Start small",
            )
            for n in (1, 2, 3)
        ]
        glossary = [
            GlossaryTerm(term="UPI", plain_explanation="A way to pay from your phone.", introduced_in_chapter=1),
            GlossaryTerm(term="upi", plain_explanation="Duplicate.", introduced_in_chapter=2),
        ]
        style = StyleGuide(
            reader_persona="A new shop owner",
            voice="Warm",
            do=["Be plain"],
            dont=["Hype"],
            glossary=glossary,
            sample_paragraph="Welcome to your shop.",
        )
        return Outline(book_title="placeholder", chapters=chapters, style_guide=style)

    def _draft(self, system: str, user: str) -> ChapterDraft:
        n = int(re.search(r'"number": (\d+)', system).group(1))
        ids = re.findall(r"^\[(E\d+)\] \(", system, re.M)
        revision = "<revision>" in system
        if n == 1 and not revision:
            return make_draft(n, ids, paragraphs=3)  # too short: lint sends it back
        return make_draft(n, ids)

    def _editor(self, system: str, user: str) -> EditorVerdict:
        n = int(re.search(r"Chapter (\d+):", user).group(1))
        self.reviews[n] += 1
        if n == 1 and self.reviews[n] == 1:
            issue = EditIssue(
                quote="Picture a quiet morning", problem="Flat opening", fix="Add a sound", severity="must_fix"
            )
            return EditorVerdict(
                approved=False,
                scores=EditorScores(tone=4, clarity=4, grammar=5, jargon_free=5, flow=3, style_guide=4),
                issues=[issue],
                summary="One must-fix.",
            )
        return EditorVerdict(
            approved=True,
            scores=EditorScores(tone=5, clarity=5, grammar=5, jargon_free=5, flow=5, style_guide=5),
            issues=[],
            summary="Reads well.",
        )

    def _tags(self, system: str, user: str) -> SentenceTags:
        ids = [int(i) for i in re.findall(r"^(\d+): ", user, re.M)]
        return SentenceTags(tags=[SentenceTag(sentence_id=i, is_factual_claim=False) for i in ids])

    def _judge(self, system: str, user: str) -> SupportJudgements:
        n = NUM[re.search(r"chapter (one|two|three)", user).group(1)]
        self.fact_rounds[n] += 1
        r = self.fact_rounds[n]
        ids = [int(i) for i in re.findall(r'<sentence id="(\d+)">', user)]
        out = []
        for k, sid in enumerate(ids):
            verdict, needs_new = "SUPPORTED", False
            if k == 0 and ((n == 1 and r == 1) or (n == 2 and r == 1) or n == 3):
                verdict = "PARTIAL" if n == 1 else "UNSUPPORTED"
                needs_new = n == 2
            out.append(
                SupportJudgement(
                    sentence_id=sid,
                    verdict=verdict,
                    reason="scripted",
                    fix_hint="" if verdict == "SUPPORTED" else "Soften it.",
                    needs_new_source=needs_new,
                )
            )
        return SupportJudgements(judgements=out)

    def _chief(self, system: str, user: str) -> ChiefEditorReport:
        return ChiefEditorReport(
            consistency_notes=["Voice is consistent."],
            edits=[
                ChiefEdit(chapter=1, find="Picture a quiet morning", replace="Imagine a quiet morning", reason="voice"),
                ChiefEdit(chapter=1, find="[E1]", replace="[E2]", reason="breaks a citation"),
                ChiefEdit(chapter=9, find="x", replace="y", reason="no such chapter"),
            ],
        )

    # -------------------------------------------------------- researcher tool loop

    async def _create(self, **kw: Any) -> SimpleNamespace:
        self._log("create", kw, "loop")
        system, messages = kw["system"], kw["messages"]
        n = int(re.search(r"Chapter (\d+):", system).group(1))
        turn = sum(1 for m in messages if m["role"] == "assistant")
        usage = _usage(
            input_tokens=200, cache_read_input_tokens=2000 * turn, cache_creation_input_tokens=300, output_tokens=150
        )
        gaps = "FOLLOW-UP ROUND" in system
        urls = [gap_url(n)] if gaps else chapter_urls(n)
        if turn == 0:
            blocks = [] if gaps else [_tool("web_search", query="UPI merchants", official_only=True)]
            blocks += [_tool("read_page", url=u, focus="merchant payments") for u in urls]
            return _response(kw, content=blocks, stop="tool_use", usage=usage)
        if turn == 1:
            blocks = []
            for i, u in enumerate(urls):
                for j, q in enumerate(quotes(u)):
                    fact = f"F{min(2 * i + j + 1, 3)}"  # F1-F3 answered; the fourth question stays open
                    blocks.append(
                        _tool(
                            "record_evidence",
                            fact_need_id=fact,
                            claim=q,
                            quote=q,
                            url=u,
                            title=f"{u.split('/')[-1]} - Mint",
                            source_name="Publisher",
                        )
                    )
            if not gaps:
                blocks.append(
                    _tool(
                        "record_evidence",
                        fact_need_id="F1",
                        claim="c",
                        quote="Never read this page.",
                        url="https://example.com/unread",
                        title="t",
                        source_name="s",
                    )
                )
                blocks.append(
                    _tool(
                        "record_evidence",
                        fact_need_id="F1",
                        claim="c",
                        quote="A sentence that does not appear anywhere on the page at all.",
                        url=urls[0],
                        title="t",
                        source_name="s",
                    )
                )
            return _response(kw, content=blocks, stop="tool_use", usage=usage)
        return _response(kw, content=[SimpleNamespace(type="text", text="Done.")], usage=usage)
