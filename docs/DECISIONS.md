# Engineering Decisions

Decisions made for the platform architecture, reputation policy, and when the specification or paper leaves details open (REQ-001).
Format: decision id, task / scope, binding decision, and rationale.

| ID | Task / Scope | Decision | Reason |
|---|---|---|---|
| DEC-001 | Scoring / Social (Likes) | Likes on original posts that are ultimately assessed as `fake` by an admin are penalized with a `MISINFO_LIKE` (-1) reputation event. Liking an already-fake post immediately creates an eligible `MISINFO_LIKE` event. Unliking retracts the like (`deleted_at` set) and voids any unfinalized eligible event (`void_reason = 'interaction_retracted'`). | Enforces social accountability for amplifying falsehoods while providing a clean retraction path before wave finalization. |
| DEC-002 | Scoring Engine (Equations 1 & 2) | Publisher reputation independence: a user's reputation depends exclusively on their own eligible actions and fixed sensitivity $\sigma_i$, never weighted by the publisher's reputation $Q$ or tier. | Faithful to the paper's mathematical formulation: $R_i(w) = n_i^+(w) - n_i^-(w)$ and $Q_i(w+1) = Q_i(w) + \sigma_i \cdot R_i(w)$. |
| DEC-003 | Scoring / Social (Reshares) | Verified-true reshares are rewarded: users who reshare an original post verified as `real` by an admin (`source = 'admin', verdict = 'real'`) receive `RESPONSIBLE_RESHARE` (+1), subject to `MAX_RESPONSIBLE_RESHARE_EVENTS_PER_WAVE = 5`. `auto_real` posts do not reward reshares. | Rewards responsible diffusion of human-verified factual content while bounding Sybil/collusion amplification via per-wave caps. |
| DEC-004 | Scoring / Governance (Viral posts) | Publishers of admin-assessed `fake` posts receive a flat -1 (`MISINFO_POST`) per false post. Penalty never scales with likes, reshares, reach, or engagement volume. | Avoids runaway unbounded penalties and maintains deterministic unit event values per Equation 1. |
| DEC-005 | Scoring / Social (Retraction) | Deleting a reshare before wave finalization voids any `eligible` or `held` event (`void_reason = 'interaction_retracted'`) and auto-closes open appeals. Counted events in finalized waves remain strictly immutable. | Balances user redemption before wave closure with ledger immutability and reproducibility. |
| DEC-006 | Scoring / Social (Comments) | Comments, follows, messages, and blocks never generate reputation events. Comments are excluded from scoring. | Stance and sentiment analysis of unstructured comments would require NLP outside deterministic paper scope. |
