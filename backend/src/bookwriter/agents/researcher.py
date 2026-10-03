"""Researcher: a tool-using agent that builds a verified evidence pack.

Search and page reading come from the research MCP server. Saving evidence is a
local tool that refuses anything it cannot verify: the URL must have been read
in this session and the quote must appear verbatim on the page (checked through
the MCP `verify_quote` tool). The model can't slip an invented source past it.
"""

from __future__ import annotations

import json
from typing import Any

from ..events import emit
from ..llm import ToolSpec
from ..models import ChapterPlan, Evidence, Outline
from ..prompts import render
from ..state import Deps
from ..tools import web

RECORD_SCHEMA = {
    "type": "object",
    "properties": {
        "fact_need_id": {"type": "string", "description": "Which fact need this answers, e.g. 'F2', or 'extra'."},
        "claim": {"type": "string", "description": "The fact in plain words; must not say more than the quote."},
        "quote": {"type": "string", "description": "One or two sentences copied exactly from the page passages."},
        "url": {"type": "string", "description": "The page URL exactly as passed to read_page."},
        "title": {"type": "string", "description": "The page or document title."},
        "source_name": {"type": "string", "description": "Publisher, e.g. 'Reserve Bank of India (RBI)'."},
        "published": {"type": "string", "description": "Publication date if known, else empty."},
    },
    "required": ["fact_need_id", "claim", "quote", "url", "title", "source_name"],
}


async def research_chapter(
    deps: Deps,
    plan: ChapterPlan,
    outline: Outline,
    *,
    existing: list[Evidence] | None = None,
    gaps: list[str] | None = None,
) -> list[Evidence]:
    """Run the research agent. In gap mode it only looks for the listed gaps and
    appends to the existing pack."""
    cfg = deps.cfg
    evidence: list[Evidence] = list(existing or [])
    read_urls: dict[str, dict] = {}
    max_ev = cfg.limits.max_evidence_per_chapter + (4 if gaps else 0)
    budget = cfg.limits.gap_research_tool_calls if gaps else cfg.limits.research_tool_calls
    ch = plan.number

    mcp_tools = {t.name: t for t in deps.research.tool_specs({"web_search", "read_page"})}

    async def read_page(args: dict[str, Any]) -> str:
        out = await mcp_tools["read_page"].handler(args)
        data = json.loads(out)
        if data.get("ok"):
            read_urls[args["url"]] = data
            emit(
                "source_read",
                f"Read {data.get('publisher') or web.domain_of(args['url'])}: {data.get('title', '')[:80]}",
                agent="researcher",
                chapter=ch,
                url=args["url"],
                source_type=data.get("source_type"),
            )
        return out

    async def record_evidence(args: dict[str, Any]) -> str:
        url = args["url"].strip()
        if len(evidence) >= max_ev:
            return "Evidence limit reached. Stop researching and finish."
        if url not in read_urls:
            return "Rejected: read this page with read_page first; evidence must come from pages you have read."
        if any(e.quote.strip() == args["quote"].strip() for e in evidence):
            return "Rejected: this quote is already recorded."
        check = json.loads(await deps.research.call("verify_quote", {"url": url, "quote": args["quote"]}))
        if not check.get("found"):
            emit(
                "evidence_rejected",
                f"Quote not found on page ({check.get('similarity', 0):.0%} match)",
                agent="researcher",
                chapter=ch,
                url=url,
            )
            return f"Rejected: {check.get('reason', 'quote not found')} (similarity {check.get('similarity', 0)})."
        page = read_urls[url]
        ev = Evidence(
            id=f"E{len(evidence) + 1}",
            fact_need_id=args.get("fact_need_id"),
            claim=args["claim"].strip(),
            quote=args["quote"].strip(),
            url=url,
            source_name=(args.get("source_name") or page.get("publisher") or web.publisher_for(url)).strip(),
            title=(args.get("title") or page.get("title") or url).strip(),
            source_type=web.classify_source(url, cfg),
            published=(args.get("published") or page.get("published") or None),
        )
        evidence.append(ev)
        emit(
            "evidence_added",
            f"{ev.id} [{ev.source_type}] {ev.claim[:110]}",
            agent="researcher",
            chapter=ch,
            evidence=ev.model_dump(),
        )
        return f"Saved as {ev.id}. ({len(evidence)}/{max_ev} evidence items)"

    tools = [
        mcp_tools["web_search"],
        ToolSpec(
            mcp_tools["read_page"].name,
            mcp_tools["read_page"].description,
            mcp_tools["read_page"].input_schema,
            read_page,
        ),
        ToolSpec(
            "record_evidence",
            "Save one verified fact with its exact supporting quote. The quote is "
            "checked against the page text; unverifiable quotes are rejected.",
            RECORD_SCHEMA,
            record_evidence,
        ),
    ]

    fact_needs = "\n".join(f"- {f.id}: {f.question} ({f.why})" for f in plan.fact_needs)
    extra = ""
    if gaps:
        have = "\n".join(f"- {e.id}: {e.claim}" for e in evidence)
        extra = (
            "FOLLOW-UP ROUND. The Fact-checker found claims in the draft that the current evidence cannot support. "
            "Find reliable evidence for these specific gaps only:\n"
            + "\n".join(f"- {g}" for g in gaps)
            + f"\n\nEvidence already in the pack (do not duplicate):\n{have}"
        )
    system = render(
        "researcher",
        book_title=outline.book_title,
        audience=deps.cfg.brief.audience,
        number=ch,
        chapter_title=plan.title,
        goal=plan.goal,
        fact_needs=fact_needs,
        extra=extra,
        max_evidence=max_ev,
        tool_budget=budget,
    )
    emit("agent_start", "Gap research" if gaps else "Researching sources", agent="researcher", chapter=ch)
    result = await deps.llm.agent_loop(
        "researcher",
        system=system,
        user="Start researching now." if not gaps else "Research the gaps now.",
        tools=tools,
        max_tool_calls=budget,
        chapter=ch,
    )
    new = len(evidence) - len(existing or [])
    emit(
        "agent_done",
        f"{new} evidence items from {len({e.url for e in evidence})} sources. {result.final_text[:200]}",
        agent="researcher",
        chapter=ch,
        tool_calls=result.tool_calls,
    )
    return evidence
