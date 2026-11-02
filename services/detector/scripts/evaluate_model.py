"""
evaluate_model.py — Evaluate the pretrained hamzab/roberta-fake-news-classification
model on the LIAR test split.

We are NOT training or fine-tuning the model. This script runs the model
in inference mode on a held-out test dataset and computes metrics.

Dataset: LIAR (ucsbnlp/liar) — the model author's original training dataset.
We use ONLY the test split for evaluation (model has never seen these examples
in any form that would affect our evaluation, as we are using weights downloaded
directly from HuggingFace, not re-training).

NOTE ON EVALUATION HONESTY:
  - We do NOT claim the model was independently validated on a fully out-of-domain
    dataset. The LIAR test split is from the same distribution as LIAR train.
  - Reported metrics describe model performance on LIAR (short political statements
    from PolitiFact). Application performance on social media posts may differ.
  - See MODEL_CARD.md for documented limitations.

Binary mapping from LIAR 6-class labels to fake/real:
  fake (0): pants-fire, false, barely-true
  real (1): half-true, mostly-true, true

Usage:
    python scripts/evaluate_model.py [--max-samples N]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT))
ARTIFACTS_DIR = REPO_ROOT / "artifacts"
REPORTS_DIR = REPO_ROOT / "reports"

# LIAR label names from the dataset (in order of integer index)
LIAR_LABEL_NAMES = ["false", "half-true", "mostly-true", "true", "barely-true", "pants-fire"]

# Binary mapping: label_name → binary class (0=fake, 1=real)
def liar_label_to_binary(label_name: str) -> int:
    """Map a LIAR 6-class label to binary fake(0)/real(1)."""
    fake_labels = {"pants-fire", "false", "barely-true"}
    real_labels = {"half-true", "mostly-true", "true"}
    if label_name in fake_labels:
        return 0  # Fake
    elif label_name in real_labels:
        return 1  # Real
    else:
        raise ValueError(f"Unknown LIAR label: {label_name!r}")


def main(max_samples: int | None = None) -> None:
    try:
        from datasets import load_dataset
        import numpy as np
        from sklearn.metrics import (
            accuracy_score,
            classification_report,
            confusion_matrix,
            roc_auc_score,
            average_precision_score,
            precision_recall_curve,
        )
        import torch
    except ImportError as exc:
        print(
            f"ERROR: Missing dependency ({exc}). "
            "Run: pip install -r requirements-train.txt",
            file=sys.stderr,
        )
        sys.exit(1)

    # Check model is downloaded
    model_dir = ARTIFACTS_DIR / "model"
    metadata_path = ARTIFACTS_DIR / "metadata.json"
    if not model_dir.exists():
        print(
            "ERROR: Model not downloaded. Run: python scripts/download_model.py",
            file=sys.stderr,
        )
        sys.exit(1)

    REPORTS_DIR.mkdir(exist_ok=True)

    # ------------------------------------------------------------------
    # Load model
    # ------------------------------------------------------------------
    from app.model import load_model, predict, FAKE_CLASS_INDEX

    print("Loading model for evaluation …")
    load_model(ARTIFACTS_DIR)
    print("Model loaded.")

    # ------------------------------------------------------------------
    # Load LIAR test split
    # ------------------------------------------------------------------
    print("Loading LIAR dataset (test split) …")
    try:
        dataset = load_dataset("ucsbnlp/liar", split="test")
    except Exception as exc:
        print(f"ERROR: Could not load LIAR dataset: {exc}", file=sys.stderr)
        print(
            "LIMITATION: Evaluation dataset could not be downloaded. "
            "Metrics cannot be computed. See MODEL_CARD.md for details.",
            file=sys.stderr,
        )
        _write_limitation_report()
        sys.exit(0)

    label_names = dataset.features["label"].names
    print(f"LIAR label names: {label_names}")

    # Apply sample limit if requested
    if max_samples is not None:
        dataset = dataset.select(range(min(max_samples, len(dataset))))

    print(f"Evaluating on {len(dataset)} test examples …")

    # ------------------------------------------------------------------
    # Run inference
    # ------------------------------------------------------------------
    y_true: list[int] = []
    p_fakes: list[float] = []
    texts: list[str] = []
    raw_labels: list[str] = []

    for i, example in enumerate(dataset):
        if i % 100 == 0:
            print(f"  {i}/{len(dataset)} …")

        label_idx = example["label"]
        label_name = label_names[label_idx]
        try:
            binary_label = liar_label_to_binary(label_name)
        except ValueError:
            continue  # skip unknown labels

        text = example.get("statement", "")
        if not text or not text.strip():
            continue

        try:
            p_fake = predict(text)
        except Exception as exc:
            print(f"  WARNING: predict() failed for example {i}: {exc}")
            continue

        y_true.append(binary_label)
        p_fakes.append(p_fake)
        texts.append(text)
        raw_labels.append(label_name)

    print(f"Completed inference on {len(y_true)} examples.")

    # ------------------------------------------------------------------
    # Compute metrics
    # ------------------------------------------------------------------
    import numpy as np

    y_pred = [1 if p <= 0.5 else 0 for p in p_fakes]  # p_fake > 0.5 → predicted Fake (0)
    p_fakes_arr = np.array(p_fakes)

    acc = accuracy_score(y_true, y_pred)
    report = classification_report(y_true, y_pred, target_names=["Fake", "Real"], output_dict=True)
    cm = confusion_matrix(y_true, y_pred).tolist()

    # ROC-AUC: p_fake is probability of class 0 (Fake), so negate for standard sklearn convention
    try:
        roc_auc = roc_auc_score(y_true, [-p for p in p_fakes])
    except Exception:
        roc_auc = None

    # PR-AUC (precision-recall for Fake class = positive)
    try:
        pr_auc = average_precision_score(
            [1 - y for y in y_true],  # Fake is positive
            p_fakes_arr,
        )
    except Exception:
        pr_auc = None

    macro_f1 = report.get("macro avg", {}).get("f1-score")

    metrics = {
        "accuracy": acc,
        "macro_f1": macro_f1,
        "roc_auc": roc_auc,
        "pr_auc": pr_auc,
        "confusion_matrix": cm,
        "per_class": {
            "Fake": report.get("Fake", {}),
            "Real": report.get("Real", {}),
        },
        "n_samples": len(y_true),
        "dataset": "LIAR test split (ucsbnlp/liar)",
        "binary_mapping": "pants-fire/false/barely-true→Fake; half-true/mostly-true/true→Real",
        "threshold_used_for_metrics": 0.5,
        "evaluation_note": (
            "Metrics computed on the LIAR test split. "
            "Model was originally trained on LIAR; test split is in-domain. "
            "Performance on out-of-domain social media text may differ."
        ),
    }

    # ------------------------------------------------------------------
    # Write reports
    # ------------------------------------------------------------------
    eval_json_path = REPORTS_DIR / "detector_eval.json"
    with open(eval_json_path, "w") as f:
        json.dump(metrics, f, indent=2, default=str)
    print(f"Wrote {eval_json_path}")

    eval_md_path = REPORTS_DIR / "detector_eval.md"
    with open(eval_md_path, "w") as f:
        f.write(_build_report_md(metrics))
    print(f"Wrote {eval_md_path}")

    # ------------------------------------------------------------------
    # Write misclassified errors (up to 100)
    # ------------------------------------------------------------------
    import csv

    errors_path = REPORTS_DIR / "errors_pretrained.csv"
    misclassified = [
        (texts[i], raw_labels[i], y_true[i], p_fakes[i])
        for i in range(len(y_true))
        if y_pred[i] != y_true[i]
    ]
    with open(errors_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["statement", "original_label", "true_binary", "p_fake"])
        for stmt, lbl, tb, pf in misclassified[:100]:
            writer.writerow([stmt, lbl, tb, f"{pf:.4f}"])
    print(f"Wrote {errors_path} ({len(misclassified)} misclassified, {min(100, len(misclassified))} recorded)")

    # ------------------------------------------------------------------
    # Update metadata.json with eval metrics
    # ------------------------------------------------------------------
    if metadata_path.exists():
        with open(metadata_path) as f:
            meta = json.load(f)
        meta["metrics"]["test_macro_f1"] = macro_f1
        meta["metrics"]["_eval_dataset"] = "LIAR test split"
        with open(metadata_path, "w") as f:
            json.dump(meta, f, indent=2)
        print("Updated artifacts/metadata.json with test_macro_f1.")

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------
    print("\n=== Evaluation Results ===")
    print(f"  Accuracy    : {acc:.4f}")
    print(f"  Macro-F1    : {macro_f1:.4f}" if macro_f1 is not None else "  Macro-F1    : N/A")
    print(f"  ROC-AUC     : {roc_auc:.4f}" if roc_auc is not None else "  ROC-AUC     : N/A")
    print(f"  PR-AUC      : {pr_auc:.4f}" if pr_auc is not None else "  PR-AUC      : N/A")
    print(f"  Confusion   : {cm}")
    print(f"  N samples   : {len(y_true)}")


def _build_report_md(metrics: dict) -> str:
    acc = metrics.get("accuracy", "N/A")
    mf1 = metrics.get("macro_f1", "N/A")
    roc = metrics.get("roc_auc", "N/A")
    pr = metrics.get("pr_auc", "N/A")
    cm = metrics.get("confusion_matrix", [])
    fake = metrics.get("per_class", {}).get("Fake", {})
    real = metrics.get("per_class", {}).get("Real", {})

    return f"""# Detector Evaluation Report

## Model
- Model: hamzab/roberta-fake-news-classification
- Architecture: RoBERTa-base
- Evaluation Date: see detector_eval.json

## Dataset
- **{metrics.get("dataset", "LIAR test split")}**
- Binary mapping: {metrics.get("binary_mapping", "")}
- N samples evaluated: {metrics.get("n_samples", "N/A")}

## Metrics

| Metric       | Value   |
|:-------------|:--------|
| Accuracy     | {acc if isinstance(acc, str) else f"{acc:.4f}"} |
| Macro-F1     | {mf1 if isinstance(mf1, str) else f"{mf1:.4f}"} |
| ROC-AUC      | {roc if isinstance(roc, str) else f"{roc:.4f}"} |
| PR-AUC       | {pr if isinstance(pr, str) else f"{pr:.4f}"} |

## Per-Class Metrics

| Class | Precision | Recall | F1    |
|:------|:----------|:-------|:------|
| Fake  | {fake.get("precision", "N/A") if isinstance(fake.get("precision"), str) else f"{fake.get('precision', 0):.4f}"} | {fake.get("recall", "N/A") if isinstance(fake.get("recall"), str) else f"{fake.get('recall', 0):.4f}"} | {fake.get("f1-score", "N/A") if isinstance(fake.get("f1-score"), str) else f"{fake.get('f1-score', 0):.4f}"} |
| Real  | {real.get("precision", "N/A") if isinstance(real.get("precision"), str) else f"{real.get('precision', 0):.4f}"} | {real.get("recall", "N/A") if isinstance(real.get("recall"), str) else f"{real.get('recall', 0):.4f}"} | {real.get("f1-score", "N/A") if isinstance(real.get("f1-score"), str) else f"{real.get('f1-score', 0):.4f}"} |

## Confusion Matrix

```
(rows=true, cols=predicted)
{cm}
```

## Important Limitations

> **This evaluation uses the LIAR test split**, which is from the same
> distribution as the model's original training data. It measures
> in-domain performance only.
>
> The model is optimized for short political statements (PolitiFact style).
> Performance on general social media posts or long-form articles may be
> significantly different.
>
> Do not interpret these metrics as a guarantee of accuracy on real
> deployment data. Human admin review remains the authoritative source
> of truth for all fake/real assessments.

## Methodology Note

{metrics.get("evaluation_note", "")}
"""


def _write_limitation_report() -> None:
    REPORTS_DIR.mkdir(exist_ok=True)
    path = REPORTS_DIR / "detector_eval.md"
    with open(path, "w") as f:
        f.write("""# Detector Evaluation Report

## LIMITATION: Evaluation Could Not Be Completed

The LIAR dataset could not be downloaded from HuggingFace at evaluation time.

Therefore, no independent evaluation metrics have been computed for this model.

**Do not claim the model achieves any particular accuracy without running this
evaluation script successfully.**

## What This Means

The pretrained model `hamzab/roberta-fake-news-classification` is used as-is.
Its performance characteristics on our platform's data are unknown.

We use provisional thresholds (FAKE_THRESHOLD_HIGH=0.65, REAL_THRESHOLD_LOW=0.35)
with explicit documentation that they have not been validated on our data.

## Recommended Action

Once internet access is available, run:
    python scripts/evaluate_model.py
    python scripts/select_thresholds.py

to compute real metrics and data-driven thresholds.
""")
    print(f"Wrote limitation report to {path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Evaluate pretrained detector on LIAR test split.")
    parser.add_argument("--max-samples", type=int, default=None, help="Limit number of samples.")
    args = parser.parse_args()
    main(max_samples=args.max_samples)
