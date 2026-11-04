import React from 'react';

export type PillTone = 'positive' | 'negative' | 'warning' | 'neutral' | 'accent';

const tones: Record<PillTone, string> = {
  positive: 'bg-positive-bg text-positive-ink',
  negative: 'bg-negative-bg text-negative-ink',
  warning: 'bg-warning-bg text-warning-ink border border-warning-edge',
  neutral: 'bg-neutralpill-bg text-neutralpill-ink',
  accent: 'bg-accent-tint text-accent-ink',
};

/** A pale tint with dark ink of the same hue; never squeezed (nowrap, flex-none). */
export function Pill({
  tone = 'neutral',
  children,
  className = '',
  title,
}: {
  tone?: PillTone;
  children: React.ReactNode;
  className?: string;
  title?: string;
}): React.ReactElement {
  return (
    <span
      title={title}
      className={`inline-flex flex-none items-center gap-1 whitespace-nowrap rounded-chip px-2 h-5 text-small font-medium leading-none ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** A small count badge for queues that need action. */
export function CountBadge({
  count,
  label,
}: {
  count: number;
  label: string;
}): React.ReactElement | null {
  if (count <= 0) return null;
  return (
    <span
      className="num inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-negative px-1.5 text-[11px] font-semibold text-white"
      aria-label={label}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
