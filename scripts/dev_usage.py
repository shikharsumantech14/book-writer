"""Measure the tokens (and API-equivalent cost) spent *building* this project.

Reads the Claude Code session transcripts for this project directory, sums the
`usage` block of every assistant message (deduplicated by message id), prices
it at Anthropic list prices, and writes docs/DEV_COST.md.

    uv run --project backend python scripts/dev_usage.py
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TRANSCRIPTS = Path.home() / ".claude" / "projects" / "D--SideProjects-Patel-Group"

# USD per 1M tokens: input, output. Cache writes bill at 1.25x input, reads at 0.1x.
PRICES = {
    "claude-opus-5-5": (4.0, 20.0),
    "claude-sonnet-5-5": (2.0, 10.0),
    "claude-haiku-4-5": (1.0, 5.0),
}


def main() -> None:
    files = sorted(TRANSCRIPTS.rglob("*.jsonl"))
    if not files:
        sys.exit(f"No transcripts found in {TRANSCRIPTS}")

    per_msg: dict[str, tuple[str, dict]] = {}
    first_ts, last_ts = None, None
    for f in files:
        for line in f.read_text(encoding="utf-8", errors="ignore").splitlines():
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            msg = rec.get("message") or {}
            usage = msg.get("usage")
            if rec.get("type") != "assistant" or not usage or not msg.get("id"):
                continue
            per_msg[msg["id"]] = (msg.get("model", "unknown"), usage)  # last write wins (streamed duplicates)
            ts = rec.get("timestamp")
            if ts:
                first_ts = min(first_ts or ts, ts)
                last_ts = max(last_ts or ts, ts)

    totals: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    peak_context = 0
    for model, u in per_msg.values():
        peak_context = max(
            peak_context,
            (u.get("input_tokens", 0) or 0)
            + (u.get("cache_creation_input_tokens", 0) or 0)
            + (u.get("cache_read_input_tokens", 0) or 0),
        )
        t = totals[model]
        t["calls"] += 1
        t["input"] += u.get("input_tokens", 0) or 0
        t["cache_write"] += u.get("cache_creation_input_tokens", 0) or 0
        t["cache_read"] += u.get("cache_read_input_tokens", 0) or 0
        t["output"] += u.get("output_tokens", 0) or 0

    rows, grand = [], defaultdict(float)
    for model, t in sorted(totals.items()):
        pin, pout = PRICES.get(model, (0.0, 0.0))
        cost = (
            t["input"] * pin + t["cache_write"] * pin * 1.25 + t["cache_read"] * pin * 0.1 + t["output"] * pout
        ) / 1e6
        rows.append((model, t, cost))
        for k, v in t.items():
            grand[k] += v
        grand["cost"] += cost

    total_tokens = grand["input"] + grand["cache_write"] + grand["cache_read"] + grand["output"]
    md = [
        "# Development cost",
        "",
        "Tokens spent by Claude Code building this project, measured from the session transcripts "
        "(`scripts/dev_usage.py`). Cost is the API-list-price equivalent; the work actually ran on a "
        "Claude subscription plan, so no per-token charge was incurred.",
        "",
        "Why cumulative tokens are much larger than the context window: the model is stateless, so every "
        "step re-sends the whole conversation. The context window is the size of one request; the totals "
        "below are the sum over all requests. Repeated context is served from the prompt cache at ~0.1x price.",
        "",
        f"_Generated {datetime.now(UTC):%Y-%m-%d %H:%M} UTC · sessions from {first_ts} to {last_ts}_",
        "",
        "| Model | Calls | Input | Cache write | Cache read | Output | API-equivalent cost |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    for model, t, cost in rows:
        md.append(
            f"| {model} | {int(t['calls'])} | {int(t['input']):,} | {int(t['cache_write']):,} | "
            f"{int(t['cache_read']):,} | {int(t['output']):,} | ${cost:,.2f} |"
        )
    md.append(
        f"| **Total** | {int(grand['calls'])} | {int(grand['input']):,} | {int(grand['cache_write']):,} | "
        f"{int(grand['cache_read']):,} | {int(grand['output']):,} | **${grand['cost']:,.2f}** |"
    )
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
    out.write_text("\n".join(md), encoding="utf-8")
    print("\n".join(md))


if __name__ == "__main__":
    main()
