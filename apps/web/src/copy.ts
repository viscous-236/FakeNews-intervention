/**
 * UI copy strings (GUD-007).
 *
 * All user-facing strings live here.  Screens import from this module; no
 * string literals appear in component JSX.  Full copy is added in Phase 12
 * alongside each component.
 */

export const copy = {
  app: {
    name: 'FakeNews Intervention Platform',
    tagline: 'Credibility through accountability.',
  },

  // Post labels (RUL-012, RUL-023)
  postLabel: {
    fact_checked_false: 'Fact-check: False',
    fact_checked_true: 'Fact-check: True',
    none: '',
    unverifiable: 'Unverifiable',
    auto_flagged: 'Automated flag: possibly false',
  } as const,

  // Tier badges (RUL-011)
  tier: {
    trusted: 'Trusted',
    neutral: 'Neutral',
    low: 'Low credibility',
  } as const,

  // Event kinds human-readable labels (v2.0)
  eventKind: {
    RESPONSIBLE_POST: 'Authored verified post (+1)',
    RESPONSIBLE_RESHARE: 'Shared verified post (+1)',
    VALID_REPORT: 'Reported false post (+1)',
    MISINFO_POST: 'Authored false post (-1)',
    MISINFO_RESHARE: 'Shared false post (-1)',
    MISINFO_LIKE: 'Liked false post (-1)',
    REVERSAL: 'Reversal adjustment (+1 / -1)',
  } as const,

  // Void reasons
  voidReason: {
    interaction_retracted: 'Voided (interaction retracted before wave finalization)',
    cap_exceeded: 'Voided (per-wave cap exceeded)',
    assessment_superseded: 'Voided (superseded by new assessment)',
  } as const,

  // Generic
  loading: 'Loading…',
  error: 'Something went wrong. Please try again.',
  empty: 'Nothing here yet.',
} as const;
