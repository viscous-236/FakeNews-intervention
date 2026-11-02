"""
model.py — Pretrained RoBERTa model loading and inference.

Uses hamzab/roberta-fake-news-classification (MIT licence), pinned to revision
648014ea36ff8aff85b6a6ee25e77579c27bcf19 (safetensors commit).

Label mapping (verified against model config.json):
    Class 0 → Fake   (p_fake = softmax[0])
    Class 1 → Real

Input format per model card:
    <title> {title} <content> {content} <end>

When no separate title is available (our platform only has post body text),
we leave the title section empty:
    <title>  <content> {preprocessed_text} <end>

Design:
- Model and tokenizer are loaded ONCE at process startup via load_model().
- All inference goes through predict(text) which returns p_fake ∈ [0, 1].
- CPU inference is used by default; CUDA is used automatically when available.
- model.eval() and torch.no_grad() are used for every inference call.
- The underlying weights are never modified.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
from pathlib import Path

import torch

from app.preprocess import preprocess_text

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Module-level state — populated by load_model()
# ---------------------------------------------------------------------------

_tokenizer = None
_model = None
_metadata: dict = {}
_device: torch.device = torch.device("cpu")
_model_loaded: bool = False
_loaded_artifacts_dir: Path | None = None

# Verified label mapping — never derive from positional index alone.
# Source: model config.json id2label {"0": "FAKE", "1": "TRUE"}
FAKE_CLASS_INDEX = 0
REAL_CLASS_INDEX = 1
MAX_SEQUENCE_LENGTH = 512
EXPECTED_LABEL_MAP: dict[int, str] = {FAKE_CLASS_INDEX: "FAKE", REAL_CLASS_INDEX: "TRUE"}


def is_loaded() -> bool:
    """Return True only after load_model() has succeeded."""
    return _model_loaded


def get_metadata() -> dict:
    """Return the metadata dict loaded from artifacts/metadata.json."""
    return _metadata


def load_model(artifacts_dir: Path) -> None:
    """
    Load the pretrained tokenizer and model from *artifacts_dir/model/*.

    Must be called once at application startup (FastAPI lifespan).
    Raises RuntimeError if model artefacts are missing or label mapping
    is incorrect so the container fails fast with a readable error.

    Args:
        artifacts_dir: Path to the artifacts directory (MODEL_DIR env var).
                       Must contain model/ (tokenizer + model weights) and
                       metadata.json.
    """
    global _tokenizer, _model, _metadata, _device, _model_loaded, _loaded_artifacts_dir

    if _model_loaded and _loaded_artifacts_dir == artifacts_dir:
        return

    try:
        from transformers import AutoModelForSequenceClassification, AutoTokenizer
    except ImportError as exc:
        raise RuntimeError(
            "transformers package is not installed. "
            "Run: pip install -r requirements.txt"
        ) from exc

    model_dir = artifacts_dir / "model"
    metadata_path = artifacts_dir / "metadata.json"

    # -----------------------------------------------------------------------
    # Fail fast: verify artefacts exist before attempting to load
    # -----------------------------------------------------------------------
    if not model_dir.exists():
        raise RuntimeError(
            f"Model directory not found: {model_dir}\n"
            "Run 'python scripts/download_model.py' to download the pretrained weights."
        )
    if not metadata_path.exists():
        raise RuntimeError(
            f"metadata.json not found: {metadata_path}\n"
            "Run 'python scripts/download_model.py' to generate this file."
        )

    # -----------------------------------------------------------------------
    # Load metadata
    # -----------------------------------------------------------------------
    with open(metadata_path) as f:
        _metadata = json.load(f)

    if _metadata.get("hf_revision") != "648014ea36ff8aff85b6a6ee25e77579c27bcf19":
        raise RuntimeError("Model metadata revision is not the pinned revision.")
    if _metadata.get("license", "").upper() != "MIT":
        raise RuntimeError("Model metadata does not verify the required MIT license.")

    logger.info("Loading tokenizer from %s", model_dir)
    _tokenizer = AutoTokenizer.from_pretrained(str(model_dir), local_files_only=True)

    logger.info("Loading model from %s", model_dir)
    _model = AutoModelForSequenceClassification.from_pretrained(
        str(model_dir),
        local_files_only=True,
    )

    # -----------------------------------------------------------------------
    # Verify label mapping from loaded model config — never trust positional
    # index alone; confirm that index 0 maps to "FAKE" and 1 to "TRUE".
    # -----------------------------------------------------------------------
    id2label: dict[int, str] = {
        int(k): v for k, v in _model.config.id2label.items()
    }
    if _model.config.model_type != "roberta" or _model.config.num_labels != 2:
        raise RuntimeError(
            f"Unexpected model architecture: type={_model.config.model_type!r}, "
            f"num_labels={_model.config.num_labels!r}"
        )
    fake_label = str(id2label.get(FAKE_CLASS_INDEX, "")).upper()
    real_label = str(id2label.get(REAL_CLASS_INDEX, "")).upper()

    if fake_label != "FAKE":
        raise RuntimeError(
            f"Label mapping mismatch: expected id2label[{FAKE_CLASS_INDEX}]='FAKE', "
            f"got {id2label!r}. Do not use this model without re-verifying the mapping."
        )
    if real_label not in ("TRUE", "REAL"):
        raise RuntimeError(
            f"Label mapping mismatch: expected id2label[{REAL_CLASS_INDEX}] in ('TRUE','REAL'), "
            f"got {id2label!r}. Do not use this model without re-verifying the mapping."
        )

    logger.info("Label mapping verified: %s", id2label)

    # -----------------------------------------------------------------------
    # Select device and move model
    # -----------------------------------------------------------------------
    _device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    _model.to(_device)
    _model.eval()

    expected_sha256 = _metadata.get("weights_sha256")
    weight_path = model_dir / "model.safetensors"
    if expected_sha256 and expected_sha256 != "unknown" and weight_path.exists():
        digest = hashlib.sha256(weight_path.read_bytes()).hexdigest()
        if digest != expected_sha256:
            raise RuntimeError("Local model.safetensors SHA-256 does not match metadata.")

    _model_loaded = True
    _loaded_artifacts_dir = artifacts_dir
    logger.info(
        "Model loaded successfully. device=%s model_version=%s",
        _device,
        _metadata.get("model_version", "unknown"),
    )


def predict(text: str) -> float:
    """
    Run inference on *text* and return p_fake ∈ [0, 1].

    The text is preprocessed (URLs, mentions, NFKC normalisation) and then
    formatted with the model's expected input template before tokenization.

    Returns:
        p_fake: probability that the text belongs to the Fake class.

    Raises:
        RuntimeError: if the model has not been loaded or inference fails.
        ValueError: if p_fake is non-finite or out of [0, 1].
    """
    if not _model_loaded or _tokenizer is None or _model is None:
        raise RuntimeError("Model is not loaded. Call load_model() first.")

    # 1. Preprocess the text (normalise, remove URLs/mentions)
    cleaned = preprocess_text(text)

    # 2. Format with model's expected template.
    #    Since our platform has no separate title field, we leave title empty.
    #    Template: <title> {title} <content> {content} <end>
    model_input = f"<title>  <content> {cleaned} <end>"

    # 3. Tokenize with truncation and padding to MAX_SEQUENCE_LENGTH
    inputs = _tokenizer(
        model_input,
        max_length=MAX_SEQUENCE_LENGTH,
        padding="max_length",
        truncation=True,
        return_tensors="pt",
    )

    # 4. Move inputs to the same device as the model
    input_ids = inputs["input_ids"].to(_device)
    attention_mask = inputs["attention_mask"].to(_device)

    # 5. Inference — no gradient computation, model in eval mode
    with torch.no_grad():
        outputs = _model(input_ids=input_ids, attention_mask=attention_mask)

    # 6. Apply softmax to logits → class probabilities
    probs = torch.nn.functional.softmax(outputs.logits, dim=-1)[0]
    p_fake_tensor = probs[FAKE_CLASS_INDEX]
    p_fake = float(p_fake_tensor.item())

    # 7. Sanity-check the output
    if not math.isfinite(p_fake):
        raise ValueError(f"p_fake is non-finite: {p_fake}")
    if not 0.0 <= p_fake <= 1.0:
        raise ValueError(f"p_fake out of range [0, 1]: {p_fake}")

    return p_fake


def get_model_name() -> str:
    return _metadata.get("model_name", "hamzab-roberta-fake-news-classification")


def get_model_version() -> str:
    return _metadata.get("model_version", "unknown")
