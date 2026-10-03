"""Configuration: secrets from the environment, job settings from config.yaml.

Secrets (API keys) never live in YAML; the YAML describes *what* to build and
*how* the agents are allowed to behave, and can be overridden per run.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, Field, model_validator
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
ROLES: tuple[Role, ...] = Role.__args__  # type: ignore[attr-defined]


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


class ModelPrice(BaseModel):
    """USD per 1M tokens."""

    input: float
    output: float
    cache_read: float
    cache_write: float


class RoleConfig(BaseModel):
    tier: Tier
    effort: Effort | None = None
    revision_effort: Effort | None = None  # used once a reviewer has sent the work back


class Limits(BaseModel):
    lint_rounds: int = 3
    editor_rounds: int = 2
    fact_check_rounds: int = 2
    max_writer_passes: int = 7
    research_tool_calls: int = 40
    gap_research_tool_calls: int = 15
    max_evidence_per_chapter: int = 14


class RunSettings(BaseModel):
    parallel_chapters: int = 3
    max_cost_usd: float | None = 5.0


class Sources(BaseModel):
    official_domains: list[str] = Field(default_factory=list)
    reputable_news_domains: list[str] = Field(default_factory=list)
    blocked_domains: list[str] = Field(default_factory=list)


class AppConfig(BaseModel):
    brief: Brief
    models: dict[str, ModelPrice]
    tiers: dict[Tier, str]
    profile: str = "showcase"
    profiles: dict[str, dict[Role, RoleConfig]]
    limits: Limits = Limits()
    run: RunSettings = RunSettings()
    sources: Sources = Sources()
    human_in_the_loop: bool = False

    @model_validator(mode="after")
    def _check(self) -> AppConfig:
        if self.profile not in self.profiles:
            raise ValueError(f"Unknown profile '{self.profile}'. Known: {', '.join(self.profiles)}")
        for name, roles in self.profiles.items():
            missing = set(ROLES) - set(roles)
            if missing:
                raise ValueError(f"Profile '{name}' has no routing for: {', '.join(sorted(missing))}")
        for tier, model in self.tiers.items():
            if model not in self.models:
                raise ValueError(f"Tier '{tier}' uses {model}, which has no price entry under `models`.")
        return self

    @property
    def roles(self) -> dict[Role, RoleConfig]:
        return self.profiles[self.profile]

    def with_profile(self, profile: str) -> AppConfig:
        return self.model_validate({**self.model_dump(), "profile": profile})

    def model_for(self, role: Role, *, revision: bool = False) -> tuple[str, Effort | None]:
        rc = self.roles[role]
        effort = (rc.revision_effort or rc.effort) if revision else rc.effort
        return self.tiers[rc.tier], effort

    def routing(self) -> dict[str, dict]:
        """The active profile resolved to concrete models, for reports and the dashboard."""
        out = {}
        for role in ROLES:
            rc = self.roles[role]
            out[role] = {"model": self.tiers[rc.tier], "tier": rc.tier, "effort": rc.effort}
            if rc.revision_effort:
                out[role]["revision_effort"] = rc.revision_effort
        return out


@lru_cache
def get_settings() -> Settings:
    return Settings()


def load_config(path: Path | None = None, *, profile: str | None = None) -> AppConfig:
    path = path or get_settings().config_path
    with open(path, encoding="utf-8") as f:
        cfg = AppConfig.model_validate(yaml.safe_load(f))
    return cfg.with_profile(profile) if profile else cfg
