# -----------------------------------------------------------------------------
# services/detector/Dockerfile
#
# Builds the fake-news detector FastAPI service.
#
# The pretrained model (hamzab/roberta-fake-news-classification, revision
# 648014ea36ff8aff85b6a6ee25e77579c27bcf19) is downloaded during the image
# build step so the container can serve predictions without network access
# at runtime.
#
# Build-time: ~5-10 min (downloading model + torch on first build)
# Runtime: CPU inference, no GPU required.
#
# Usage:
#   docker build -t detector .
#   docker run -e DETECTOR_API_KEY=secret -p 8001:8001 detector
# -----------------------------------------------------------------------------

FROM python:3.12-slim AS base

# System dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
        wget \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements first for layer caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source
COPY app/ app/
COPY scripts/ scripts/

# Create artifacts directory
RUN mkdir -p artifacts/model

# Download the pretrained model weights at build time.
# This bakes the model into the image so no internet access is needed at runtime.
# The download is pinned to a specific immutable commit SHA for reproducibility.
#
# HF_HOME is set to a writable directory inside /app so HuggingFace cache
# doesn't interfere with our local artifacts layout.
ENV HF_HOME=/app/.cache/huggingface \
    TRANSFORMERS_OFFLINE=0

RUN python scripts/download_model.py

# After download, switch to offline mode for runtime — model must load
# from local artifacts only (no network access needed or allowed at runtime).
ENV TRANSFORMERS_OFFLINE=1 \
    HF_DATASETS_OFFLINE=1

# Expose the service port (default 8001, matching docker-compose)
EXPOSE 8001

# Environment defaults (can be overridden at runtime)
ENV PORT=8001 \
    MODEL_DIR=/app/artifacts \
    LOG_LEVEL=info

# Health check
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
    CMD wget --quiet --tries=1 --spider "http://localhost:${PORT}/healthz" || exit 1

# The DETECTOR_API_KEY is required and must be supplied at runtime.
# The container will refuse to start if it is not set (config.py exits).
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --log-level ${LOG_LEVEL}"]
