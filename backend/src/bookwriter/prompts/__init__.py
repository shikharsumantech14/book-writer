"""Prompt templates live as Markdown next to this file so they read like documents.
Placeholders use {{name}}; anything not supplied is left empty."""

from __future__ import annotations

import re
from functools import cache
from pathlib import Path

_DIR = Path(__file__).parent


@cache
def _load(name: str) -> str:
    return (_DIR / f"{name}.md").read_text(encoding="utf-8")


def render(name: str, **values: object) -> str:
    text = _load(name)
    return re.sub(r"\{\{(\w+)\}\}", lambda m: str(values.get(m.group(1), "")), text).strip()
