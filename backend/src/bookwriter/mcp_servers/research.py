"""Research MCP server.

Exposes the web-research primitives as MCP tools so any MCP client can use
them: our Researcher and Fact-checker agents (over stdio), Claude Desktop,
Claude Code, or another agent framework. Tools return compact JSON so they are
cheap to put in a model's context.

Run standalone:  uv run python -m bookwriter.mcp_servers.research
"""

from __future__ import annotations

import json

from mcp.server.mcpserver import MCPServer

from ..config import load_config
from ..tools import web

MAX_PASSAGE_CHARS = 9000

mcp = MCPServer(
    name="bookwriter-research",
    log_level="WARNING",
    instructions=(
        "Web research tools for fact-grounded writing. Search, read the most relevant "
        "passages of a page, verify that a quote appears verbatim on a page, and check links."
    ),
)


def _cfg():
    return load_config()


@mcp.tool()
async def web_search(query: str, official_only: bool = False, max_results: int = 6) -> str:
    """Search the web. Set official_only=true to restrict results to Indian government
    and regulator sites (NPCI, RBI, PIB, ministries). Returns title, url, domain,
    source_type (official/news/other) and a short snippet per result."""
    results = await web.search(query, _cfg(), official_only=official_only, max_results=max_results)
    return json.dumps({"query": query, "results": results}, ensure_ascii=False)


@mcp.tool()
async def read_page(url: str, focus: str) -> str:
    """Fetch a page (HTML or PDF) and return its title, publisher, date and the passages
    most relevant to `focus` (a question or keywords). Quotes for evidence must be
    copied exactly from these passages."""
    cfg = _cfg()
    if web.is_blocked(url, cfg):
        return json.dumps({"url": url, "ok": False, "error": "Domain is on the blocked list; use another source."})
    doc = await web.fetch_page(url)
    if not doc.ok:
        return json.dumps({"url": url, "ok": False, "status": doc.status, "error": doc.error})
    if len(doc.text) < web.MIN_TEXT_CHARS:
        return json.dumps(
            {"url": url, "ok": False, "error": "No readable text (JavaScript-rendered page). Use another source."}
        )
    passages, used = [], 0
    for p in web.top_passages(doc.text, focus, k=8):
        if used + len(p["text"]) > MAX_PASSAGE_CHARS:
            break
        passages.append(p)
        used += len(p["text"])
    return json.dumps(
        {
            "url": url,
            "final_url": doc.final_url,
            "ok": True,
            "title": doc.title,
            "publisher": doc.site_name,
            "published": doc.published,
            "source_type": web.classify_source(url, cfg),
            "via": doc.via,
            "page_chars": len(doc.text),
            "passages": passages,
        },
        ensure_ascii=False,
    )


@mcp.tool()
async def verify_quote(url: str, quote: str) -> str:
    """Check that `quote` appears verbatim (after normalising whitespace/punctuation)
    in the text of the page at `url`. Returns found, similarity and surrounding context."""
    doc = await web.fetch_page(url)
    if not doc.ok:
        return json.dumps({"found": False, "reason": f"Page could not be fetched: {doc.error}"})
    return json.dumps(web.find_quote(doc.text, quote), ensure_ascii=False)


@mcp.tool()
async def check_links(urls: list[str]) -> str:
    """Check that each URL works: HTTP status < 400 after redirects, or readable through the
    extract route when the site blocks automated clients (403/406/429)."""
    return json.dumps(await web.check_links(urls))


def main() -> None:
    mcp.run("stdio")


if __name__ == "__main__":
    main()
