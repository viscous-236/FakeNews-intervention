"""
schemas.py — Pydantic request/response schemas for the detector API.

All schemas implement the HTTP contract defined in Section 1.6 of the
implementation plan. The error envelope mirrors the Node.js API convention
so the backend client's Zod schema can validate responses uniformly.
"""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field, field_validator

# ---------------------------------------------------------------------------
# Request / response shapes
# ---------------------------------------------------------------------------


class PredictRequest(BaseModel):
    """POST /v1/predict — request body."""

    request_id: UUID = Field(..., description="UUID echoed back in the response.")
    post_id: UUID = Field(..., description="UUID of the post being classified.")
    text: str = Field(
        ..., min_length=1, max_length=2000, description="Post body text, 1–2000 chars."
    )

    @field_validator("text")
    @classmethod
    def text_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("text must not be blank")
        return v


class PredictResponse(BaseModel):
    """POST /v1/predict — 200 response body."""

    request_id: UUID
    model_name: str
    model_version: str
    p_fake: float = Field(..., ge=0.0, le=1.0)
    latency_ms: int


class HealthResponse(BaseModel):
    """GET /healthz — 200 response body."""

    status: str = "ok"
    model_loaded: bool


class ModelInfoResponse(BaseModel):
    """GET /v1/model-info — 200 response body."""

    model_name: str
    model_version: str
    trained_at: str
    dataset: str
    dataset_sha256: str
    label_mapping: dict[str, str]
    metrics: dict[str, object]
    recommended_thresholds: dict[str, object]


# ---------------------------------------------------------------------------
# Error envelope — matches the Node.js API convention used by the backend
# client (DetectorClientError maps these codes to DetectorErrorCode).
# ---------------------------------------------------------------------------


class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorEnvelope(BaseModel):
    error: ErrorDetail
