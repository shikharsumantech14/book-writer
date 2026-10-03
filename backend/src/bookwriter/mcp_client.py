"""MCP client side: connect to the research MCP server and expose its tools to
our agents as `ToolSpec`s.

By default the server runs as a separate process over stdio, exactly as Claude
Desktop or any other MCP host would run it. `transport="inprocess"` connects to
the same server object in memory (used by tests).
"""

from __future__ import annotations

import os
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any, Literal

from mcp.client import Client
from mcp.client.stdio import StdioServerParameters

from .config import BACKEND_ROOT
from .llm import ToolSpec


class ResearchMCP:
    """A live MCP session plus helpers to call tools directly from code."""

    def __init__(self, client: Client, tools: list[Any]):
        self.client = client
        self._tools = tools

    def tool_specs(self, include: set[str] | None = None) -> list[ToolSpec]:
        specs = []
        for t in self._tools:
            if include and t.name not in include:
                continue
            specs.append(
                ToolSpec(
                    name=t.name,
                    description=t.description or "",
                    input_schema=t.input_schema,
                    handler=self._handler(t.name),
                )
            )
        return specs

    def _handler(self, name: str):
        async def call(args: dict[str, Any]) -> str:
            return await self.call(name, args)

        return call

    async def call(self, name: str, args: dict[str, Any]) -> str:
        result = await self.client.call_tool(name, args)
        text = "\n".join(c.text for c in result.content if getattr(c, "type", None) == "text")
        if result.is_error:
            raise RuntimeError(text or f"MCP tool {name} failed")
        return text


@asynccontextmanager
async def connect_research(transport: Literal["stdio", "inprocess"] = "stdio") -> AsyncIterator[ResearchMCP]:
    if transport == "inprocess":
        from .mcp_servers.research import mcp as server

        target: Any = server
    else:
        target = StdioServerParameters(
            command=sys.executable,
            args=["-m", "bookwriter.mcp_servers.research"],
            cwd=str(BACKEND_ROOT),
            env=dict(os.environ),
        )
    async with Client(target, read_timeout_seconds=120) as client:
        tools = (await client.list_tools()).tools
        yield ResearchMCP(client, tools)
