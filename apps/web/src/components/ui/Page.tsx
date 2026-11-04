import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { copy } from '../../copy';
import { Button, Spinner } from './Button';

/** Title row: a 22px noun, an optional one-line subtitle, and the one primary action. */
export function PageHeader({
  title,
  subtitle,
  action,
  backTo,
  backLabel,
}: {
  title: string;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  backTo?: string;
  backLabel?: string;
}): React.ReactElement {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {backTo ? (
          <Link
            to={backTo}
            className="mb-2 inline-flex items-center gap-1 text-small text-muted hover:text-ink"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            {backLabel ?? copy.common.back}
          </Link>
        ) : null}
        <h1 className="text-title text-ink">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-reading text-body text-muted">{subtitle}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </header>
  );
}

/** A section heading outside its panel. */
export function SectionTitle({
  children,
  trailing,
  as: Tag = 'h2',
}: {
  children: React.ReactNode;
  trailing?: React.ReactNode;
  as?: 'h2' | 'h3';
}): React.ReactElement {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <Tag className="text-section text-ink">{children}</Tag>
      {trailing}
    </div>
  );
}

/** A card: 1px border, 8px radius, no shadow. */
export function Panel({
  children,
  className = '',
  padded = true,
  as: Tag = 'div',
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
  as?: 'div' | 'section' | 'article' | 'form';
}): React.ReactElement {
  return (
    <Tag
      className={`rounded-card border border-border bg-surface ${padded ? 'p-5' : ''} ${className}`}
    >
      {children}
    </Tag>
  );
}

/** A notice: pale amber strip with a 1px edge, never a ground. */
export function Notice({
  tone = 'warning',
  children,
  action,
}: {
  tone?: 'warning' | 'negative' | 'positive' | 'neutral';
  children: React.ReactNode;
  action?: React.ReactNode;
}): React.ReactElement {
  const tones = {
    warning: 'bg-warning-bg border-warning-edge text-warning-ink',
    negative: 'bg-negative-bg border-negative/30 text-negative-ink',
    positive: 'bg-positive-bg border-positive/30 text-positive-ink',
    neutral: 'bg-raised border-border text-ink',
  };
  return (
    <div
      role={tone === 'negative' ? 'alert' : 'status'}
      className={`flex flex-col gap-2 rounded-card border px-4 py-3 text-body sm:flex-row sm:items-center sm:justify-between ${tones[tone]}`}
    >
      <div>{children}</div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** Loading: the final layout with grey bars at real size, no shimmer. */
export function Skeleton({
  className = '',
  lines = 1,
}: {
  className?: string;
  lines?: number;
}): React.ReactElement {
  return (
    <div className={`space-y-2 ${className}`} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-4 rounded bg-raised"
          style={{ width: `${100 - (i % 3) * 12}%` }}
        />
      ))}
    </div>
  );
}

export function LoadingRows({ rows = 3 }: { rows?: number }): React.ReactElement {
  return (
    <div role="status" aria-label={copy.common.loading} className="divide-y divide-rule">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 py-4">
          <div className="h-10 w-10 shrink-0 rounded-full bg-raised" />
          <div className="flex-1">
            <Skeleton lines={3} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function LoadingBlock({
  label = copy.common.loading,
}: {
  label?: string;
}): React.ReactElement {
  return (
    <div role="status" className="flex items-center gap-2 py-8 text-body text-muted">
      <Spinner />
      {label}
    </div>
  );
}

/** Empty: the frame stays, with one sentence and, when it exists, the first action. */
export function EmptyState({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="rounded-card border border-dashed border-control px-4 py-8 text-center">
      <p className="text-body text-muted">{children}</p>
      {action ? <div className="mt-3 flex justify-center">{action}</div> : null}
    </div>
  );
}

/** Error, inside the block that failed, with a retry. */
export function ErrorState({
  message,
  onRetry,
  compact = false,
}: {
  message: string;
  onRetry?: () => void;
  compact?: boolean;
}): React.ReactElement {
  return (
    <div
      role="alert"
      className={`flex flex-wrap items-center justify-between gap-3 rounded-card border border-negative/30 bg-negative-bg text-negative-ink ${compact ? 'px-3 py-2 text-small' : 'px-4 py-3 text-body'}`}
    >
      <span>{message}</span>
      {onRetry ? (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          {copy.common.retry}
        </Button>
      ) : null}
    </div>
  );
}

/** "Load more" footer for cursor-paged lists. */
export function LoadMore({
  hasMore,
  isLoading,
  onLoad,
  total,
}: {
  hasMore: boolean;
  isLoading: boolean;
  onLoad: () => void;
  total?: number;
}): React.ReactElement | null {
  if (!hasMore) {
    return total !== undefined && total > 0 ? (
      <p className="py-4 text-center text-small text-muted">{copy.common.endOfList}</p>
    ) : null;
  }
  return (
    <div className="flex justify-center py-4">
      <Button variant="secondary" onClick={onLoad} isLoading={isLoading}>
        {copy.common.loadMore}
      </Button>
    </div>
  );
}

/** Key–value line used in detail panels: label left in grey, value right in ink. */
export function KeyValue({
  label,
  children,
  mono = false,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}): React.ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-body">
      <dt className="text-muted">{label}</dt>
      <dd className={`text-right text-ink ${mono ? 'font-mono num' : 'num'}`}>{children}</dd>
    </div>
  );
}
