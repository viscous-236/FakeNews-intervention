"""
download_model.py — Download and cache the pretrained hamzab/roberta-fake-news-classification
model weights to the local artifacts directory for offline serving.

Run once during Docker image build:
    python scripts/download_model.py

This script:
1. Downloads the model and tokenizer to artifacts/model/
2. Verifies the label mapping matches expected (0=Fake, 1=Real)
3. Writes artifacts/metadata.json with version info
4. Does NOT train or modify the model weights.
"""

from __future__ import annotations

import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Configuration — pinned revision for reproducibility
# ---------------------------------------------------------------------------
MODEL_ID = "hamzab/roberta-fake-news-classification"
MODEL_REVISION = "648014ea36ff8aff85b6a6ee25e77579c27bcf19"  # safetensors commit
MODEL_NAME = "hamzab-roberta-fake-news-classification"

# Expected label mapping per model card and config.json (0=FAKE, 1=TRUE)
EXPECTED_LABEL_MAP = {0: "FAKE", 1: "TRUE"}

REPO_ROOT = Path(__file__).parent.parent
ARTIFACTS_DIR = REPO_ROOT / "artifacts"
MODEL_DIR = ARTIFACTS_DIR / "model"


def sha256_of_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> None:
    try:
        from transformers import AutoModelForSequenceClassification, AutoTokenizer
    except ImportError:
        print(
            "ERROR: transformers not installed. Run: pip install -r requirements.txt",
            file=sys.stderr,
        )
        sys.exit(1)

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Downloading model: {MODEL_ID} @ {MODEL_REVISION[:8]}")
    print(f"Saving to: {MODEL_DIR}")

    # Load or download tokenizer
    if (MODEL_DIR / "tokenizer_config.json").exists():
        print("Loading local tokenizer...")
        tokenizer = AutoTokenizer.from_pretrained(str(MODEL_DIR))
    else:
        tokenizer = AutoTokenizer.from_pretrained(
            MODEL_ID,
            revision=MODEL_REVISION,
            cache_dir=None,
        )
        tokenizer.save_pretrained(str(MODEL_DIR))
    print("Tokenizer ready.")

    # Load or download model
    if (MODEL_DIR / "pytorch_model.bin").exists() or (MODEL_DIR / "model.safetensors").exists():
        print("Loading local model weights...")
        model = AutoModelForSequenceClassification.from_pretrained(str(MODEL_DIR))
    else:
        model = AutoModelForSequenceClassification.from_pretrained(
            MODEL_ID,
            revision=MODEL_REVISION,
            cache_dir=None,
        )
    # Save locally in safetensors format for secure and fast offline loading
    model.save_pretrained(str(MODEL_DIR), safe_serialization=True)
    print("Model saved locally in safetensors format.")

    # -----------------------------------------------------------------------
    # Verify label mapping from saved config.json
    # -----------------------------------------------------------------------
    config_path = MODEL_DIR / "config.json"
    with open(config_path) as f:
        config = json.load(f)

    id2label: dict[str, str] = config.get("id2label", {})
    # config.json uses string keys for JSON compliance
    actual_map = {int(k): v for k, v in id2label.items()}

    if actual_map != EXPECTED_LABEL_MAP:
        print(
            f"ERROR: Label mapping mismatch!\n"
            f"  Expected: {EXPECTED_LABEL_MAP}\n"
            f"  Got:      {actual_map}",
            file=sys.stderr,
        )
        sys.exit(1)
    print(f"Label mapping verified: {actual_map}")

    # -----------------------------------------------------------------------
    # Compute SHA-256 of model weights file for provenance
    # -----------------------------------------------------------------------
    # Prefer safetensors file; fall back to pytorch_model.bin
    weight_candidates = [
        MODEL_DIR / "model.safetensors",
        MODEL_DIR / "pytorch_model.bin",
    ]
    weight_file: Path | None = None
    for candidate in weight_candidates:
        if candidate.exists():
            weight_file = candidate
            break

    if weight_file is None:
        print("WARNING: No model weight file found for SHA-256 computation.", file=sys.stderr)
        weights_sha256 = "unknown"
    else:
        print(f"Computing SHA-256 of {weight_file.name} …")
        weights_sha256 = sha256_of_file(weight_file)
        print(f"SHA-256: {weights_sha256}")

    # -----------------------------------------------------------------------
    # Build model_version: "<first 8 chars of HF revision SHA>"
    # Per plan: model_version = <model_name>-<first 8 chars of sha256 of artifact>
    # We use the HF commit SHA for determinism (artifact SHA is identical for
    # a pinned revision, but we record both).
    # -----------------------------------------------------------------------
    model_version = f"{MODEL_NAME}-{MODEL_REVISION[:8]}"

    # -----------------------------------------------------------------------
    # Write metadata.json
    # -----------------------------------------------------------------------
    metadata = {
        "model_id": MODEL_ID,
        "model_name": MODEL_NAME,
        "model_version": model_version,
        "hf_revision": MODEL_REVISION,
        "architecture": config.get("model_type", "roberta"),
        "num_labels": config.get("num_labels", 2),
        "max_sequence_length": 512,
        "license": "MIT",
        "label_mapping": {str(k): v for k, v in EXPECTED_LABEL_MAP.items()},
        "fake_class_index": 0,
        "real_class_index": 1,
        "input_format": "<title> {title} <content> {content} <end>",
        "input_note": (
            "When no separate title is available, title is left empty and full post text "
            "is used as content."
        ),
        "dataset_original_author": (
            "ISOT Fake News Dataset (per model card) or similar; see MODEL_CARD.md"
        ),
        "dataset_sha256": "unknown",
        "trained_at": "unknown",
        "download_date": datetime.now(timezone.utc).isoformat(),
        "weights_sha256": weights_sha256,
        "weights_file": weight_file.name if weight_file else None,
        "metrics": {
            "val_macro_f1": None,
            "test_macro_f1": None,
            "_note": "Run scripts/evaluate_model.py to populate these fields."
        },
        "recommended_thresholds": {
            "fake_high": 0.65,
            "real_low": 0.35,
            "_note": (
                "Provisional defaults. Run scripts/select_thresholds.py to compute "
                "data-driven values."
            )
        },
    }

    metadata_path = ARTIFACTS_DIR / "metadata.json"
    with open(metadata_path, "w") as f:
        json.dump(metadata, f, indent=2)
    print(f"Metadata written to {metadata_path}")

    print("\nDownload complete. Model is ready for offline serving.")
    print(f"  Model directory : {MODEL_DIR}")
    print(f"  model_version   : {model_version}")
    print(f"  label mapping   : {actual_map}")


if __name__ == "__main__":
    main()
