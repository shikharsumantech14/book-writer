"""bookwriter: a multi-agent system that researches and writes a cited three-chapter book.

Layers: agents/ (the six agents), checks/ (deterministic lint), tools/ + mcp_servers/ (web research
exposed over MCP), llm.py (the one place that talks to Claude), render.py (book output),
graph.py + runner.py (the agent graph and how a run is recorded), api/ (the HTTP service).
"""

from importlib.metadata import version

__version__ = version("bookwriter")
