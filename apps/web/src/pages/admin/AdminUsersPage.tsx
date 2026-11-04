import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { flatten, useAdminUser, useAdminUsers, useSuspendUser } from '../../api/hooks';
import { copy } from '../../copy';
import { errorMessage } from '../../api/client';
import { formatDate, formatDateTime, signed, signedDecimal } from '../../lib/format';
import type { AdminUserItem, UserStatus } from '../../types';
import { Avatar } from '../../components/ui/Avatar';
import { TierBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Textarea } from '../../components/ui/Field';
import { ConfirmDialog, Modal } from '../../components/ui/Modal';
import { Pill, type PillTone } from '../../components/ui/Pill';
import {
  EmptyState,
  ErrorState,
  KeyValue,
  LoadMore,
  LoadingRows,
  PageHeader,
  Skeleton,
} from '../../components/ui/Page';

const statusTone: Record<UserStatus, PillTone> = {
  active: 'positive',
  suspended: 'negative',
  deleted: 'neutral',
};

/** Users (TASK-097): search, suspend with an audited reason, and score history. */
export function AdminUsersPage(): React.ReactElement {
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<UserStatus | ''>('');
  const users = useAdminUsers(q, status);
  const items = flatten(users.data);
  const [target, setTarget] = useState<AdminUserItem | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  return (
    <div>
      <PageHeader title={copy.admin.users.title} />
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(draft.trim());
        }}
      >
        <div className="min-w-[240px] flex-1">
          <label htmlFor="admin-user-search" className="sr-only">
            {copy.admin.users.searchPlaceholder}
          </label>
          <input
            id="admin-user-search"
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={copy.admin.users.searchPlaceholder}
            className="h-9 w-full rounded-control border border-control bg-surface px-3 text-body placeholder:text-faint"
          />
        </div>
        <div>
          <label htmlFor="admin-user-status" className="sr-only">
            {copy.admin.users.statusFilter}
          </label>
          <select
            id="admin-user-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as UserStatus | '')}
            className="h-9 rounded-control border border-control bg-surface px-3 text-body"
          >
            <option value="">{copy.admin.users.allStatuses}</option>
            <option value="active">{copy.admin.users.status.active}</option>
            <option value="suspended">{copy.admin.users.status.suspended}</option>
            <option value="deleted">{copy.admin.users.status.deleted}</option>
          </select>
        </div>
        <Button type="submit" variant="secondary">
          {copy.admin.users.search}
        </Button>
      </form>

      <div className="mt-5">
        {users.isLoading ? (
          <LoadingRows rows={4} />
        ) : users.isError ? (
          <ErrorState
            message={errorMessage(users.error, copy.common.error)}
            onRetry={() => void users.refetch()}
          />
        ) : items.length === 0 ? (
          <EmptyState>{copy.admin.users.empty}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-body">
              <thead>
                <tr className="text-left text-small text-muted">
                  <th className="py-2 pr-3 font-normal">{copy.admin.users.columns.user}</th>
                  <th className="py-2 pr-3 font-normal">{copy.admin.users.columns.email}</th>
                  <th className="num py-2 pr-3 text-right font-normal">
                    {copy.admin.users.columns.q}
                  </th>
                  <th className="num py-2 pr-3 text-right font-normal">
                    {copy.admin.users.columns.sigma}
                  </th>
                  <th className="py-2 pr-3 font-normal">{copy.admin.users.columns.tier}</th>
                  <th className="py-2 pr-3 font-normal">{copy.admin.users.columns.status}</th>
                  <th className="py-2 pr-3 font-normal">{copy.admin.users.columns.joined}</th>
                  <th className="py-2 font-normal" />
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {items.map((u) => (
                  <tr key={u.id} className="h-row">
                    <td className="pr-3">
                      <button
                        type="button"
                        onClick={() => setDetailId(u.id)}
                        className="flex items-center gap-2 text-left hover:underline"
                      >
                        <Avatar
                          avatarUrl={u.avatarUrl}
                          displayName={u.displayName}
                          username={u.username}
                          size="xs"
                        />
                        <span>
                          <span className="block text-ink">{u.displayName}</span>
                          <span className="block text-small text-muted">
                            @{u.username}
                            {u.role === 'admin' ? ' · admin' : ''}
                          </span>
                        </span>
                      </button>
                    </td>
                    <td className="pr-3 text-muted">{u.email}</td>
                    <td className="num pr-3 text-right">{u.q}</td>
                    <td className="num pr-3 text-right text-muted">{u.sigma}</td>
                    <td className="pr-3">
                      {u.tier === 'neutral' ? (
                        <span className="text-muted">{copy.tier.neutral}</span>
                      ) : (
                        <TierBadge tier={u.tier} />
                      )}
                    </td>
                    <td className="pr-3">
                      <Pill tone={statusTone[u.status]}>{copy.admin.users.status[u.status]}</Pill>
                    </td>
                    <td className="pr-3 text-muted">{formatDate(u.createdAt)}</td>
                    <td className="text-right">
                      {u.status !== 'deleted' && u.role !== 'admin' ? (
                        <Button
                          size="sm"
                          variant={u.status === 'suspended' ? 'secondary' : 'danger'}
                          onClick={() => setTarget(u)}
                        >
                          {u.status === 'suspended'
                            ? copy.admin.users.unsuspend
                            : copy.admin.users.suspend}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <LoadMore
              hasMore={Boolean(users.hasNextPage)}
              isLoading={users.isFetchingNextPage}
              onLoad={() => void users.fetchNextPage()}
              total={items.length}
            />
          </div>
        )}
      </div>

      {target ? <SuspendDialog user={target} onClose={() => setTarget(null)} /> : null}
      {detailId ? <UserDetailDialog id={detailId} onClose={() => setDetailId(null)} /> : null}
    </div>
  );
}

function SuspendDialog({
  user,
  onClose,
}: {
  user: AdminUserItem;
  onClose: () => void;
}): React.ReactElement {
  const suspend = useSuspendUser();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const isSuspended = user.status === 'suspended';
  const ok = reason.trim().length >= 5 && reason.trim().length <= 1000;
  return (
    <ConfirmDialog
      isOpen
      onClose={onClose}
      title={
        isSuspended
          ? copy.admin.users.unsuspendTitle(user.username)
          : copy.admin.users.suspendTitle(user.username)
      }
      body={isSuspended ? copy.admin.users.unsuspendBody : copy.admin.users.suspendBody}
      confirmLabel={isSuspended ? copy.admin.users.unsuspend : copy.admin.users.suspend}
      danger={!isSuspended}
      isLoading={suspend.isPending}
      onConfirm={() => {
        if (!ok) return;
        suspend.mutate(
          { id: user.id, suspend: !isSuspended, reason: reason.trim() },
          { onSuccess: onClose, onError: (err) => setError(errorMessage(err, copy.common.error)) },
        );
      }}
    >
      {error ? (
        <div className="mb-3">
          <ErrorState message={error} compact />
        </div>
      ) : null}
      <Textarea
        label={copy.admin.users.reasonLabel}
        hint={copy.admin.users.reasonHint}
        rows={3}
        maxLength={1000}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        required
      />
    </ConfirmDialog>
  );
}

function UserDetailDialog({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}): React.ReactElement {
  const detail = useAdminUser(id);
  const d = detail.data;
  return (
    <Modal
      isOpen
      onClose={onClose}
      title={d ? `${d.user.displayName} · @${d.user.username}` : copy.admin.users.detailTitle}
      size="lg"
    >
      {detail.isLoading ? (
        <Skeleton lines={6} />
      ) : detail.isError || !d ? (
        <ErrorState
          message={errorMessage(detail.error, copy.common.error)}
          onRetry={() => void detail.refetch()}
          compact
        />
      ) : (
        <div className="space-y-6">
          <dl className="divide-y divide-rule">
            <KeyValue label={copy.admin.users.columns.email}>{d.user.email}</KeyValue>
            <KeyValue label={copy.admin.users.columns.q} mono>
              {d.user.q}
            </KeyValue>
            <KeyValue label={copy.admin.users.columns.sigma} mono>
              {d.user.sigma}
            </KeyValue>
            <KeyValue label={copy.admin.users.columns.status}>
              <Pill tone={statusTone[d.user.status]}>{copy.admin.users.status[d.user.status]}</Pill>
            </KeyValue>
            <KeyValue label={copy.admin.users.columns.joined}>
              {formatDateTime(d.user.createdAt)}
            </KeyValue>
          </dl>
          <p className="text-small text-muted">
            {copy.admin.users.counts(d.counts.posts, d.counts.followers, d.counts.following)}
          </p>

          <section>
            <h3 className="text-section text-ink">{copy.admin.users.ledgerTitle}</h3>
            {d.ledger.length === 0 ? (
              <p className="mt-2 text-body text-muted">{copy.score.noHistory}</p>
            ) : (
              <table className="mt-2 w-full text-body">
                <thead>
                  <tr className="text-left text-small text-muted">
                    <th className="py-1 pr-3 font-normal">{copy.score.columns.wave}</th>
                    <th className="num py-1 pr-3 text-right font-normal">
                      {copy.score.columns.qBefore}
                    </th>
                    <th className="num py-1 pr-3 text-right font-normal">{copy.score.columns.r}</th>
                    <th className="num py-1 pr-3 text-right font-normal">
                      {copy.score.columns.delta}
                    </th>
                    <th className="num py-1 text-right font-normal">{copy.score.columns.qAfter}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {d.ledger.map((r) => (
                    <tr key={r.waveNumber}>
                      <td className="num py-1.5 pr-3">{r.waveNumber}</td>
                      <td className="num py-1.5 pr-3 text-right text-muted">{r.qBefore}</td>
                      <td className="num py-1.5 pr-3 text-right">{signed(r.r)}</td>
                      <td className="num py-1.5 pr-3 text-right">{signedDecimal(r.delta)}</td>
                      <td className="num py-1.5 text-right font-medium">{r.qAfter}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section>
            <h3 className="text-section text-ink">{copy.admin.users.eventsTitle}</h3>
            {d.events.length === 0 ? (
              <p className="mt-2 text-body text-muted">{copy.score.noEvents}</p>
            ) : (
              <ul className="mt-2 divide-y divide-rule">
                {d.events.slice(0, 20).map((ev) => (
                  <li key={ev.id} className="flex items-center gap-3 py-2 text-body">
                    <span
                      className={`num w-8 font-mono ${ev.value > 0 ? 'text-positive' : 'text-negative'}`}
                    >
                      {signed(ev.value)}
                    </span>
                    <span className="flex-1 text-ink">{copy.eventKind[ev.kind]}</span>
                    <span className="text-small text-muted">{copy.eventStatus[ev.status]}</span>
                    <Link
                      to={`/admin/posts/${ev.postId}`}
                      className="text-small text-accent hover:underline"
                    >
                      {copy.admin.queue.review}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}
