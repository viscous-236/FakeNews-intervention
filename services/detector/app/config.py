"""
config.py — Configuration for the detector service.

All values are read from environment variables at import time.
If a required variable is missing, the process exits immediately with a
readable error message (REQ-036 equivalent for the Python service).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def _require(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        print(f"ERROR: Required environment variable '{name}' is not set.", file=sys.stderr)
        sys.exit(1)
    return value


def _optional(name: str, default: str) -> str:
    return os.environ.get(name, default).strip() or default


class Settings:
    # Authentication
    DETECTOR_API_KEY: str = _require("DETECTOR_API_KEY")

    # Model artefact directory (must contain model/ subdirectory and metadata.json)
    MODEL_DIR: Path = Path(_optional("MODEL_DIR", "/app/artifacts"))

    # HTTP server port
    PORT: int = int(_optional("PORT", "8000"))

    # Log level
    LOG_LEVEL: str = _optional("LOG_LEVEL", "info")


settings = Settings()
