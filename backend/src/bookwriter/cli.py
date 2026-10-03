"""Command line: `bookwriter run | report | replay | serve | graph | mcp`."""

from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime
from pathlib import Path

import typer
from rich.console import Console
from rich.table import Table

from .config import get_settings, load_config

app = typer.Typer(no_args_is_help=True, add_completion=False, help="Multi-agent book writer.")
console = Console(record=True)  # record=True: `--svg` can save what was printed

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
    # Model and tool calls are detail: one dim line each, cut to the terminal width.
    if kind == "llm_call":
        tokens = d["input_tokens"] + d["cache_read_tokens"] + d["cache_write_tokens"]
        line = f"{d['model']} {d.get('effort') or ''}  {tokens:,} in / {d['output_tokens']:,} out  ${d['cost_usd']:.4f}"
        console.print(f"[dim]{when} {where:<5} {agent:<13} {line}[/dim]", highlight=False, no_wrap=True)
    elif kind in ("tool_call", "source_read"):
        console.print(
            f"[dim]{when} {where:<5} {agent:<13} {e['message']}[/dim]",
            highlight=False,
            no_wrap=True,
            overflow="ellipsis",
        )
    else:
        message = " ".join(e["message"].split())  # model text can carry newlines; the log is one line per event
        console.print(f"{when} {where:<5} [{style}]{agent:<13}[/{style}] {message}", highlight=False)


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


def _save_svg(path: Path, title: str) -> None:
    """Save everything printed so far as a terminal-style SVG (LF line endings on every OS)."""
    path.write_text(console.export_svg(title=title), encoding="utf-8", newline="\n")


def _print_scorecard(card: dict | None) -> None:
    if not card:
        console.print("[red]No scorecard: the run produced no chapters.[/red]")
        return
    verdict = "[green]PASSED[/green]" if card["passed"] else "[red]FAILED[/red]"
    console.print(f"\nScorecard: {verdict}" + (" (partial run)" if card.get("partial_run") else ""))
    for ch in card["chapters"]:
        m = ch["metrics"]
        failed = [c for c in ch["checks"] if not c["passed"]]
        r = m["rounds"] or {}
        approved = "[green]approved[/green]" if m["editor_approved"] else "[yellow]not approved[/yellow]"
        console.print(f"  Chapter {ch['number']}: {ch['title']}", highlight=False)
        console.print(
            f"    {m['word_count']} words · {m['references']} references ({m['official_sources']} official) · "
            f"{m['claims_supported']}/{m['claims_checked']} claims supported · editor {approved} · "
            f"{r.get('writer_passes', 0)} writer passes, {r.get('editor_rounds', 0)} editor reviews, "
            f"{r.get('fact_check_rounds', 0)} fact-checks"
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

    from . import store
    from .estimate import estimate

    reports = [r for d in store.run_dirs().values() if (r := store.read_report(d))]
    est = estimate(cfg.profile, chapters or cfg.brief.chapters, reports)
    console.print(
        f"Estimated cost: [bold]${est['estimate_usd']:.2f}[/bold] "
        f"(${est['low_usd']:.2f}-${est['high_usd']:.2f}, {est['basis']})"
    )
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
def report(
    run: str = typer.Argument(..., help="A run id (folder under data/runs) or a path to a run_report.json."),
    svg: Path = typer.Option(None, help="Also save the output as a terminal-style SVG image."),
) -> None:
    """Print the cost breakdown and scorecard of a finished run."""
    path = Path(run) if run.endswith(".json") else get_settings().data_dir / "runs" / run / "run_report.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    console.print(f"Run {data['run_id']}: {data['status']} on '{data['profile']}', {data['duration_s']:.0f}s")
    _print_usage(data["usage"])
    _print_scorecard(data["scorecard"])
    if svg:
        _save_svg(svg, f"bookwriter report {data['run_id']}")


@app.command()
def graph(
    readme: Path = typer.Option(None, help="Rewrite the generated diagram block in this Markdown file instead."),
) -> None:
    """Print the agent graph as Mermaid, generated from the LangGraph graph itself."""
    from .graph import mermaid, sync_diagram

    if readme is None:
        print(mermaid())
        return
    readme.write_text(sync_diagram(readme.read_text(encoding="utf-8")), encoding="utf-8", newline="\n")
    console.print(f"Updated the agent graph in {readme}")


@app.command()
def replay(
    run: str = typer.Argument(..., help="A run id, a run folder, or a path to an events.jsonl."),
    speed: float = typer.Option(20.0, min=0.1, help="Replay this many times faster than the original run."),
    limit: int = typer.Option(None, min=1, help="Stop after this many events."),
    quiet: bool = typer.Option(False, "--quiet", help="Show agent steps only, not each model and tool call."),
    svg: Path = typer.Option(None, help="Also save the output as a terminal-style SVG image."),
) -> None:
    """Replay a recorded run in the terminal, with its original pacing (no API calls, no cost)."""
    from . import store
    from .events import read_events

    path = Path(run)
    if path.suffix == ".jsonl":
        events = read_events(path)
    else:
        run_dir = path if path.is_dir() else store.find_run(run)
        if run_dir is None:
            raise typer.BadParameter(f"No run {run}.")
        events = store.events(run_dir)
    if quiet:
        events = [e for e in events if e["kind"] not in ("llm_call", "tool_call", "source_read", "evidence_added")]
    previous = None
    for e in events[:limit]:
        if previous is not None:
            time.sleep(min((e["ts"] - previous) / speed, 2.0))
        previous = e["ts"]
        _print_event(e)
    if svg:
        _save_svg(svg, "bookwriter run (replayed)")


@app.command()
def serve(
    host: str = typer.Option("127.0.0.1", help="Interface to listen on."),
    port: int = typer.Option(8000, help="Port to listen on."),
) -> None:
    """Run the HTTP API for the dashboard (docs at http://localhost:8000/docs)."""
    import uvicorn

    uvicorn.run("bookwriter.api.app:app", host=host, port=port)


@app.command()
def mcp(server: str = typer.Argument("research", help="Which MCP server to run over stdio.")) -> None:
    """Run an MCP server over stdio (for Claude Desktop, Claude Code or any MCP host)."""
    if server != "research":
        raise typer.BadParameter("Only the 'research' server exists.")
    from .mcp_servers.research import main

    main()


if __name__ == "__main__":
    app()
