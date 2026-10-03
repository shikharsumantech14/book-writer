"""Fact-checker: three layers, cheapest first.

1. Links (code, via MCP): every cited source URL must still resolve.
2. Coverage (fast model): which sentences make factual claims? A factual claim
   without a citation is flagged UNCITED.
3. Support (strong model): for each cited sentence, does the cited evidence
   (verified quote + surrounding page context) actually support it?
"""

from __future__ import annotations

import asyncio
import json
import re

from ..checks.lint import CITE, split_sentences, strip_citations
from ..events import emit
from ..models import (
    ChapterDraft,
    ClaimCheck,
    Evidence,
    FactCheckReport,
    LinkStatus,
    SentenceTags,
    SupportJudgements,
)
from ..prompts import render
from ..state import Deps


async def fact_check(deps: Deps, number: int, draft: ChapterDraft, evidence: list[Evidence]) -> FactCheckReport:
    emit("agent_start", "Checking links, citation coverage and claim support", agent="fact_checker", chapter=number)
    by_id = {e.id: e for e in evidence}
    sentences = split_sentences(draft.paragraphs)
    cited_ev = [by_id[i] for i in dict.fromkeys(c for _, _, s in sentences for c in CITE.findall(s)) if i in by_id]

    # 1. links ---------------------------------------------------------------
    links_raw = json.loads(await deps.research.call("check_links", {"urls": [e.url for e in cited_ev]}))
    links = [LinkStatus(**lk) for lk in links_raw]
    dead = {lk.url for lk in links if not lk.ok}
    for lk in links:
        if not lk.ok:
            emit(
                "link_broken", f"Broken link ({lk.status or lk.error}): {lk.url}", agent="fact_checker", chapter=number
            )

    # 2. coverage + context gathering, in parallel ------------------------------
    tagged_task = asyncio.create_task(_tag_sentences(deps, number, sentences))
    contexts = await _contexts(deps, cited_ev)
    factual = await tagged_task

    # 3. support ---------------------------------------------------------------
    checks: list[ClaimCheck] = []
    to_judge = []
    for sid, _, s in sentences:
        ids = CITE.findall(s)
        if not ids:
            has_digit = bool(re.search(r"\d", strip_citations(s)))
            if factual.get(sid) or has_digit:
                checks.append(
                    ClaimCheck(
                        sentence_id=sid,
                        sentence=s,
                        cited=[],
                        verdict="UNCITED",
                        reason="States a fact without a citation." + (" Contains a figure." if has_digit else ""),
                        fix_hint=(
                            "Cite the evidence that supports it, or rephrase as general guidance with no specific fact."
                        ),
                    )
                )
            continue
        broken = [i for i in ids if i not in by_id or by_id[i].url in dead]
        if broken:
            checks.append(
                ClaimCheck(
                    sentence_id=sid,
                    sentence=s,
                    cited=ids,
                    verdict="UNSUPPORTED",
                    reason=f"Cited source(s) {', '.join(broken)} unavailable (broken link or unknown id).",
                    fix_hint="Use a different evidence id that supports this, or remove the claim.",
                    needs_new_source=True,
                )
            )
            continue
        to_judge.append((sid, s, ids))

    if to_judge:
        judged = await _judge(deps, number, to_judge, by_id, contexts, evidence)
        for sid, s, ids in to_judge:
            j = judged.get(sid)
            if j is None:
                checks.append(
                    ClaimCheck(
                        sentence_id=sid,
                        sentence=s,
                        cited=ids,
                        verdict="UNSUPPORTED",
                        reason="No judgement returned.",
                        fix_hint="Re-check this claim.",
                    )
                )
                continue
            checks.append(
                ClaimCheck(
                    sentence_id=sid,
                    sentence=s,
                    cited=ids,
                    verdict=j.verdict,
                    reason=j.reason,
                    fix_hint=j.fix_hint,
                    needs_new_source=j.needs_new_source,
                )
            )

    checks.sort(key=lambda c: c.sentence_id)
    bad = [c for c in checks if c.verdict != "SUPPORTED"]
    supported = sum(c.verdict == "SUPPORTED" for c in checks)
    summary = (
        f"{supported}/{len(checks)} claims supported; "
        f"{sum(c.verdict == 'PARTIAL' for c in checks)} partial, "
        f"{sum(c.verdict == 'UNSUPPORTED' for c in checks)} unsupported, "
        f"{sum(c.verdict == 'UNCITED' for c in checks)} uncited; "
        f"{len(links) - len(dead)}/{len(links)} links OK"
    )
    report = FactCheckReport(passed=not bad and not dead, checks=checks, links=links, summary=summary)
    emit(
        "review",
        ("Passed — " if report.passed else "Sent back — ") + summary,
        agent="fact_checker",
        chapter=number,
        approved=report.passed,
        report=report.model_dump(),
    )
    return report


async def _tag_sentences(deps: Deps, number: int, sentences: list[tuple[int, int, str]]) -> dict[int, bool]:
    listing = "\n".join(f"{sid}: {strip_citations(s)}" for sid, _, s in sentences)
    tags = await deps.llm.structured(
        "claim_tagger",
        system=render("claim_tagger"),
        user=listing,
        output=SentenceTags,
        chapter=number,
        max_tokens=4000,
    )
    return {t.sentence_id: t.is_factual_claim for t in tags.tags}


async def _contexts(deps: Deps, evidence: list[Evidence]) -> dict[str, str]:
    async def one(e: Evidence) -> tuple[str, str]:
        try:
            r = json.loads(await deps.research.call("verify_quote", {"url": e.url, "quote": e.quote}))
            return e.id, r.get("context", "") if r.get("found") else ""
        except Exception:
            return e.id, ""

    return dict(await asyncio.gather(*(one(e) for e in evidence)))


async def _judge(deps, number, to_judge, by_id, contexts, evidence):
    pack = "\n".join(f"[{e.id}] {e.source_name}: {e.claim}" for e in evidence)
    blocks = []
    for sid, s, ids in to_judge:
        ev = "\n".join(
            f'  [{i}] quote: "{by_id[i].quote}"\n       context: "...{contexts.get(i, "")[:700]}..."' for i in ids
        )
        blocks.append(f'<sentence id="{sid}">\n{s}\n<cited_evidence>\n{ev}\n</cited_evidence>\n</sentence>')
    user = f"<evidence_pack_summary>\n{pack}\n</evidence_pack_summary>\n\n" + "\n\n".join(blocks)
    result = await deps.llm.structured(
        "fact_checker", system=render("fact_checker"), user=user, output=SupportJudgements, chapter=number
    )
    return {j.sentence_id: j for j in result.judgements}
