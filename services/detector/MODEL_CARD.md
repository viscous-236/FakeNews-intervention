# Model Card: hamzab-roberta-fake-news-classification

> **IMPORTANT DISCLAIMER**
>
> This model is a **text classifier**, not an independent fact-checking system.
> A model prediction (p_fake score) does **not** prove that a news claim is true
> or false. All final assessments are made by human administrators.
> A prediction never directly penalizes a user or creates a reputation event.
> See RUL-001 and REQ-008 in the implementation plan.

---

## Model Summary

| Field | Value |
|:------|:------|
| **Model Name** | hamzab-roberta-fake-news-classification |
| **HuggingFace ID** | `hamzab/roberta-fake-news-classification` |
| **Original Author** | hamzab (HuggingFace user) |
| **Architecture** | RoBERTa-base (125M parameters) |
| **Framework** | PyTorch + HuggingFace Transformers |
| **License** | MIT |
| **Pinned Revision** | `648014ea36ff8aff85b6a6ee25e77579c27bcf19` |
| **Weight Format** | SafeTensors (`model.safetensors`) |
| **Download Date** | See `artifacts/metadata.json` |
| **Max Sequence Length** | 512 tokens |

---

## Label Mapping

**Verified against `config.json` downloaded from HuggingFace.**

| Class Index | Label | p_fake meaning |
|:------------|:------|:---------------|
| `0` | **Fake** | `p_fake = softmax(logits)[0]` |
| `1` | **Real** | `1 - p_fake` |

> Never assume class ordering. This mapping was verified by inspecting
> `id2label` in the model's `config.json` and is enforced at startup by
> `app/model.py:load_model()`. The process will refuse to start if the
> mapping does not match.

---

## Input Format

Per the model card on HuggingFace:

```
<title> TITLE HERE <content> CONTENT HERE <end>
```

Since our platform does not have a separate title field (posts have a single
body text), we use:

```
<title>  <content> {preprocessed_text} <end>
```

The title section is intentionally left empty. The full post body is used
as the content.

### Preprocessing Pipeline (`app/preprocess.py`)

Applied before the model's template formatting:

1. **Unicode NFKC normalization** — normalizes fullwidth characters, ligatures, etc.
2. **URL replacement** — `https?://\S+` → `<url>`
3. **Mention replacement** — `@\w+` → `<user>`
4. **Whitespace collapsing** — multiple whitespace → single space
5. **Strip** — leading/trailing whitespace removed

Lowercasing is performed by the RoBERTa tokenizer, not by preprocessing.

---

## Inference Requirements

| Requirement | Value |
|:------------|:------|
| Python | 3.12 |
| PyTorch | ≥ 2.2.0 |
| Transformers | ≥ 4.40.0 |
| SafeTensors | ≥ 0.4.3 |
| Device | CPU (default) or CUDA |
| RAM (CPU) | ~500 MB (RoBERTa-base weights + inference overhead) |
| Internet at runtime | **Not required** — weights baked into Docker image |

---

## Dataset (Original Author's Training Data)

The model was fine-tuned by its original author. Based on the model card and
repository, it was trained on a **fake news classification dataset** (likely
ISOT or a similar dataset). The exact dataset used by the original author is
not definitively documented in their HuggingFace repository.

> **Note:** We do not claim knowledge of the exact training data. See
> `docs/DATASETS.md` for evaluation dataset details.

---

## Selection Rationale

We selected this pretrained model because:

1. **No training required** — weights are immediately available.
2. **Compatible architecture** — RoBERTa-base performs well on short text.
3. **MIT license** — permits use in our platform.
4. **Input format documented** — `<title> ... <content> ... <end>` template.
5. **Verified label mapping** — `{0: "Fake", 1: "Real"}` confirmed from config.

No model selection algorithm was run (TASK-033/selection criteria not applicable
when not training our own models). This is documented as a deliberate decision.

---

## Evaluation Results

Evaluation was performed on the **LIAR test split** (`ucsbnlp/liar`) which
uses short political statements from PolitiFact.

See `reports/detector_eval.json` and `reports/detector_eval.md` for full results.

> **Honest disclaimer:** The LIAR test split is from the same distribution as
> the likely training data. Reported metrics describe in-domain performance.
> They do NOT represent performance on general social media posts.

---

## Detection Thresholds

Detection bands are computed by the **Node.js backend** (RUL-027), not the
detector. The detector only returns `p_fake ∈ [0, 1]`.

| Variable | Value | Source |
|:---------|:------|:-------|
| `FAKE_THRESHOLD_HIGH` | See `.env.example` | Provisional/data-driven |
| `REAL_THRESHOLD_LOW` | See `.env.example` | Provisional/data-driven |

See `artifacts/thresholds.json` for threshold selection methodology.

---

## Known Risks and Limitations

### False Positives (predicted Fake, actually Real)
- Satirical content may be misclassified as fake.
- Opinion pieces and strongly-worded statements may score high on p_fake.
- Scientific claims with unusual phrasing may be flagged.
- **Risk:** An `auto_flagged` label appears on a true post. Human admin review
  prevents this from becoming a permanent assessment.

### False Negatives (predicted Real, actually Fake)
- Professionally crafted disinformation that mimics credible language.
- Domain-shifted content (non-political topics, non-English patterns).
- Short texts where context is insufficient.
- **Risk:** A fake post is not flagged and does not enter the review queue
  unless reported by users.

### Domain Limitations
- Optimized for short political statements (PolitiFact/LIAR style).
- **Not** validated for long-form articles, scientific claims, or non-English text.
- Social media post style may differ significantly from the training distribution.

### What This Model Cannot Do
- It cannot verify external facts or look up current events.
- It cannot understand images, audio, or video.
- It cannot replace human editorial judgment.
- A high p_fake score is a signal for human review, not a verdict.

---

## Architectural Constraints

Per the implementation plan (RUL-001, REQ-008, REQ-009):

- The detector **only** returns `p_fake`. It never returns labels, bands, or verdicts.
- A prediction **never** creates a reputation event.
- A prediction **never** penalizes a user.
- Human admin assessment is the only route to user reputation changes.
- Detection bands (`likely_fake`, `uncertain`, `likely_real`) are computed by the
  Node.js API from `p_fake` and configured thresholds, not by this service.
