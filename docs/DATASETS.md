# Datasets

This document records all datasets used by or evaluated against the detector
service, including their sources, licenses, and limitations.

---

## 1. Evaluation Dataset: LIAR

| Field | Value |
|:------|:------|
| **Name** | LIAR |
| **HuggingFace ID** | `ucsbnlp/liar` |
| **Source** | Wang, William Yang. "Liar, Liar Pants on Fire: A New Benchmark Dataset for Fake News Detection." ACL 2017. |
| **Original URL** | https://huggingface.co/datasets/ucsbnlp/liar |
| **License** | See dataset repository (ACL 2017 workshop data) |
| **Size** | Train: 10,269 / Validation: 1,284 / Test: 1,283 statements |
| **Domain** | Short political statements from PolitiFact.com |
| **Language** | English |

### Description

LIAR consists of 12,836 short statements from PolitiFact, each labeled with
one of 6 fine-grained veracity classes:
`pants-fire`, `false`, `barely-true`, `half-true`, `mostly-true`, `true`.

### Binary Mapping Used for Evaluation

We map the 6-class labels to binary fake/real as follows:

| Original Label | Binary Class |
|:---------------|:-------------|
| `pants-fire` | Fake (0) |
| `false` | Fake (0) |
| `barely-true` | Fake (0) |
| `half-true` | Real (1) |
| `mostly-true` | Real (1) |
| `true` | Real (1) |

This mapping was chosen to be conservative: only statements PolitiFact rated
as fully or mostly true are treated as "Real" for detection purposes.

### How LIAR is Used

- **Evaluation only**: We evaluate the pretrained model on the LIAR **test split**.
- **Not for training**: We do not train or fine-tune any model on this dataset.
- **Threshold selection**: The LIAR **validation split** is used to select
  detection thresholds (FAKE_THRESHOLD_HIGH, REAL_THRESHOLD_LOW).

### Citation

```bibtex
@inproceedings{wang-2017-liar,
    title = "``Liar, Liar Pants on Fire'': A New Benchmark Dataset for Fake News Detection",
    author = "Wang, William Yang",
    booktitle = "Proceedings of the 55th Annual Meeting of the Association for Computational Linguistics (Volume 2: Short Papers)",
    month = jul,
    year = "2017",
    address = "Vancouver, Canada",
    publisher = "Association for Computational Linguistics",
    url = "https://aclanthology.org/P17-2067",
    doi = "10.18653/v1/P17-2067",
    pages = "422--426",
}
```

### Limitations

> **Domain limitation (CON-009):** The LIAR dataset consists of short political
> statements from PolitiFact. Our platform allows general social media posts
> about any topic. Detection performance on general posts may differ
> significantly from metrics reported on LIAR.

- Not representative of social media text style.
- Labeled by PolitiFact fact-checkers, not crowdsourced.
- English-only.
- Does not cover recent events (data through 2017).
- The binary mapping of `barely-true` → Fake and `half-true` → Real is a
  deliberate threshold choice; different mappings would yield different metrics.

---

## 2. Pretrained Model — Original Training Data

| Field | Value |
|:------|:------|
| **Model** | `hamzab/roberta-fake-news-classification` |
| **Original training data** | Not definitively documented by model author |
| **Likely source** | ISOT Fake News Dataset or similar (based on model card) |

The exact training data used by the original model author (`hamzab`) is not
fully documented in their HuggingFace repository. We do not reproduce or
redistribute any training data.

---

## Data Governance

- No user post content is stored in training datasets.
- No personally identifiable information (PII) from platform users is used
  for model training or evaluation.
- The evaluation scripts download datasets from public HuggingFace repositories
  only during model evaluation, not at runtime.
- At runtime, the container has no internet access (`TRANSFORMERS_OFFLINE=1`).
