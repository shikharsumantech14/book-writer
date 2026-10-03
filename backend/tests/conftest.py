from __future__ import annotations

import pytest

from bookwriter.config import get_settings, load_config


@pytest.fixture(autouse=True)
def isolated_data(tmp_path, monkeypatch):
    """Every test writes runs and page caches under its own temp folder, never backend/data."""
    monkeypatch.setattr(get_settings(), "data_dir", tmp_path)
    return tmp_path


@pytest.fixture
def cfg():
    return load_config()
