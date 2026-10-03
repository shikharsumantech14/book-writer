"""Pre-run cost estimate: measured history first, a prior from the first measured runs before that.

A book's cost has a fixed part (Planner and Chief Editor run once per book) and a
part that grows with the number of chapters (everything else runs per chapter).
"""

from __future__ import annotations

from statistics import median

BOOK_LEVEL_AGENTS = ("planner", "chief_editor")
# (fixed USD, USD per chapter), from the first full runs on each profile (see README, "Cost and tokens").
PRIOR = {"dev": (0.07, 0.51), "showcase": (0.26, 0.89)}


def split_cost(report: dict) -> tuple[float, float]:
    """A finished run's cost as (fixed, per chapter)."""
    by_agent = report["usage"]["by_agent"]
    fixed = sum(by_agent.get(a, {}).get("cost_usd", 0.0) for a in BOOK_LEVEL_AGENTS)
    per_chapter = (report["usage"]["total"]["cost_usd"] - fixed) / max(1, report["chapters_requested"])
    return fixed, per_chapter


def estimate(profile: str, chapters: int, reports: list[dict]) -> dict:
    history = [split_cost(r) for r in reports if r.get("profile") == profile and r.get("status") == "completed"]
    if history:
        totals = [f + p * chapters for f, p in history]
        fixed, per = median(f for f, _ in history), median(p for _, p in history)
        low, high = min(totals), max(totals)
        basis = f"median of {len(history)} measured {profile} run(s)"
    else:
        fixed, per = PRIOR.get(profile, PRIOR["showcase"])
        low, high = 0.7 * (fixed + per * chapters), 1.4 * (fixed + per * chapters)
        basis = "first measured runs (no history yet)"
    return {
        "profile": profile,
        "chapters": chapters,
        "estimate_usd": round(fixed + per * chapters, 2),
        "low_usd": round(low, 2),
        "high_usd": round(high, 2),
        "basis": basis,
    }
