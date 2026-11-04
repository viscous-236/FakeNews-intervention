import React from 'react';
import { PostLabel, Tier } from '../../types';
import { copy } from '../../copy';
import { CheckCircle2, AlertTriangle, XCircle, HelpCircle, ShieldCheck } from 'lucide-react';

export function TierBadge({ tier, className = '' }: { tier: Tier; className?: string }): React.ReactElement | null {
  if (tier === 'neutral') return null;

  if (tier === 'trusted') {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-500/30 ${className}`}
        title={copy.tier.trusted}
      >
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{copy.tier.trusted}</span>
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-500/30 ${className}`}
      title={copy.tier.low}
    >
      <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{copy.tier.low}</span>
    </span>
  );
}

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

  const labelConfig: Record<
    PostLabel,
    { text: string; icon: React.ReactNode; style: string }
  > = {
    fact_checked_true: {
      text: copy.postLabel.fact_checked_true,
      icon: <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />,
      style:
        'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-500/30',
    },
    fact_checked_false: {
      text: copy.postLabel.fact_checked_false,
      icon: <XCircle className="h-3.5 w-3.5" aria-hidden="true" />,
      style:
        'bg-rose-50 text-rose-800 ring-1 ring-inset ring-rose-600/20 dark:bg-rose-950/60 dark:text-rose-300 dark:ring-rose-500/30 font-bold',
    },
    auto_flagged: {
      text: copy.postLabel.auto_flagged,
      icon: <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />,
      style:
        'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-950/60 dark:text-amber-300 dark:ring-amber-500/30',
    },
    unverifiable: {
      text: copy.postLabel.unverifiable,
      icon: <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />,
      style:
        'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-500/20 dark:bg-slate-800 dark:text-slate-300',
    },
    none: {
      text: '',
      icon: null,
      style: '',
    },
  };

  const item = labelConfig[label];

  return (
    <div className={`inline-flex flex-wrap items-center gap-1.5 ${className}`}>
      {label !== 'none' && (
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${item.style}`}
        >
          {item.icon}
          <span>{item.text}</span>
        </span>
      )}
      {underAppeal && (
        <span className="inline-flex items-center rounded-full bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700 ring-1 ring-inset ring-purple-600/20 dark:bg-purple-950/50 dark:text-purple-300">
          {copy.post.underAppeal}
        </span>
      )}
    </div>
  );
}

export function StatusChip({
  text,
  variant = 'neutral',
}: {
  text: string;
  variant?: 'success' | 'danger' | 'warning' | 'neutral' | 'info';
}): React.ReactElement {
  const styles = {
    success: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/50 dark:text-emerald-300',
    danger: 'bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-950/50 dark:text-rose-300',
    warning: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950/50 dark:text-amber-300',
    neutral: 'bg-slate-100 text-slate-700 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-300',
    info: 'bg-indigo-50 text-indigo-700 ring-indigo-600/20 dark:bg-indigo-950/50 dark:text-indigo-300',
  };

  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${styles[variant]}`}
    >
      {text}
    </span>
  );
}
