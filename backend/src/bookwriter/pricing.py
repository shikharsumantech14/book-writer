"""Token pricing, shared by the runtime (every LLM call) and scripts/dev_usage.py.

Prices live in config.yaml under `models`. A model ID without a price entry
raises `UnknownModelError`: reporting $0 for an unpriced model would quietly
corrupt every cost number downstream.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from pathlib import Path

import yaml

from .config import ModelPrice, get_settings

_DATE_SUFFIX = re.compile(r"-\d{8}$")


class UnknownModelError(KeyError):
    def __str__(self) -> str:
        return f"No price for model '{self.args[0]}'. Add it under `models` in config.yaml."


def canonical(model: str) -> str:
    """The API may answer with a dated snapshot ID (claude-haiku-4-5-20251001); price it as its alias."""
    return _DATE_SUFFIX.sub("", model)


def load_prices(path: Path | None = None) -> dict[str, ModelPrice]:
    path = path or get_settings().config_path
    with open(path, encoding="utf-8") as f:
        raw = yaml.safe_load(f)["models"]
    return {k: ModelPrice.model_validate(v) for k, v in raw.items()}


def price_for(model: str, prices: Mapping[str, ModelPrice]) -> ModelPrice:
    try:
        return prices[canonical(model)]
    except KeyError:
        raise UnknownModelError(model) from None


def cost_usd(
    model: str,
    prices: Mapping[str, ModelPrice],
    *,
    input_tokens: int = 0,
    output_tokens: int = 0,
    cache_read_tokens: int = 0,
    cache_write_tokens: int = 0,
) -> float:
    p = price_for(model, prices)
    return (
        input_tokens * p.input
        + output_tokens * p.output
        + cache_read_tokens * p.cache_read
        + cache_write_tokens * p.cache_write
    ) / 1_000_000
