"""The research MCP server's tools, called over a real MCP session (in-process), with canned pages."""

from __future__ import annotations

import json

from fakes import chapter_urls, install_fake_web, quotes

from bookwriter.mcp_client import connect_research


async def test_research_server_tools(monkeypatch):
    install_fake_web(monkeypatch)
    url = chapter_urls(1)[0]
    async with connect_research("inprocess") as research:
        assert {t.name for t in research.tool_specs()} == {"web_search", "read_page", "verify_quote", "check_links"}

        found = json.loads(await research.call("web_search", {"query": "UPI merchants", "official_only": True}))
        assert found["results"] and {"title", "url", "source_type", "snippet"} <= set(found["results"][0])

        page = json.loads(await research.call("read_page", {"url": url, "focus": "merchant payments"}))
        assert page["ok"] and page["via"] == "direct" and page["source_type"] == "official"
        assert any("Merchants in chapter one" in p["text"] for p in page["passages"])

        blocked = json.loads(
            await research.call("read_page", {"url": "https://en.wikipedia.org/wiki/UPI", "focus": "x"})
        )
        assert not blocked["ok"] and "blocked" in blocked["error"]

        assert json.loads(await research.call("verify_quote", {"url": url, "quote": quotes(url)[0]}))["found"]
        made_up = "A sentence that appears nowhere on this page at all, word for word."
        assert not json.loads(await research.call("verify_quote", {"url": url, "quote": made_up}))["found"]

        links = json.loads(await research.call("check_links", {"urls": [url, url]}))
        assert len(links) == 1 and links[0]["ok"]  # duplicates are checked once
