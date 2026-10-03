"""Measure the tokens (and API-equivalent cost) spent *building* this project.

Reads the Claude Code session transcripts for this project directory, sums the
`usage` block of every assistant message (deduplicated by message id), prices
it with the same `bookwriter.pricing` module and config.yaml prices the
runtime uses, and writes docs/DEV_COST.md broken down by session and by model.
A model without a price entry stops the script instead of counting as $0.

    uv run --project backend python scripts/dev_usage.py
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path

from bookwriter.pricing import canonical, cost_usd, load_prices

ROOT = Path(__file__).resolve().parents[1]
TRANSCRIPTS = Path.home() / ".claude" / "projects" / "D--SideProjects-Patel-Group"
KINDS = ("input", "cache_write", "cache_read", "output")
SKIP_MODELS = {"<synthetic>"}  # client-side placeholder messages, never billed


def _bucket() -> dict[str, float]:
    return defaultdict(float)


def _cost(model: str, t: dict, prices) -> float:
    return cost_usd(
        model,
        prices,
        input_tokens=t["input"],
        output_tokens=t["output"],
        cache_read_tokens=t["cache_read"],
        cache_write_tokens=t["cache_write"],
    )


def main() -> None:
    files = sorted(TRANSCRIPTS.rglob("*.jsonl"))
    if not files:
        sys.exit(f"No transcripts found in {TRANSCRIPTS}")
    prices = load_prices()

    per_msg: dict[str, tuple[str, str, dict, str]] = {}  # message id -> (session, model, usage, timestamp)
    titles: dict[str, str] = {}
    for f in files:
        for line in f.read_text(encoding="utf-8", errors="ignore").splitlines():
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            session = rec.get("sessionId") or f.stem
            if rec.get("customTitle"):
                titles[session] = rec["customTitle"]
            msg = rec.get("message") or {}
            usage = msg.get("usage")
            if rec.get("type") != "assistant" or not usage or not msg.get("id"):
                continue
            model = canonical(msg.get("model", "unknown"))
            if model in SKIP_MODELS:
                continue
            # Streamed responses repeat the same id; the last record carries the final usage.
            per_msg[msg["id"]] = (session, model, usage, rec.get("timestamp", ""))

    by_model: dict[str, dict] = defaultdict(_bucket)
    by_session: dict[str, dict] = defaultdict(_bucket)
    session_models: dict[str, set[str]] = defaultdict(set)
    session_span: dict[str, list[str]] = {}
    peak_context = 0
    for session, model, u, ts in per_msg.values():
        t = {
            "input": u.get("input_tokens", 0) or 0,
            "cache_write": u.get("cache_creation_input_tokens", 0) or 0,
            "cache_read": u.get("cache_read_input_tokens", 0) or 0,
            "output": u.get("output_tokens", 0) or 0,
        }
        peak_context = max(peak_context, t["input"] + t["cache_write"] + t["cache_read"])
        cost = _cost(model, t, prices)  # raises UnknownModelError for an unpriced model
        for b in (by_model[model], by_session[session]):
            b["calls"] += 1
            b["cost"] += cost
            for k in KINDS:
                b[k] += t[k]
        session_models[session].add(model)
        if ts:
            span = session_span.setdefault(session, [ts, ts])
            span[0], span[1] = min(span[0], ts), max(span[1], ts)

    grand = _bucket()
    for b in by_model.values():
        for k, v in b.items():
            grand[k] += v

    def row(label: str, b: dict) -> str:
        return (
            f"| {label} | {int(b['calls'])} | {int(b['input']):,} | {int(b['cache_write']):,} | "
            f"{int(b['cache_read']):,} | {int(b['output']):,} | ${b['cost']:,.2f} |"
        )

    header = [
        "| {} | Calls | Input | Cache write | Cache read | Output | API-equivalent cost |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    total_row = (
        f"| **Total** | {int(grand['calls'])} | {int(grand['input']):,} | {int(grand['cache_write']):,} | "
        f"{int(grand['cache_read']):,} | {int(grand['output']):,} | **${grand['cost']:,.2f}** |"
    )
    sessions = sorted(by_session, key=lambda s: session_span.get(s, ["", ""])[0])
    first = min((v[0] for v in session_span.values()), default="?")
    last = max((v[1] for v in session_span.values()), default="?")

    md = [
        "# Development cost",
        "",
        "Tokens spent by Claude Code building this project, measured from the session transcripts "
        "(`scripts/dev_usage.py`) and priced with the same `pricing.py` and `config.yaml` prices the "
        "runtime uses. Cost is the API-list-price equivalent; the work ran on a Claude subscription "
        "plan, so no per-token charge was incurred.",
        "",
        "Why cumulative tokens are much larger than the context window: the model is stateless, so every "
        "step re-sends the whole conversation. The context window is the size of one request; the totals "
        "below are the sum over all requests. Repeated context is served from the prompt cache at a "
        "fraction of the input price (0.05x on Opus 5.5, 0.025x on Fable 5.1).",
        "",
        f"_Generated {datetime.now(UTC):%Y-%m-%d %H:%M} UTC · sessions from {first} to {last}_",
        "",
        "## By session",
        "",
        header[0].format("Session"),
        header[1],
    ]
    for s in sessions:
        label = f"{titles.get(s, s[:8])} ({', '.join(sorted(session_models[s]))})"
        md.append(row(label, by_session[s]))
    md += [total_row, "", "## By model", "", header[0].format("Model"), header[1]]
    for model in sorted(by_model):
        md.append(row(model, by_model[model]))
    md.append(total_row)

    total_tokens = sum(grand[k] for k in KINDS)
    cache_share = grand["cache_read"] / max(1, total_tokens)
    md += [
        "",
        f"Model calls: **{int(grand['calls'])}** · Peak context in a single call: **{peak_context:,}** tokens",
        f"Total tokens processed (sum over all calls): **{int(total_tokens):,}**, "
        f"of which {cache_share:.0%} were cheap cache reads.",
        "",
    ]

    out = ROOT / "docs" / "DEV_COST.md"
    out.parent.mkdir(exist_ok=True)
    out.write_text("\n".join(md), encoding="utf-8", newline="\n")
    print("\n".join(md))


if __name__ == "__main__":
    main()
