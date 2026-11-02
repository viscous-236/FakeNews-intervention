"""
main.py — FastAPI application for the fake-news detector service.

Implements the HTTP contract from Section 1.6 of the implementation plan:

    POST /v1/predict    — classify text, return p_fake
    GET  /healthz       — liveness + model readiness check
    GET  /v1/model-info — model metadata (authenticated)

Authentication: all endpoints except GET /healthz require the HTTP header
    X-Detector-Key: <DETECTOR_API_KEY>
returning 401 on missing or incorrect values.

The model is loaded once during the FastAPI lifespan (startup event) and
is never reloaded during serving. A failed load causes the process to exit.

Error responses follow the error envelope used by the backend client:
    {"error": {"code": "...", "message": "..."}}
"""

from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse

from app import model as model_module
from app.config import settings
from app.schemas import (
    ErrorDetail,
    ErrorEnvelope,
    HealthResponse,
    ModelInfoResponse,
    PredictRequest,
    PredictResponse,
)

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Lifespan — load model once at startup
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    """Load the pretrained model during startup; shut down cleanly."""
    logger.info("Detector service starting up. Loading model from %s …", settings.MODEL_DIR)
    try:
        model_module.load_model(settings.MODEL_DIR)
    except Exception as exc:
        logger.critical("FATAL: Failed to load model — %s", exc)
        raise SystemExit(1) from exc
    logger.info("Model loaded. Ready to serve predictions.")
    yield
    logger.info("Detector service shutting down.")


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Fake-News Detector",
    version="1.0.0",
    docs_url=None,   # disable Swagger UI in production
    redoc_url=None,
    lifespan=lifespan,
)


# ---------------------------------------------------------------------------
# Custom exception handler — produces the error envelope
# ---------------------------------------------------------------------------


@app.exception_handler(HTTPException)
async def http_exception_handler(_request: Request, exc: HTTPException) -> JSONResponse:
    if isinstance(exc.detail, dict):
        code = str(exc.detail.get("code", "ERROR"))
        message = str(exc.detail.get("message", "An error occurred."))
    else:
        code = "ERROR"
        message = str(exc.detail) if exc.detail else "An error occurred."
    envelope = ErrorEnvelope(error=ErrorDetail(code=code, message=message))
    return JSONResponse(status_code=exc.status_code, content=envelope.model_dump())


# ---------------------------------------------------------------------------
# Auth helper
# ---------------------------------------------------------------------------


def _require_api_key(x_detector_key: str | None) -> None:
    """Raise 401 if the X-Detector-Key header is missing or incorrect."""
    if x_detector_key is None or x_detector_key != settings.DETECTOR_API_KEY:
        raise HTTPException(
            status_code=401,
            detail={"code": "UNAUTHORIZED", "message": "Invalid or missing X-Detector-Key."},
        )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/healthz", response_model=HealthResponse)
async def healthz() -> JSONResponse:
    """
    GET /healthz — Liveness and model-readiness check.

    Returns 200 {"status": "ok", "model_loaded": true} when the model is ready.
    Returns 503 {"status": "unavailable", "model_loaded": false} when not ready.

    No authentication required.
    """
    loaded = model_module.is_loaded()
    body = HealthResponse(status="ok" if loaded else "unavailable", model_loaded=loaded)
    status_code = 200 if loaded else 503
    return JSONResponse(status_code=status_code, content=body.model_dump())


@app.get("/v1/model-info", response_model=ModelInfoResponse)
async def model_info(
    x_detector_key: str | None = Header(default=None, alias="X-Detector-Key"),
) -> ModelInfoResponse:
    """
    GET /v1/model-info — Return model metadata.

    Requires X-Detector-Key authentication.
    """
    _require_api_key(x_detector_key)

    if not model_module.is_loaded():
        raise HTTPException(
            status_code=503,
            detail={"code": "MODEL_NOT_READY", "message": "Model is not loaded yet."},
        )

    meta = model_module.get_metadata()

    return ModelInfoResponse(
        model_name=meta.get("model_name", "hamzab-roberta-fake-news-classification"),
        model_version=meta.get("model_version", "unknown"),
        trained_at=meta.get("trained_at", "unknown"),
        dataset=meta.get("dataset_original_author", "unknown"),
        dataset_sha256=meta.get("dataset_sha256", "unknown"),
        label_mapping={str(k): v for k, v in model_module.EXPECTED_LABEL_MAP.items()},
        metrics=meta.get("metrics", {}),
        recommended_thresholds=meta.get("recommended_thresholds", {}),
    )


@app.post("/v1/predict", response_model=PredictResponse)
async def predict(
    body: PredictRequest,
    x_detector_key: str | None = Header(default=None, alias="X-Detector-Key"),
) -> PredictResponse:
    """
    POST /v1/predict — Classify post text and return p_fake.

    Authentication: X-Detector-Key header.

    Request:
        {"request_id": "<uuid>", "post_id": "<uuid>", "text": "<1..2000 chars>"}

    Response 200:
        {"request_id": "...", "model_name": "...", "model_version": "...",
         "p_fake": 0.87, "latency_ms": 120}

    The detector NEVER returns labels, bands, or thresholds.
    All band/label decisions are made by the Node.js backend (RUL-027).
    """
    _require_api_key(x_detector_key)

    if not model_module.is_loaded():
        raise HTTPException(
            status_code=503,
            detail={"code": "MODEL_NOT_READY", "message": "Model is not loaded yet."},
        )

    t_start = time.perf_counter()
    try:
        p_fake = model_module.predict(body.text)
    except ValueError as exc:
        # p_fake out of range or non-finite — surface as 422
        raise HTTPException(
            status_code=422,
            detail={"code": "INVALID_INPUT", "message": str(exc)},
        ) from exc
    except Exception as exc:
        logger.exception("Inference failed for request_id=%s: %s", body.request_id, exc)
        raise HTTPException(
            status_code=500,
            detail={"code": "INFERENCE_ERROR", "message": "Inference failed unexpectedly."},
        ) from exc

    latency_ms = int((time.perf_counter() - t_start) * 1000)

    return PredictResponse(
        request_id=body.request_id,
        model_name=model_module.get_model_name(),
        model_version=model_module.get_model_version(),
        p_fake=p_fake,
        latency_ms=latency_ms,
    )


# ---------------------------------------------------------------------------
# Pydantic validation errors → 422 with error envelope
# ---------------------------------------------------------------------------

from fastapi.exceptions import RequestValidationError  # noqa: E402


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    _request: Request, exc: RequestValidationError
) -> JSONResponse:
    messages = "; ".join(
        f"{'.'.join(str(loc) for loc in e['loc'])}: {e['msg']}"
        for e in exc.errors()
    )
    envelope = ErrorEnvelope(
        error=ErrorDetail(
            code="INVALID_INPUT",
            message=messages or "Validation error.",
        )
    )
    return JSONResponse(status_code=422, content=envelope.model_dump())


# ---------------------------------------------------------------------------
# Entry point (used by Uvicorn CMD in Dockerfile)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=settings.PORT,
        log_level=settings.LOG_LEVEL,
    )
