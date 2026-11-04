import React from 'react';
import type { PostLabel, Tier } from '../../types';
import { copy } from '../../copy';
import { Pill } from './Pill';

/** Tier badge per RUL-011: neutral shows nothing. */
export function TierBadge({
  tier,
  className = '',
}: {
  tier: Tier;
  className?: string;
}): React.ReactElement | null {
  if (tier === 'neutral') return null;
  if (tier === 'trusted') {
    return (
      <Pill tone="positive" className={className} title={copy.tier.trusted}>
        {copy.tier.trusted}
      </Pill>
    );
  }
  return (
    <Pill tone="warning" className={className} title={copy.tier.low}>
      {copy.tier.low}
    </Pill>
  );
}

const labelTone: Record<
  Exclude<PostLabel, 'none'>,
  'positive' | 'negative' | 'warning' | 'neutral'
> = {
  fact_checked_true: 'positive',
  fact_checked_false: 'negative',
  auto_flagged: 'warning',
  unverifiable: 'neutral',
};

/** Post label per RUL-012 and Section 1.8 copy; `none` renders nothing unless under appeal. */
export function PostLabelBadge({
  label,
  underAppeal = false,
  className = '',
}: {
  label: PostLabel;
  underAppeal?: boolean;
  className?: string;
}): React.ReactElement | null {
  if (label === 'none' && !underAppeal) return null;
  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 ${className}`}>
      {label !== 'none' ? <Pill tone={labelTone[label]}>{copy.postLabel[label]}</Pill> : null}
      {underAppeal ? <Pill tone="neutral">{copy.post.underAppeal}</Pill> : null}
    </span>
  );
}
