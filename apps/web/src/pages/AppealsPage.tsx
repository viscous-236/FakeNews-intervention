import React from 'react';
import { flatten, useAppeals } from '../api/hooks';
import { copy } from '../copy';
import { errorMessage } from '../api/client';
import { formatDate } from '../lib/format';
import type { AppealStatus } from '../types';
import { Pill, type PillTone } from '../components/ui/Pill';
import { EmptyState, ErrorState, LoadMore, LoadingRows, PageHeader } from '../components/ui/Page';

const tone: Record<AppealStatus, PillTone> = {
  open: 'warning',
  upheld: 'negative',
  overturned: 'positive',
};

export function AppealsPage(): React.ReactElement {
  const appeals = useAppeals();
  const items = flatten(appeals.data);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={copy.appeals.title} subtitle={copy.appeals.subtitle} />
      {appeals.isLoading ? (
        <LoadingRows rows={2} />
      ) : appeals.isError ? (
        <ErrorState
          message={errorMessage(appeals.error, copy.common.error)}
          onRetry={() => void appeals.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState>{copy.appeals.empty}</EmptyState>
      ) : (
        <>
          <ul className="divide-y divide-rule">
            {items.map((a) => (
              <li key={a.id} className="py-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone={tone[a.status]}>{copy.appeals.status[a.status]}</Pill>
                  <span className="text-small text-muted">
                    {copy.appeals.submitted(formatDate(a.createdAt))}
                  </span>
                  {a.resolvedAt ? (
                    <span className="text-small text-muted">
                      · {copy.appeals.resolved(formatDate(a.resolvedAt))}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-small text-muted">{copy.appeals.statusHint[a.status]}</p>
                <dl className="mt-3 space-y-3">
                  <div>
                    <dt className="text-small text-muted">{copy.appeals.yourStatement}</dt>
                    <dd className="mt-0.5 whitespace-pre-wrap text-body text-ink">{a.reason}</dd>
                  </div>
                  {a.resolutionNote ? (
                    <div>
                      <dt className="text-small text-muted">{copy.appeals.resolution}</dt>
                      <dd className="mt-0.5 whitespace-pre-wrap text-body text-ink">
                        {a.resolutionNote}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </li>
            ))}
          </ul>
          <LoadMore
            hasMore={Boolean(appeals.hasNextPage)}
            isLoading={appeals.isFetchingNextPage}
            onLoad={() => void appeals.fetchNextPage()}
            total={items.length}
          />
        </>
      )}
    </div>
  );
}
