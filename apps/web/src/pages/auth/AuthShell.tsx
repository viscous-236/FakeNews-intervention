import React from 'react';
import { copy } from '../../copy';
import { Pill } from '../../components/ui/Pill';

/**
 * Auth screens: the form on the left, and on wide screens the product's own
 * facts on the right so the first screen says what this is.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="grid gap-12 py-6 sm:py-12 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:gap-20">
      <div>
        <p className="text-small text-muted">{copy.app.name}</p>
        <h1 className="mt-1 text-title text-ink">{title}</h1>
        {subtitle ? <p className="mt-1 text-body text-muted">{subtitle}</p> : null}
        <div className="mt-6">{children}</div>
        {footer ? <div className="mt-6 text-body text-muted">{footer}</div> : null}
      </div>

      <aside className="hidden lg:block" aria-label={copy.feed.howScoringWorks}>
        <div className="rounded-sheet bg-raised p-8">
          <h2 className="text-section text-ink">{copy.feed.howScoringWorks}</h2>
          <p className="mt-2 max-w-reading text-body text-muted">{copy.feed.scoringBlurb}</p>
          <p className="mt-4 font-mono text-section text-ink">{copy.score.formula}</p>
          <p className="font-mono text-body text-muted">{copy.score.formulaR}</p>
          <dl className="mt-6 divide-y divide-border">
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-body text-muted">A reviewer confirmed the post</dt>
              <dd>
                <Pill tone="positive">{copy.postLabel.fact_checked_true}</Pill>
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-body text-muted">A reviewer found it false</dt>
              <dd>
                <Pill tone="negative">{copy.postLabel.fact_checked_false}</Pill>
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-body text-muted">The automated check flagged it for review</dt>
              <dd>
                <Pill tone="warning">Automated check: may be misleading</Pill>
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-body text-muted">Could not be verified</dt>
              <dd>
                <Pill tone="neutral">{copy.postLabel.unverifiable}</Pill>
              </dd>
            </div>
          </dl>
        </div>
      </aside>
    </div>
  );
}
