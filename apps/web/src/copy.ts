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

  // Generic
  loading: 'Loading…',
  error: 'Something went wrong. Please try again.',
  empty: 'Nothing here yet.',
} as const;
