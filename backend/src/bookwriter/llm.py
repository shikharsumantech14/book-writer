"""The one place that talks to Claude.

* Role-based model routing: each agent asks for a *role*; config.yaml maps the
  role to a model tier (strong / balanced / fast) and an effort level.
* Structured outputs: `structured()` returns a validated Pydantic object.
* Tool use: `agent_loop()` runs a bounded tool-calling loop over `ToolSpec`s,
  which can wrap MCP tools or local Python functions alike.
* Accounting: every call emits an `llm_call` event with tokens and cost.
"""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, TypeVar

import anthropic
from pydantic import BaseModel

from .config import AppConfig, Role, get_settings
from .events import emit

T = TypeVar("T", bound=BaseModel)

# USD per 1M tokens (input, output). Cache reads/writes are approximated as input.
PRICING: dict[str, tuple[float, float]] = {
    "claude-opus-5-5": (4.0, 20.0),
    "claude-sonnet-5-5": (2.0, 10.0),
    "claude-haiku-4-5": (1.0, 5.0),
}

# Models that support the server-side refusal fallback ("default" routing).
FALLBACK_MODELS = {"claude-opus-5-5", "claude-sonnet-5-5", "claude-opus-5", "claude-fable-5-1"}
FALLBACK_BETA = "server-side-fallback-2026-07-01"
# Haiku 4.5 does not take `output_config.effort`.
NO_EFFORT_MODELS = {"claude-haiku-4-5"}


class LLMError(RuntimeError):
    pass


@dataclass
class ToolSpec:
    """A tool the model may call. `handler` receives the parsed input dict."""

    name: str
    description: str
    input_schema: dict[str, Any]
    handler: Callable[[dict[str, Any]], Awaitable[str]]

    def to_param(self) -> dict[str, Any]:
        return {"name": self.name, "description": self.description, "input_schema": self.input_schema}


@dataclass
class LoopResult:
    final_text: str
    tool_calls: int
    turns: int
    stopped_by_budget: bool


def _cost(model: str, usage: Any) -> float:
    pin, pout = PRICING.get(model, (0.0, 0.0))
    inp = (
        (usage.input_tokens or 0)
        + (getattr(usage, "cache_read_input_tokens", 0) or 0) * 0.1
        + (getattr(usage, "cache_creation_input_tokens", 0) or 0) * 1.25
    )
    return (inp * pin + (usage.output_tokens or 0) * pout) / 1_000_000


class LLM:
    def __init__(self, cfg: AppConfig, client: anthropic.AsyncAnthropic | None = None):
        self.cfg = cfg
        settings = get_settings()
        self.client = client or anthropic.AsyncAnthropic(
            api_key=settings.anthropic_api_key, max_retries=4, timeout=600.0
        )

    # ------------------------------------------------------------------ helpers

    def _params(self, role: Role) -> dict[str, Any]:
        model, effort = self.cfg.model_for(role)
        params: dict[str, Any] = {"model": model}
        if effort and model not in NO_EFFORT_MODELS:
            params["output_config"] = {"effort": effort}
        if model in FALLBACK_MODELS:
            params["betas"] = [FALLBACK_BETA]
            params["fallbacks"] = "default"
        return params

    def _account(self, role: Role, model: str, response: Any, started: float, chapter: int | None) -> None:
        u = response.usage
        emit(
            "llm_call",
            f"{role} → {model}",
            agent=role,
            chapter=chapter,
            model=response.model or model,
            input_tokens=u.input_tokens,
            output_tokens=u.output_tokens,
            cache_read_tokens=getattr(u, "cache_read_input_tokens", 0) or 0,
            cost_usd=round(_cost(model, u), 5),
            latency_s=round(time.time() - started, 2),
            stop_reason=response.stop_reason,
        )

    @staticmethod
    def _check_stop(response: Any) -> None:
        if response.stop_reason == "refusal":
            details = getattr(response, "stop_details", None)
            raise LLMError(f"Model refused the request: {getattr(details, 'explanation', '')}")
        if response.stop_reason == "max_tokens":
            raise LLMError("Model hit max_tokens before finishing; output truncated.")

    # ---------------------------------------------------------------- structured

    async def structured(
        self,
        role: Role,
        *,
        system: str,
        user: str,
        output: type[T],
        max_tokens: int = 16000,
        chapter: int | None = None,
        attempts: int = 2,
    ) -> T:
        """One call, one validated Pydantic object back."""
        params = self._params(role)
        last_err: Exception | None = None
        for _ in range(attempts):
            started = time.time()
            try:
                response = await self.client.beta.messages.parse(
                    max_tokens=max_tokens,
                    system=system,
                    messages=[{"role": "user", "content": user}],
                    output_format=output,
                    **params,
                )
            except anthropic.BadRequestError:
                raise  # our bug, retrying won't help
            self._account(role, params["model"], response, started, chapter)
            try:
                self._check_stop(response)
                if response.parsed_output is None:
                    raise LLMError("No structured output returned.")
                return response.parsed_output
            except (LLMError, ValueError) as e:
                last_err = e
        raise LLMError(f"{role}: structured call failed: {last_err}")

    # ------------------------------------------------------------------- tool loop

    async def agent_loop(
        self,
        role: Role,
        *,
        system: str,
        user: str,
        tools: list[ToolSpec],
        max_tool_calls: int,
        chapter: int | None = None,
        max_tokens: int = 16000,
    ) -> LoopResult:
        """Bounded agentic loop: the model chooses tools until it is done or out of budget.

        History is append-only (assistant content is echoed back unchanged), and
        parallel tool calls are executed concurrently and returned in one message.
        """
        params = self._params(role)
        by_name = {t.name: t for t in tools}
        messages: list[dict[str, Any]] = [{"role": "user", "content": user}]
        calls = turns = 0
        budget_hit = False

        while True:
            turns += 1
            started = time.time()
            response = await self.client.beta.messages.create(
                max_tokens=max_tokens,
                system=system,
                tools=[t.to_param() for t in tools],
                messages=messages,
                # Auto-cache the growing prefix: each turn re-sends the history,
                # so this turns most loop input into 0.1x-priced cache reads.
                cache_control={"type": "ephemeral"},
                **params,
            )
            self._account(role, params["model"], response, started, chapter)
            if response.stop_reason == "refusal":
                self._check_stop(response)

            messages.append({"role": "assistant", "content": response.content})
            if response.stop_reason == "pause_turn":
                continue

            tool_uses = [b for b in response.content if b.type == "tool_use"]
            if not tool_uses:
                text = "".join(b.text for b in response.content if b.type == "text")
                return LoopResult(text, calls, turns, budget_hit)

            if budget_hit:  # model ignored the stop instruction; end it here
                return LoopResult("", calls, turns, True)

            async def run(block: Any) -> dict[str, Any]:
                nonlocal calls
                calls += 1
                tool = by_name.get(block.name)
                if tool is None:
                    return _tool_result(block.id, f"Unknown tool '{block.name}'.", error=True)
                if calls > max_tool_calls:
                    return _tool_result(
                        block.id, "Tool budget exhausted. Stop calling tools and finish now.", error=True
                    )
                emit(
                    "tool_call",
                    f"{block.name}({_preview(block.input)})",
                    agent=role,
                    chapter=chapter,
                    tool=block.name,
                    input=block.input,
                )
                try:
                    out = await tool.handler(dict(block.input))
                    return _tool_result(block.id, out)
                except Exception as e:  # tool failures go back to the model, not up the stack
                    emit("tool_error", f"{block.name} failed: {e}", agent=role, chapter=chapter, tool=block.name)
                    return _tool_result(block.id, f"Error: {e}", error=True)

            results = await asyncio.gather(*(run(b) for b in tool_uses))
            budget_hit = calls >= max_tool_calls
            messages.append({"role": "user", "content": list(results)})


def _tool_result(tool_use_id: str, content: str, *, error: bool = False) -> dict[str, Any]:
    block: dict[str, Any] = {"type": "tool_result", "tool_use_id": tool_use_id, "content": content}
    if error:
        block["is_error"] = True
    return block


def _preview(data: Any, limit: int = 90) -> str:
    s = json.dumps(data, ensure_ascii=False)
    return s if len(s) <= limit else s[: limit - 1] + "…"
