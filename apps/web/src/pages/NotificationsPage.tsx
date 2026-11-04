import React from 'react';
import { Link } from 'react-router-dom';
import { flatten, useMarkNotificationsRead, useNotifications } from '../api/hooks';
import { useNotificationStream } from '../hooks/useNotificationStream';
import { copy } from '../copy';
import { errorMessage } from '../api/client';
import { formatRelative, signedDecimal } from '../lib/format';
import type { NotificationItem } from '../types';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { EmptyState, ErrorState, LoadMore, LoadingRows, PageHeader } from '../components/ui/Page';

function describe(n: NotificationItem): string {
  const t = copy.notifications.text;
  const who = n.actor?.displayName ?? t.someone;
  const payload = n.payload as Record<string, unknown>;
  switch (n.type) {
    case 'post_flagged':
      return t.post_flagged;
    case 'assessment_decided':
      return t.assessment_decided(verdictLabel(String(payload.verdict ?? '')));
    case 'appeal_opened':
      return t.appeal_opened(who);
    case 'appeal_resolved':
      return t.appeal_resolved(String(payload.decision ?? ''));
    case 'report_resolved':
      return t.report_resolved(verdictLabel(String(payload.verdict ?? '')));
    case 'wave_finalized':
      return t.wave_finalized(
        Number(payload.waveNumber ?? 0),
        signedDecimal(String(payload.delta ?? '0.000')),
      );
    case 'new_follower':
      return t.new_follower(who);
    case 'like':
      return t.like(who);
    case 'comment':
      return t.comment(who);
    case 'reshare':
      return t.reshare(who);
    case 'message':
      return t.message(who);
    default:
      return t.generic;
  }
}

function verdictLabel(verdict: string): string {
  const map = copy.admin.workspace.verdict as Record<string, string>;
  return map[verdict] ?? verdict;
}

function hrefFor(n: NotificationItem): string | null {
  if (n.type === 'message' && n.actor) return `/messages/${n.actor.username}`;
  if (n.type === 'wave_finalized') return '/score';
  if (n.type === 'appeal_resolved') return '/appeals';
  if (n.type === 'appeal_opened') return '/admin/appeals';
  if (n.type === 'new_follower' && n.actor) return `/u/${n.actor.username}`;
  if (n.postId) return `/p/${n.postId}`;
  return null;
}

export function NotificationsPage(): React.ReactElement {
  const list = useNotifications();
  const markRead = useMarkNotificationsRead();
  const stream = useNotificationStream();
  const items = flatten(list.data);
  const unread = items.filter((n) => !n.readAt).length;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={copy.notifications.title}
        subtitle={
          <span className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={`inline-block h-2 w-2 rounded-full ${stream === 'live' ? 'bg-positive' : 'bg-control'}`}
            />
            {stream === 'live' ? copy.notifications.live : copy.notifications.polling}
            {unread ? (
              <span className="num">· {copy.notifications.unreadCount(unread)}</span>
            ) : null}
          </span>
        }
        action={
          unread ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => markRead.mutate(undefined)}
              isLoading={markRead.isPending}
            >
              {copy.notifications.markAllRead}
            </Button>
          ) : null
        }
      />

      {list.isLoading ? (
        <LoadingRows rows={4} />
      ) : list.isError ? (
        <ErrorState
          message={errorMessage(list.error, copy.common.error)}
          onRetry={() => void list.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState>{copy.notifications.empty}</EmptyState>
      ) : (
        <>
          <ul className="divide-y divide-rule">
            {items.map((n) => {
              const href = hrefFor(n);
              const inner = (
                <>
                  {n.actor ? (
                    <Avatar
                      avatarUrl={n.actor.avatarUrl}
                      displayName={n.actor.displayName}
                      username={n.actor.username}
                      size="sm"
                    />
                  ) : (
                    <span
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-tint text-small font-semibold text-accent-ink"
                      aria-hidden="true"
                    >
                      Q
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={`text-body ${n.readAt ? 'text-muted' : 'font-medium text-ink'}`}>
                      {describe(n)}
                    </p>
                    <time dateTime={n.createdAt} className="text-small text-muted">
                      {formatRelative(n.createdAt)}
                    </time>
                  </div>
                  {!n.readAt ? (
                    <span
                      className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent"
                      aria-label={copy.notifications.unreadCount(1)}
                    />
                  ) : null}
                </>
              );
              const cls = 'flex items-start gap-3 py-3 -mx-2 px-2 rounded-control';
              return (
                <li key={n.id}>
                  {href ? (
                    <Link
                      to={href}
                      className={`${cls} hover:bg-raised/60`}
                      onClick={() => {
                        if (!n.readAt) markRead.mutate([n.id]);
                      }}
                    >
                      {inner}
                    </Link>
                  ) : (
                    <div className={cls}>
                      {inner}
                      {!n.readAt ? (
                        <Button size="sm" variant="ghost" onClick={() => markRead.mutate([n.id])}>
                          {copy.notifications.markRead}
                        </Button>
                      ) : null}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <LoadMore
            hasMore={Boolean(list.hasNextPage)}
            isLoading={list.isFetchingNextPage}
            onLoad={() => void list.fetchNextPage()}
            total={items.length}
          />
        </>
      )}
    </div>
  );
}
