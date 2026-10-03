"""Prices come from config.yaml; unknown models fail loudly; routing profiles resolve."""

from __future__ import annotations

import pytest

from bookwriter import pricing
from bookwriter.config import load_config
from bookwriter.llm import LLM


def test_cache_reads_priced_per_model(cfg):
    m = cfg.models
    # Opus 5.5 cache reads are 0.05x input; Sonnet 5.5 and Haiku 4.5 are 0.1x
    assert pricing.cost_usd("claude-opus-5-5", m, cache_read_tokens=1_000_000) == pytest.approx(0.20)
    assert pricing.cost_usd("claude-sonnet-5-5", m, cache_read_tokens=1_000_000) == pytest.approx(0.20)
    assert pricing.cost_usd("claude-haiku-4-5", m, cache_read_tokens=1_000_000) == pytest.approx(0.10)
    assert pricing.cost_usd("claude-fable-5-1", m, cache_read_tokens=1_000_000) == pytest.approx(0.25)


def test_full_call_cost(cfg):
    cost = pricing.cost_usd(
        "claude-opus-5-5",
        cfg.models,
        input_tokens=10_000,
        output_tokens=2_000,
        cache_read_tokens=50_000,
        cache_write_tokens=4_000,
    )
    assert cost == pytest.approx((10_000 * 4 + 2_000 * 20 + 50_000 * 0.2 + 4_000 * 5) / 1e6)


def test_dated_snapshot_ids_price_as_their_alias(cfg):
    assert pricing.canonical("claude-haiku-4-5-20251001") == "claude-haiku-4-5"
    assert pricing.cost_usd("claude-haiku-4-5-20251001", cfg.models, output_tokens=1_000_000) == pytest.approx(5.0)


def test_unknown_model_fails_loudly(cfg):
    with pytest.raises(pricing.UnknownModelError, match="claude-mystery-1"):
        pricing.cost_usd("claude-mystery-1", cfg.models, input_tokens=1)


def test_unpriced_tier_model_is_rejected_at_config_load(cfg):
    data = cfg.model_dump()
    data["tiers"]["strong"] = "claude-mystery-1"
    with pytest.raises(ValueError, match="no price entry"):
        type(cfg).model_validate(data)


def test_llm_refuses_to_start_with_an_unpriced_model(cfg):
    cfg = cfg.model_copy(update={"tiers": {**cfg.tiers, "strong": "claude-mystery-1"}})
    with pytest.raises(pricing.UnknownModelError):
        LLM(cfg, client=object())


def test_profiles_route_roles(cfg):
    assert cfg.profile == "showcase"
    assert cfg.model_for("writer") == ("claude-opus-5-5", "medium")
    assert cfg.model_for("writer", revision=True) == ("claude-opus-5-5", "high")
    assert cfg.model_for("fact_checker") == ("claude-opus-5-5", "high")
    assert cfg.model_for("claim_tagger") == ("claude-haiku-4-5", None)

    dev = load_config(profile="dev")
    assert {dev.model_for(r)[0] for r in dev.roles if r != "claim_tagger"} == {"claude-sonnet-5-5"}
    assert dev.model_for("claim_tagger")[0] == "claude-haiku-4-5"
    assert {dev.model_for(r)[1] for r in dev.roles} <= {"low", "medium", None}


def test_unknown_profile_rejected():
    with pytest.raises(ValueError, match="Unknown profile"):
        load_config(profile="cheap")
