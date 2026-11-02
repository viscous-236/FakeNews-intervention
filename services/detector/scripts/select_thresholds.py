"""
select_thresholds.py — Select detection thresholds from the LIAR validation split.

Thresholds are selected using ONLY the validation split (never the test split),
following REQ-032.

Algorithm (per Section 1.6 of the implementation plan):
    Sweep t from 0.50 to 0.95 in steps of 0.01.

    fake_high = smallest t such that:
        - precision of class Fake among samples with p_fake >= t is >= 0.70
        - those samples are >= 2% of the validation set
        - if no t qualifies, use 0.90

    real_low = 1 - (smallest t such that:
        - precision of class Real among samples with p_fake <= (1 - t) is >= 0.70
        - those samples are >= 2% of the validation set)
        - if no t qualifies, use 0.10

Outputs:
    artifacts/thresholds.json
    Updates .env.example and docs/DEPLOYMENT.md

Usage:
    python scripts/select_thresholds.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT))
# Go up to find the project root (two levels up from services/detector)
PROJECT_ROOT = REPO_ROOT.parent.parent
ARTIFACTS_DIR = REPO_ROOT / "artifacts"
ENV_EXAMPLE_PATH = PROJECT_ROOT / ".env.example"
DEPLOYMENT_DOC_PATH = PROJECT_ROOT / "docs" / "DEPLOYMENT.md"


def main() -> None:
    try:
        from datasets import load_dataset
        import numpy as np
    except ImportError as exc:
        print(
            f"ERROR: Missing dependency ({exc}). "
            "Run: pip install -r requirements-train.txt",
            file=sys.stderr,
        )
        sys.exit(1)

    model_dir = ARTIFACTS_DIR / "model"
    if not model_dir.exists():
        print("ERROR: Model not downloaded. Run: python scripts/download_model.py", file=sys.stderr)
        sys.exit(1)

    from app.model import load_model, predict

    print("Loading model for threshold selection …")
    load_model(ARTIFACTS_DIR)

    print("Loading LIAR validation split …")
    try:
        dataset = load_dataset("ucsbnlp/liar", split="validation")
    except Exception as exc:
        print(f"WARNING: Could not load LIAR dataset: {exc}", file=sys.stderr)
        _write_provisional_thresholds()
        return

    label_names = dataset.features["label"].names
    fake_labels_set = {"pants-fire", "false", "barely-true"}
    real_labels_set = {"half-true", "mostly-true", "true"}

    y_true: list[int] = []
    p_fakes: list[float] = []

    for i, example in enumerate(dataset):
        if i % 100 == 0:
            print(f"  {i}/{len(dataset)} …")
        label_idx = example["label"]
        label_name = label_names[label_idx]
        text = example.get("statement", "")
        if not text.strip():
            continue
        if label_name in fake_labels_set:
            binary = 0  # Fake
        elif label_name in real_labels_set:
            binary = 1  # Real
        else:
            continue
        try:
            p = predict(text)
        except Exception:
            continue
        y_true.append(binary)
        p_fakes.append(p)

    n_total = len(y_true)
    print(f"Computed {n_total} predictions on validation set.")

    import numpy as np

    y_arr = np.array(y_true)
    p_arr = np.array(p_fakes)

    # ------------------------------------------------------------------
    # fake_high selection
    # ------------------------------------------------------------------
    fake_high = 0.90  # fallback
    fake_high_data: dict = {"value": fake_high, "source": "fallback"}

    for t_int in range(50, 96):  # 0.50 to 0.95
        t = t_int / 100.0
        mask = p_arr >= t
        n_mask = mask.sum()
        coverage = n_mask / n_total if n_total > 0 else 0.0
        if coverage < 0.02:
            continue
        # Among samples with p_fake >= t, what fraction are actually Fake?
        # True label Fake = 0; predicted as Fake when p_fake >= t
        true_fakes_in_mask = ((y_arr[mask] == 0)).sum()
        precision_fake = true_fakes_in_mask / n_mask if n_mask > 0 else 0.0
        if precision_fake >= 0.70:
            fake_high = t
            fake_high_data = {
                "value": t,
                "precision_at_threshold": float(precision_fake),
                "coverage": float(coverage),
                "n_samples_above": int(n_mask),
                "source": "data-driven",
            }
            break

    # ------------------------------------------------------------------
    # real_low selection
    # ------------------------------------------------------------------
    real_low = 0.10  # fallback
    real_low_data: dict = {"value": real_low, "source": "fallback"}

    for t_int in range(50, 96):  # 0.50 to 0.95 for 1-t sweep
        t = t_int / 100.0
        threshold = 1.0 - t
        mask = p_arr <= threshold
        n_mask = mask.sum()
        coverage = n_mask / n_total if n_total > 0 else 0.0
        if coverage < 0.02:
            continue
        # Among samples with p_fake <= threshold, fraction that are Real (1)
        true_reals_in_mask = (y_arr[mask] == 1).sum()
        precision_real = true_reals_in_mask / n_mask if n_mask > 0 else 0.0
        if precision_real >= 0.70:
            real_low = threshold
            real_low_data = {
                "value": float(threshold),
                "precision_at_threshold": float(precision_real),
                "coverage": float(coverage),
                "n_samples_below": int(n_mask),
                "source": "data-driven",
            }
            break

    # ------------------------------------------------------------------
    # Write thresholds.json
    # ------------------------------------------------------------------
    thresholds = {
        "fake_high": fake_high,
        "real_low": real_low,
        "fake_high_selection": fake_high_data,
        "real_low_selection": real_low_data,
        "dataset": "LIAR validation split (ucsbnlp/liar)",
        "n_validation_samples": n_total,
        "methodology": (
            "Sweep t from 0.50 to 0.95 in steps of 0.01. "
            "fake_high = smallest t with precision(Fake|p_fake>=t)>=0.70 and coverage>=2%. "
            "real_low = 1 - smallest t with precision(Real|p_fake<=(1-t))>=0.70 and coverage>=2%."
        ),
        "note": (
            "Thresholds were selected using the validation split only (REQ-032). "
            "If source='fallback', the algorithm found no qualifying threshold and "
            "the conservative default was used. Verify thresholds before enabling "
            "auto-real assessments in production."
        ),
    }

    thresholds_path = ARTIFACTS_DIR / "thresholds.json"
    with open(thresholds_path, "w") as f:
        json.dump(thresholds, f, indent=2)
    print(f"Wrote {thresholds_path}")
    print(f"  FAKE_THRESHOLD_HIGH = {fake_high}")
    print(f"  REAL_THRESHOLD_LOW  = {real_low}")

    # ------------------------------------------------------------------
    # Update .env.example
    # ------------------------------------------------------------------
    _update_env_example(fake_high, real_low)

    # ------------------------------------------------------------------
    # Update docs/DEPLOYMENT.md
    # ------------------------------------------------------------------
    _update_deployment_doc(fake_high, real_low, thresholds)


def _write_provisional_thresholds() -> None:
    fake_high = 0.65
    real_low = 0.35
    ARTIFACTS_DIR.mkdir(exist_ok=True)
    thresholds = {
        "fake_high": fake_high,
        "real_low": real_low,
        "note": (
            "PROVISIONAL VALUES — validation dataset could not be loaded. "
            "Do not rely on these for auto-real assessments in production. "
            "Run this script again with internet access."
        ),
        "fake_high_selection": {"value": fake_high, "source": "provisional_default"},
        "real_low_selection": {"value": real_low, "source": "provisional_default"},
    }
    path = ARTIFACTS_DIR / "thresholds.json"
    with open(path, "w") as f:
        json.dump(thresholds, f, indent=2)
    print(f"Wrote provisional thresholds to {path}")
    _update_env_example(fake_high, real_low)


def _update_env_example(fake_high: float, real_low: float) -> None:
    if not ENV_EXAMPLE_PATH.exists():
        print(f"WARNING: {ENV_EXAMPLE_PATH} not found; skipping .env.example update.")
        return
    content = ENV_EXAMPLE_PATH.read_text(encoding="utf-8")
    content = re.sub(
        r"^FAKE_THRESHOLD_HIGH=.*$",
        f"FAKE_THRESHOLD_HIGH={fake_high}",
        content,
        flags=re.MULTILINE,
    )
    content = re.sub(
        r"^REAL_THRESHOLD_LOW=.*$",
        f"REAL_THRESHOLD_LOW={real_low}",
        content,
        flags=re.MULTILINE,
    )
    ENV_EXAMPLE_PATH.write_text(content, encoding="utf-8")
    print(f"Updated {ENV_EXAMPLE_PATH}")


def _update_deployment_doc(fake_high: float, real_low: float, thresholds: dict) -> None:
    DEPLOYMENT_DOC_PATH.parent.mkdir(parents=True, exist_ok=True)
    section = f"""
## Detection Thresholds

| Variable              | Value  | Source         |
|:----------------------|:-------|:---------------|
| `FAKE_THRESHOLD_HIGH` | `{fake_high}` | {thresholds.get("fake_high_selection", {}).get("source", "unknown")} |
| `REAL_THRESHOLD_LOW`  | `{real_low}` | {thresholds.get("real_low_selection", {}).get("source", "unknown")} |

Thresholds were selected using the LIAR validation split only (REQ-032).
{thresholds.get("note", "")}

Bands are computed by the Node.js API (RUL-027), not the detector service.
"""
    if DEPLOYMENT_DOC_PATH.exists():
        existing = DEPLOYMENT_DOC_PATH.read_text(encoding="utf-8")
        if "## Detection Thresholds" in existing:
            existing = re.sub(
                r"## Detection Thresholds.*?(?=\n## |\Z)",
                section.strip() + "\n\n",
                existing,
                flags=re.DOTALL,
            )
            DEPLOYMENT_DOC_PATH.write_text(existing, encoding="utf-8")
        else:
            DEPLOYMENT_DOC_PATH.write_text(existing + "\n" + section, encoding="utf-8")
    else:
        DEPLOYMENT_DOC_PATH.write_text("# Deployment Guide\n" + section, encoding="utf-8")
    print(f"Updated {DEPLOYMENT_DOC_PATH}")


if __name__ == "__main__":
    main()
