"""Quote verification, the Tavily Extract fetch fallback, link checks and title cleaning."""

from __future__ import annotations

import time
from types import SimpleNamespace

import httpx
import pytest

from bookwriter.config import get_settings
from bookwriter.tools import web
from bookwriter.tools.web import PageDoc

PAGE = (
    "The Unified Payments Interface (UPI) was launched by NPCI in 2016. "
    "In August 2025, UPI processed over 20 billion transactions worth ₹24.85 lakh crore. "
    "Merchants pay no fee on UPI payments under the zero MDR policy."
)

# ------------------------------------------------------------------ quotes


def test_quote_found_verbatim_after_normalisation():
    r = web.find_quote(PAGE, "In August 2025, UPI processed over 20 billion transactions worth ₹24.85 lakh crore.")
    assert r["found"] and r["similarity"] == 1.0 and "zero mdr" in r["context"]  # context is normalised
    # curly quotes, dashes and spacing differences are tolerated
    assert web.find_quote("He said “UPI — fast”  and   free.", 'He said "UPI - fast" and free.')["found"]


def test_quote_near_match_tolerated_but_paraphrase_rejected():
    near = "In August 2025, UPI processed over 20 billion transactions worth ₹24.85 lakh crores."
    assert web.find_quote(PAGE, near)["found"]  # a slip at the end still leaves a >= 85% contiguous match
    gapped = "In August 2025, UPI processed over 20 billion transactions worth 24.85 lakh crore."
    assert not web.find_quote(PAGE, gapped)["found"]  # a break mid-quote splits the run below 85%
    para = web.find_quote(PAGE, "UPI handled more than twenty billion payments in August of 2025.")
    assert not para["found"] and para["similarity"] < 0.85


def test_quote_too_short_rejected():
    assert not web.find_quote(PAGE, "UPI")["found"]


# ------------------------------------------------------------------ fetch fallback


def doc(status: int, text: str = "") -> PageDoc:
    return PageDoc(
        "https://www.rbi.org.in/x",
        "https://www.rbi.org.in/x",
        status,
        status < 400,
        "",
        "",
        None,
        text,
        "text/html",
        time.time(),
        error=None if status < 400 else f"HTTP {status}",
    )


@pytest.fixture
def tavily(monkeypatch):
    """A fake Tavily client; `calls` records every extract request."""
    calls: list[list[str]] = []
    content = {"text": "Readable official page text. " * 30}

    class FakeClient:
        def __init__(self, api_key):
            pass

        async def extract(self, urls):
            calls.append(urls)
            return {"results": [{"url": urls[0], "raw_content": content["text"], "title": "RBI Notification"}]}

    import tavily as tavily_mod

    monkeypatch.setattr(tavily_mod, "AsyncTavilyClient", FakeClient)
    monkeypatch.setattr(get_settings(), "tavily_api_key", "test-key")
    return SimpleNamespace(calls=calls, content=content)


@pytest.mark.parametrize("status", [403, 406, 429])
async def test_bot_block_falls_back_to_extract(monkeypatch, tavily, status):
    async def blocked(url):
        return doc(status)

    monkeypatch.setattr(web, "_fetch_uncached", blocked)
    page = await web.fetch_page("https://www.rbi.org.in/x")
    assert page.ok and page.via == "extract" and page.title == "RBI Notification"
    assert tavily.calls == [["https://www.rbi.org.in/x"]]
    # readable pages are cached: a second read costs no Tavily credit
    again = await web.fetch_page("https://www.rbi.org.in/x")
    assert again.via == "extract" and len(tavily.calls) == 1


async def test_javascript_shell_falls_back_to_extract(monkeypatch, tavily):
    async def shell(url):
        return doc(200, "Loading...")

    monkeypatch.setattr(web, "_fetch_uncached", shell)
    page = await web.fetch_page("https://www.npci.org.in/x")
    assert page.ok and page.via == "extract" and len(page.text) >= web.MIN_TEXT_CHARS


async def test_not_found_does_not_use_extract(monkeypatch, tavily):
    async def gone(url):
        return doc(404)

    monkeypatch.setattr(web, "_fetch_uncached", gone)
    page = await web.fetch_page("https://www.rbi.org.in/missing")
    assert not page.ok and page.status == 404 and tavily.calls == []


async def test_unreadable_extract_is_not_cached(monkeypatch, tavily, isolated_data):
    tavily.content["text"] = "too short"

    async def blocked(url):
        return doc(403)

    monkeypatch.setattr(web, "_fetch_uncached", blocked)
    page = await web.fetch_page("https://www.rbi.org.in/x")
    assert not page.ok and page.via == "direct"
    assert not list((isolated_data / "cache" / "pages").glob("*.json"))


# ------------------------------------------------------------------ link checks


def mock_client(status: int) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(status)))


async def test_link_ok_on_success():
    async with mock_client(200) as c:
        r = await web.check_link("https://a.example", c)
    assert r["ok"] and r["via"] == "direct"


async def test_bot_blocked_link_counts_as_working_if_readable_via_extract(monkeypatch):
    async def readable(url, *, use_cache=True):
        page = doc(200, "Readable text. " * 40)
        page.via = "extract"
        return page

    monkeypatch.setattr(web, "fetch_page", readable)
    async with mock_client(403) as c:
        r = await web.check_link("https://www.rbi.org.in/x", c)
    assert r["ok"] and r["status"] == 403 and r["via"] == "extract"


async def test_dead_link_is_broken(monkeypatch):
    async def unreachable(url, *, use_cache=True):
        raise AssertionError("a 404 must not trigger the extract route")

    monkeypatch.setattr(web, "fetch_page", unreachable)
    async with mock_client(404) as c:
        r = await web.check_link("https://a.example/gone", c)
    assert not r["ok"] and r["status"] == 404


# ------------------------------------------------------------------ titles


@pytest.mark.parametrize(
    ("title", "url", "source", "expected"),
    [
        ("UPI hits a record | Reuters", "https://www.reuters.com/x", "Reuters", "UPI hits a record"),
        (
            "UPI crosses 20 billion - The Economic Times",
            "https://economictimes.indiatimes.com/x",
            "The Economic Times",
            "UPI crosses 20 billion",
        ),
        (
            "UPI Product Statistics | NPCI",
            "https://www.npci.org.in/x",
            "National Payments Corporation of India",
            "UPI Product Statistics",
        ),
        (
            "RBI raises UPI Lite limit - BusinessLine",
            "https://www.thehindubusinessline.com/x",
            "The Hindu BusinessLine",
            "RBI raises UPI Lite limit",
        ),
        ("UPI - the backbone of payments", "https://www.thehindu.com/x", "The Hindu", "UPI - the backbone of payments"),
        ("Press Information Bureau", "https://pib.gov.in/x", "Press Information Bureau", "Press Information Bureau"),
    ],
)
def test_clean_title(title, url, source, expected):
    assert web.clean_title(title, url, source) == expected
