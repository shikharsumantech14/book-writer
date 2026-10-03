"""Domain models: the typed contracts every agent reads and writes.

Models suffixed with nothing are shared state; models used as an LLM's
structured output keep their fields simple (no numeric/length constraints)
so they map cleanly onto the API's JSON-schema subset. Rules like word counts
are enforced in code (see checks/lint.py), not trusted to the schema.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

# --------------------------------------------------------------------------- plan


class FactNeed(BaseModel):
    id: str = Field(description="Short id like 'F1'.")
    question: str = Field(
        description="A factual question research must answer, e.g. 'When was UPI launched and by whom?'"
    )
    why: str = Field(description="How the answer serves the chapter's story.")


class GlossaryTerm(BaseModel):
    term: str
    plain_explanation: str = Field(description="One plain-English sentence a new shop owner understands.")
    introduced_in_chapter: int


class ChapterPlan(BaseModel):
    number: int
    title: str
    goal: str = Field(description="What the reader should understand or feel after this chapter.")
    narrative_arc: str = Field(description="3-5 sentences describing the flow from opening to takeaway.")
    key_points: list[str]
    fact_needs: list[FactNeed]
    takeaway_idea: str = Field(description="The single idea the 'Takeaway:' line should land.")


class StyleGuide(BaseModel):
    reader_persona: str = Field(description="A concrete picture of the reader, e.g. a first-time kirana owner.")
    voice: str = Field(description="How the mentor sounds, in 2-3 sentences.")
    do: list[str]
    dont: list[str]
    glossary: list[GlossaryTerm]
    sample_paragraph: str = Field(
        description="A short paragraph in the target voice. Must contain NO facts, figures or dates."
    )


class Outline(BaseModel):
    book_title: str
    chapters: list[ChapterPlan]
    style_guide: StyleGuide


# ----------------------------------------------------------------------- research

SourceType = Literal["official", "news", "other"]


class Evidence(BaseModel):
    """One verified fact: a claim, the exact supporting quote, and where it lives."""

    id: str  # "E1", "E2"... local to a chapter
    fact_need_id: str | None = None
    claim: str
    quote: str  # verified verbatim (normalised) against the fetched page text
    url: str
    source_name: str  # publisher, e.g. "National Payments Corporation of India"
    title: str  # page/document title
    source_type: SourceType = "other"
    published: str | None = None


# ------------------------------------------------------------------------ writing


class ChapterDraft(BaseModel):
    title: str
    paragraphs: list[str] = Field(
        description="Flowing prose paragraphs. Cite evidence inline as [E1], [E2]. No bullets, no headings."
    )
    takeaway: str = Field(description="One sentence that starts with 'Takeaway:'.")


# ---------------------------------------------------------------------- reviewing


class LintIssue(BaseModel):
    rule: str
    detail: str


class EditIssue(BaseModel):
    quote: str = Field(description="The exact text with the problem (short).")
    problem: str
    fix: str = Field(description="Concrete instruction or rewrite suggestion.")
    severity: Literal["must_fix", "should_fix"]


class EditorScores(BaseModel):
    """1 (poor) to 5 (excellent)."""

    tone: int
    clarity: int
    grammar: int
    jargon_free: int
    flow: int
    style_guide: int


class EditorVerdict(BaseModel):
    approved: bool
    scores: EditorScores
    issues: list[EditIssue]
    summary: str


class SentenceTag(BaseModel):
    sentence_id: int
    is_factual_claim: bool = Field(
        description="True if the sentence states a fact, figure, date, statistic or attributable event."
    )


class SentenceTags(BaseModel):
    tags: list[SentenceTag]


Verdict = Literal["SUPPORTED", "PARTIAL", "UNSUPPORTED"]


class SupportJudgement(BaseModel):
    sentence_id: int
    verdict: Verdict
    reason: str
    fix_hint: str = Field(description="How the writer should fix it; empty if SUPPORTED.")
    needs_new_source: bool = Field(description="True only if no evidence in the pack could support this claim.")


class SupportJudgements(BaseModel):
    judgements: list[SupportJudgement]


class ClaimCheck(BaseModel):
    sentence_id: int
    sentence: str
    cited: list[str]
    verdict: Verdict | Literal["UNCITED"]
    reason: str = ""
    fix_hint: str = ""
    needs_new_source: bool = False


class LinkStatus(BaseModel):
    url: str
    ok: bool
    status: int | None = None
    final_url: str | None = None
    error: str | None = None


class FactCheckReport(BaseModel):
    passed: bool
    checks: list[ClaimCheck]
    links: list[LinkStatus]
    summary: str


class ChiefEdit(BaseModel):
    chapter: int
    find: str = Field(description="Exact existing text (copy verbatim, short as possible).")
    replace: str
    reason: str


class ChiefEditorReport(BaseModel):
    consistency_notes: list[str]
    edits: list[ChiefEdit]


# ------------------------------------------------------------------------- output


class Reference(BaseModel):
    number: int
    source_name: str
    title: str
    url: str
    evidence_ids: list[str]


class FinalChapter(BaseModel):
    number: int
    title: str
    paragraphs: list[str]  # citations renumbered to [1], [2]...
    takeaway: str
    references: list[Reference]
    word_count: int
    evidence: list[Evidence]
    claim_checks: list[ClaimCheck]
    stats: dict
