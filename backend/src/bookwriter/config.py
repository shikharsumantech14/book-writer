"""Configuration: secrets from the environment, job settings from config.yaml.

Secrets (API keys) never live in YAML; the YAML describes *what* to build and
*how* the agents are allowed to behave, and can be overridden per run.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parents[2]

Tier = Literal["strong", "balanced", "fast"]
Effort = Literal["low", "medium", "high", "xhigh", "max"]
Role = Literal[
    "planner",
    "researcher",
    "writer",
    "editor",
    "claim_tagger",
    "fact_checker",
    "chief_editor",
]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_ROOT / ".env", extra="ignore")

    anthropic_api_key: str | None = None
    tavily_api_key: str | None = None
    data_dir: Path = BACKEND_ROOT / "data"
    config_path: Path = BACKEND_ROOT / "config.yaml"
    cors_origins: list[str] = ["http://localhost:3000"]


class Brief(BaseModel):
    title: str
    audience: str
    chapters: int = 3
    words_min: int = 600
    words_max: int = 900
    tone: str
    citation_rules: str


class RoleConfig(BaseModel):
    tier: Tier
    effort: Effort | None = None


class Limits(BaseModel):
    lint_rounds: int = 3
    editor_rounds: int = 2
    fact_check_rounds: int = 2
    max_writer_passes: int = 7
    research_tool_calls: int = 40
    gap_research_tool_calls: int = 15
    max_evidence_per_chapter: int = 14


class Sources(BaseModel):
    official_domains: list[str] = Field(default_factory=list)
    reputable_news_domains: list[str] = Field(default_factory=list)
    blocked_domains: list[str] = Field(default_factory=list)


class AppConfig(BaseModel):
    brief: Brief
    models: dict[Tier, str]
    roles: dict[Role, RoleConfig]
    limits: Limits = Limits()
    sources: Sources = Sources()
    human_in_the_loop: bool = False

    def model_for(self, role: Role) -> tuple[str, Effort | None]:
        rc = self.roles[role]
        return self.models[rc.tier], rc.effort


@lru_cache
def get_settings() -> Settings:
    return Settings()


def load_config(path: Path | None = None) -> AppConfig:
    path = path or get_settings().config_path
    with open(path, encoding="utf-8") as f:
        return AppConfig.model_validate(yaml.safe_load(f))
