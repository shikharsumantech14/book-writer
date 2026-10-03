"""Command line: `bookwriter run`, `bookwriter report`, `bookwriter graph`, `bookwriter mcp`."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime

import typer
from rich.console import Console
from rich.table import Table

from .config import get_settings, load_config

app = typer.Typer(no_args_is_help=True, add_completion=False, help="Multi-agent book writer.")
console = Console()

AGENT_STYLE = {
    "planner": "magenta",
    "researcher": "cyan",
    "writer": "green",
    "lint": "white",
    "editor": "yellow",
    "claim_tagger": "bright_black",
    "fact_checker": "red",
    "safety_net": "bright_red",
    "chief_editor": "blue",
    "assembler": "bright_blue",
}


def _print_event(e: dict) -> None:
    kind, d = e["kind"], e.get("data") or {}
    when = datetime.fromtimestamp(e["ts"]).strftime("%H:%M:%S")
    where = f"ch{e['chapter']}" if e.get("chapter") else "book"
    agent = e.get("agent") or "run"
    style = AGENT_STYLE.get(agent, "bold")
    if kind == "llm_call":
        tokens = d["input_tokens"] + d["cache_read_tokens"] + d["cache_write_tokens"]
        line = f"{d['model']} {d.get('effort') or ''}  {tokens:,} in / {d['output_tokens']:,} out  ${d['cost_usd']:.4f}"
        console.print(f"[dim]{when} {where:<5} {agent:<13} {line}[/dim]", highlight=False)
    elif kind == "tool_call":
        console.print(f"[dim]{when} {where:<5} {agent:<13} {e['message']}[/dim]", highlight=False)
    else:
        console.print(f"{when} {where:<5} [{style}]{agent:<13}[/{style}] {e['message']}", highlight=False)


def _print_usage(usage: dict) -> None:
    table = Table(title="Cost per agent", title_justify="left")
    for col in ("Agent", "Calls", "Input", "Cache read", "Cache write", "Output", "Cost (USD)"):
        table.add_column(col, justify="left" if col == "Agent" else "right")
    rows = [*usage["by_agent"].items(), ("total", usage["total"])]
    for name, b in rows:
        table.add_row(
            name,
            str(b["calls"]),
            f"{b['input_tokens']:,}",
            f"{b['cache_read_tokens']:,}",
            f"{b['cache_write_tokens']:,}",
            f"{b['output_tokens']:,}",
            f"${b['cost_usd']:.4f}",
            style="bold" if name == "total" else None,
        )
    console.print(table)
    t = usage["tavily"]
    console.print(
        f"Cache reads: {usage['cache_read_share']:.0%} of prompt tokens · Tavily: {t['searches']} searches, "
        f"{t['extract_reads']} extract reads (~{t['credits_estimate']} credits)"
    )


def _print_scorecard(card: dict | None) -> None:
    if not card:
        console.print("[red]No scorecard: the run produced no chapters.[/red]")
        return
    verdict = "[green]PASSED[/green]" if card["passed"] else "[red]FAILED[/red]"
    console.print(f"\nScorecard: {verdict}" + (" (partial run)" if card.get("partial_run") else ""))
    for ch in card["chapters"]:
        m = ch["metrics"]
        failed = [c for c in ch["checks"] if not c["passed"]]
        console.print(
            f"  Chapter {ch['number']} '{ch['title']}': {m['word_count']} words, {m['references']} refs "
            f"({m['official_sources']} official), {m['claims_supported']}/{m['claims_checked']} claims supported, "
            f"editor approved: {m['editor_approved']}, rounds: {m['rounds']}"
        )
        for c in failed:
            console.print(f"    [red]x {c['rule']}[/red]: {c['detail']}")
        for w in ch["warnings"]:
            console.print(f"    [yellow]! {w}[/yellow]")


@app.command()
def run(
    profile: str = typer.Option(None, help="Routing profile from config.yaml: 'dev' or 'showcase'."),
    chapters: int = typer.Option(None, min=1, help="Write only the first N planned chapters (debug runs)."),
    max_cost: float = typer.Option(None, help="Stop the run at this spend in USD (default: config run.max_cost_usd)."),
    parallel: int = typer.Option(None, min=1, help="Chapters worked on at once (default: config)."),
) -> None:
    """Research and write the book, streaming agent activity to the terminal."""
    from .runner import run_book

    cfg = load_config(profile=profile)
    settings = get_settings()
    missing = [k for k in ("anthropic_api_key", "tavily_api_key") if not getattr(settings, k)]
    if missing:
        console.print(f"[red]Missing in backend/.env: {', '.join(k.upper() for k in missing)}[/red]")
        raise typer.Exit(2)

    result = asyncio.run(
        run_book(cfg, chapters=chapters, max_cost_usd=max_cost, parallel_chapters=parallel, on_event=_print_event)
    )
    console.print()
    _print_usage(result.report["usage"])
    _print_scorecard(result.report["scorecard"])
    console.print(f"\nRun folder: {result.run_dir}")
    if result.status != "completed":
        console.print(f"[red]Run {result.status}: {result.report['error']}[/red]")
        raise typer.Exit(1)


@app.command()
def report(run_id: str = typer.Argument(..., help="Run id (a folder name under data/runs).")) -> None:
    """Print the cost breakdown and scorecard of a finished run."""
    path = get_settings().data_dir / "runs" / run_id / "run_report.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    console.print(f"Run {run_id}: {data['status']} on '{data['profile']}', {data['duration_s']:.0f}s")
    _print_usage(data["usage"])
    _print_scorecard(data["scorecard"])


@app.command()
def graph() -> None:
    """Print the agent graph as Mermaid, generated from the LangGraph graph itself."""
    from .graph import mermaid

    print(mermaid())


@app.command()
def mcp(server: str = typer.Argument("research", help="Which MCP server to run over stdio.")) -> None:
    """Run an MCP server over stdio (for Claude Desktop, Claude Code or any MCP host)."""
    if server != "research":
        raise typer.BadParameter("Only the 'research' server exists.")
    from .mcp_servers.research import main

    main()


if __name__ == "__main__":
    app()
