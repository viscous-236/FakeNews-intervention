import React from 'react';
import { Link } from 'react-router-dom';
import { flatten, useAdminQueue } from '../../api/hooks';
import { copy } from '../../copy';
import { errorMessage } from '../../api/client';
import { formatRelative } from '../../lib/format';
import { Avatar } from '../../components/ui/Avatar';
import { PostLabelBadge, TierBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Pill } from '../../components/ui/Pill';
import {
  EmptyState,
  ErrorState,
  LoadMore,
  LoadingRows,
  PageHeader,
} from '../../components/ui/Page';

const reasonTone = {
  reported: 'negative',
  likely_fake: 'warning',
  uncertain: 'neutral',
  detector_failed: 'neutral',
  held: 'accent',
} as const;

/** Review queue (TASK-093): rows on the sheet, priority first, one action per row. */
export function AdminQueuePage(): React.ReactElement {
  const queue = useAdminQueue();
  const items = flatten(queue.data);

  return (
    <div>
      <PageHeader title={copy.admin.queue.title} subtitle={copy.admin.queue.subtitle} />
      {queue.isLoading ? (
        <LoadingRows rows={4} />
      ) : queue.isError ? (
        <ErrorState
          message={errorMessage(queue.error, copy.common.error)}
          onRetry={() => void queue.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState>{copy.admin.queue.empty}</EmptyState>
      ) : (
        <>
          <ul className="divide-y divide-rule">
            {items.map((item) => (
              <li key={item.post.id} className="flex gap-4 py-4">
                <div className="w-12 shrink-0 text-right">
                  <span className="num block font-mono text-kpi text-ink">{item.priority}</span>
                  <span className="text-small text-muted">{copy.admin.queue.priority}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Avatar
                      avatarUrl={item.post.author.avatarUrl}
                      displayName={item.post.author.displayName}
                      username={item.post.author.username}
                      size="xs"
                    />
                    <span className="text-body font-medium text-ink">
                      {item.post.author.displayName}
                    </span>
                    <span className="text-small text-muted">@{item.post.author.username}</span>
                    <TierBadge tier={item.post.author.tier} />
                    <time dateTime={item.post.createdAt} className="text-small text-muted">
                      {formatRelative(item.post.createdAt)}
                    </time>
                  </div>
                  <p className="mt-1 line-clamp-3 text-body text-ink">{item.post.body}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {item.reasons.map((r) => (
                      <Pill key={r} tone={reasonTone[r as keyof typeof reasonTone] ?? 'neutral'}>
                        {copy.admin.queue.reasons[r as keyof typeof copy.admin.queue.reasons] ?? r}
                      </Pill>
                    ))}
                    <PostLabelBadge label={item.post.label} underAppeal={item.post.underAppeal} />
                    <span className="num text-small text-muted">
                      {copy.admin.queue.openReports(item.openReports)} ·{' '}
                      {copy.admin.queue.shares(item.reshares)}
                      {item.post.adminView?.detection.pFake
                        ? ` · p_fake ${item.post.adminView.detection.pFake}`
                        : ''}
                    </span>
                  </div>
                </div>
                <div className="shrink-0 self-center">
                  <Link to={`/admin/posts/${item.post.id}`}>
                    <Button variant="secondary" size="sm">
                      {copy.admin.queue.review}
                    </Button>
                  </Link>
                </div>
              </li>
            ))}
          </ul>
          <LoadMore
            hasMore={Boolean(queue.hasNextPage)}
            isLoading={queue.isFetchingNextPage}
            onLoad={() => void queue.fetchNextPage()}
            total={items.length}
          />
        </>
      )}
    </div>
  );
}
