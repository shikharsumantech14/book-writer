"""Web research primitives: search, fetch + extract, passage ranking,
quote verification and link checking.

These are plain async functions with no LLM involved. The research MCP server
exposes them as tools; the fact-checker also uses them for deterministic checks.
Fetched pages are cached on disk so re-runs are fast and reproducible.
"""

from __future__ import annotations

import asyncio
import hashlib
import io
import json
import re
import time
import unicodedata
from dataclasses import asdict, dataclass
from difflib import SequenceMatcher
from pathlib import Path
from urllib.parse import urlparse

import httpx
import trafilatura

from ..config import AppConfig, get_settings

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"
)
HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf;q=0.8,*/*;q=0.7",
    "Accept-Language": "en-IN,en;q=0.9",
}

KNOWN_PUBLISHERS = {
    "npci.org.in": "National Payments Corporation of India (NPCI)",
    "rbi.org.in": "Reserve Bank of India (RBI)",
    "pib.gov.in": "Press Information Bureau, Government of India",
    "meity.gov.in": "Ministry of Electronics and Information Technology",
    "finmin.nic.in": "Ministry of Finance, Government of India",
    "financialservices.gov.in": "Department of Financial Services, Ministry of Finance",
    "digitalindia.gov.in": "Digital India, Government of India",
    "msme.gov.in": "Ministry of Micro, Small and Medium Enterprises",
    "mygov.in": "MyGov, Government of India",
    "thehindu.com": "The Hindu",
    "indianexpress.com": "The Indian Express",
    "livemint.com": "Mint",
    "economictimes.indiatimes.com": "The Economic Times",
    "business-standard.com": "Business Standard",
    "hindustantimes.com": "Hindustan Times",
    "reuters.com": "Reuters",
    "bbc.com": "BBC News",
    "moneycontrol.com": "Moneycontrol",
    "thehindubusinessline.com": "The Hindu BusinessLine",
    "financialexpress.com": "The Financial Express",
}


# ----------------------------------------------------------------- domain helpers


def domain_of(url: str) -> str:
    host = (urlparse(url).hostname or "").lower()
    return host[4:] if host.startswith("www.") else host


def _matches(domain: str, candidates: list[str]) -> str | None:
    for c in candidates:
        if domain == c or domain.endswith("." + c):
            return c
    return None


def classify_source(url: str, cfg: AppConfig) -> str:
    d = domain_of(url)
    if _matches(d, cfg.sources.official_domains) or d.endswith(".gov.in") or d.endswith(".nic.in"):
        return "official"
    if _matches(d, cfg.sources.reputable_news_domains):
        return "news"
    return "other"


def is_blocked(url: str, cfg: AppConfig) -> bool:
    return _matches(domain_of(url), cfg.sources.blocked_domains) is not None


def publisher_for(url: str, fallback: str | None = None) -> str:
    d = domain_of(url)
    match = _matches(d, list(KNOWN_PUBLISHERS))
    return KNOWN_PUBLISHERS[match] if match else (fallback or d)


# ------------------------------------------------------------------------ search


async def search(query: str, cfg: AppConfig, *, official_only: bool = False, max_results: int = 6) -> list[dict]:
    """Web search via Tavily. `official_only` restricts to government/regulator domains."""
    key = get_settings().tavily_api_key
    if not key:
        raise RuntimeError("TAVILY_API_KEY is not set")
    from tavily import AsyncTavilyClient

    client = AsyncTavilyClient(api_key=key)
    kwargs: dict = {"max_results": max(1, min(max_results, 10)), "search_depth": "advanced"}
    if official_only:
        kwargs["include_domains"] = cfg.sources.official_domains
    else:
        kwargs["exclude_domains"] = cfg.sources.blocked_domains
    data = await client.search(query, **kwargs)
    results = []
    for r in data.get("results", []):
        url = r.get("url", "")
        if not url or is_blocked(url, cfg):
            continue
        results.append(
            {
                "title": r.get("title", ""),
                "url": url,
                "domain": domain_of(url),
                "source_type": classify_source(url, cfg),
                "snippet": (r.get("content") or "")[:400],
            }
        )
    return results


# ------------------------------------------------------------------------- fetch


@dataclass
class PageDoc:
    url: str
    final_url: str
    status: int | None
    ok: bool
    title: str
    site_name: str
    published: str | None
    text: str
    content_type: str
    fetched_at: float
    error: str | None = None
    via: str = "direct"  # "direct" (our HTTP client) or "extract" (Tavily Extract fallback)


def _cache_path(url: str) -> Path:
    h = hashlib.sha1(url.strip().encode()).hexdigest()
    d = get_settings().data_dir / "cache" / "pages"
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{h}.json"


_locks: dict[str, asyncio.Lock] = {}
MIN_TEXT_CHARS = 400  # below this a page is almost always a JS shell or an error page
# Status codes that usually mean "this client looks like a bot", not "this page is gone".
# Official sites (RBI, NPCI) answer plain HTTP clients this way while serving people normally.
BOT_BLOCK_STATUSES = {403, 406, 429}


def needs_extract(doc: PageDoc) -> bool:
    """Should we retry this page through Tavily Extract?"""
    if doc.ok:
        return len(doc.text) < MIN_TEXT_CHARS  # JavaScript shell or near-empty page
    return doc.status in BOT_BLOCK_STATUSES


def readable(doc: PageDoc) -> bool:
    return doc.ok and len(doc.text) >= MIN_TEXT_CHARS


async def fetch_page(url: str, *, use_cache: bool = True) -> PageDoc:
    """Fetch a URL and extract readable text (HTML via trafilatura, PDF via pypdf).

    Falls back to Tavily Extract for JavaScript shells and for anti-bot
    responses (403/406/429). Only readable pages are cached.
    """
    path = _cache_path(url)
    lock = _locks.setdefault(url, asyncio.Lock())
    async with lock:
        if use_cache and path.exists():
            return PageDoc(**json.loads(path.read_text(encoding="utf-8")))
        doc = await _fetch_uncached(url)
        if needs_extract(doc):
            doc = await _tavily_extract(url, doc) or doc
        if readable(doc):
            path.write_text(json.dumps(asdict(doc), ensure_ascii=False), encoding="utf-8")
        return doc


async def _fetch_uncached(url: str) -> PageDoc:
    now = time.time()
    try:
        async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True, timeout=30.0) as client:
            r = await client.get(url)
    except Exception as e:
        return PageDoc(url, url, None, False, "", "", None, "", "", now, error=f"{type(e).__name__}: {e}")

    ctype = r.headers.get("content-type", "").lower()
    base = PageDoc(url, str(r.url), r.status_code, r.status_code < 400, "", "", None, "", ctype, now)
    if not base.ok:
        base.error = f"HTTP {r.status_code}"
        return base

    if "pdf" in ctype or str(r.url).lower().endswith(".pdf"):
        base.text, base.title = _pdf_text(r.content)
        base.site_name = publisher_for(url)
        return base

    html = r.text
    text = trafilatura.extract(html, include_tables=True, include_comments=False, favor_recall=True) or ""
    meta = trafilatura.extract_metadata(html)
    base.text = text
    base.title = (meta.title if meta and meta.title else "") or _html_title(html)
    base.site_name = publisher_for(url, meta.sitename if meta else None)
    base.published = meta.date if meta and meta.date else None
    return base


def _pdf_text(content: bytes) -> tuple[str, str]:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(content))
    pages = [p.extract_text() or "" for p in reader.pages[:60]]
    title = ""
    if reader.metadata and reader.metadata.title:
        title = str(reader.metadata.title)
    return "\n\n".join(pages), title


def _html_title(html: str) -> str:
    m = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
    return re.sub(r"\s+", " ", m.group(1)).strip() if m else ""


async def _tavily_extract(url: str, doc: PageDoc) -> PageDoc | None:
    """Read the page through Tavily Extract. Returns the updated doc, or None if
    the extract route did no better than the direct fetch."""
    key = get_settings().tavily_api_key
    if not key:
        return None
    try:
        from tavily import AsyncTavilyClient

        data = await AsyncTavilyClient(api_key=key).extract(urls=[url])
    except Exception:
        return None
    results = data.get("results") or []
    text = (results[0].get("raw_content") or "") if results else ""
    if len(text) < MIN_TEXT_CHARS or len(text) <= len(doc.text):
        return None
    doc.text = text
    doc.title = doc.title or results[0].get("title") or ""
    doc.site_name = doc.site_name or publisher_for(url)
    doc.ok, doc.error, doc.via = True, None, "extract"
    return doc


# ------------------------------------------------------------------------ titles

_TITLE_SEPARATORS = re.compile(r"\s+(?:\||-|–|—|::|·)\s+")
# Short labels sites append to titles that don't spell out the publisher's name.
_SITE_LABELS = {"pib", "et", "etbfsi", "businessline", "bbcnews", "news", "latestnews", "home"}


def _squash(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def _is_site_label(segment: str, url: str, source_name: str) -> bool:
    seg = _squash(segment)
    if not seg:
        return True
    host = domain_of(url)
    stem = _squash(host.split(".")[0])
    names = {_squash(source_name), _squash(publisher_for(url))} - {""}
    return (
        seg in _SITE_LABELS
        or seg == _squash(host)
        or (len(stem) >= 3 and stem in seg)
        or any(len(n) >= 3 and (seg in n or n in seg) for n in names)
    )


def clean_title(title: str, url: str, source_name: str = "") -> str:
    """Drop site labels from a page title: "UPI hits a record | Reuters" -> "UPI hits a record".

    Only leading or trailing segments that name the site are removed, so a
    title like "UPI - the backbone of payments" keeps its dash.
    """
    title = re.sub(r"\s+", " ", title or "").strip()
    parts = _TITLE_SEPARATORS.split(title)
    seps = _TITLE_SEPARATORS.findall(title)
    while len(parts) > 1 and _is_site_label(parts[-1], url, source_name):
        parts.pop()
        seps.pop()
    while len(parts) > 1 and _is_site_label(parts[0], url, source_name):
        parts.pop(0)
        seps.pop(0)
    out = parts[0] + "".join(sep + part for sep, part in zip(seps, parts[1:], strict=True))
    return out.strip() or title


# ---------------------------------------------------------------------- passages

_WORD = re.compile(r"[a-z0-9]+")
_STOP = set("the a an and or of to in on for is are was were be by with as at from that this it its into than".split())


def _chunks(text: str, target_words: int = 110) -> list[str]:
    paras = [p.strip() for p in re.split(r"\n\s*\n|\n", text) if p.strip()]
    chunks, buf, count = [], [], 0
    for p in paras:
        w = len(p.split())
        if count and count + w > target_words:
            chunks.append(" ".join(buf))
            buf, count = [], 0
        buf.append(p)
        count += w
    if buf:
        chunks.append(" ".join(buf))
    return chunks


def top_passages(text: str, focus: str, k: int = 6) -> list[dict]:
    """Rank page chunks by overlap with the focus question; numbers get a boost
    because the research is mostly after facts and figures."""
    chunks = _chunks(text)
    terms = {t for t in _WORD.findall(focus.lower()) if t not in _STOP}
    scored = []
    for i, c in enumerate(chunks):
        words = _WORD.findall(c.lower())
        if not words:
            continue
        hits = sum(1 for w in words if w in terms)
        distinct = len(terms & set(words))
        digits = len(re.findall(r"\d", c))
        score = distinct * 3 + hits * 0.5 + min(digits, 20) * 0.15
        scored.append((score, i, c))
    best = sorted(scored, reverse=True)[:k]
    return [{"chunk": i, "text": c} for _, i, c in sorted(best, key=lambda x: x[1])]


# ------------------------------------------------------------------ verification


def normalize(s: str) -> str:
    s = unicodedata.normalize("NFKC", s).lower()
    s = s.translate(str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", " ": " "}))
    s = re.sub(r"[^\w%₹.,'\- ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def find_quote(text: str, quote: str) -> dict:
    """Does `quote` appear in `text`? Exact match after normalisation, else the
    longest common run must cover >= 85% of the quote (tolerates small
    punctuation/whitespace differences, rejects paraphrase)."""
    q, t = normalize(quote), normalize(text)
    if len(q) < 12:
        return {"found": False, "similarity": 0.0, "reason": "Quote too short to verify; copy a full sentence."}
    idx = t.find(q)
    if idx >= 0:
        return {"found": True, "similarity": 1.0, "context": t[max(0, idx - 200) : idx + len(q) + 200]}
    m = SequenceMatcher(None, q, t, autojunk=False).find_longest_match(0, len(q), 0, len(t))
    sim = m.size / len(q)
    if sim >= 0.85:
        start = m.b
        return {"found": True, "similarity": round(sim, 3), "context": t[max(0, start - 200) : start + len(q) + 200]}
    return {
        "found": False,
        "similarity": round(sim, 3),
        "reason": "Quote not found verbatim on the page. Copy the exact sentence from the page text.",
    }


# --------------------------------------------------------------------- link check


async def check_link(url: str, client: httpx.AsyncClient | None = None) -> dict:
    """A link is working if it answers HTTP < 400, or if it blocks bots (403/406/429)
    but the page is readable through the extract route, as it is for a person in a browser."""

    async def _do(c: httpx.AsyncClient) -> dict:
        try:
            r = await c.get(url)
            out = {"url": url, "ok": r.status_code < 400, "status": r.status_code, "final_url": str(r.url)}
            out |= {"error": None, "via": "direct"}
        except Exception as e:
            out = {"url": url, "ok": False, "status": None, "final_url": None}
            out |= {"error": f"{type(e).__name__}: {e}", "via": "direct"}
        if not out["ok"] and out["status"] in BOT_BLOCK_STATUSES:
            doc = await fetch_page(url)  # usually served from the cache the Researcher filled
            if readable(doc):
                out |= {"ok": True, "via": doc.via, "error": None}
        return out

    if client:
        return await _do(client)
    async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True, timeout=30.0) as c:
        return await _do(c)


async def check_links(urls: list[str]) -> list[dict]:
    async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True, timeout=30.0) as c:
        return list(await asyncio.gather(*(check_link(u, c) for u in dict.fromkeys(urls))))
