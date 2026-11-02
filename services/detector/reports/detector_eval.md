# Detector Evaluation Report

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
