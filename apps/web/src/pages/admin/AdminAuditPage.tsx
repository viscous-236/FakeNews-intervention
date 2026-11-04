import React, { useState } from 'react';
import { flatten, useAdminAudit } from '../../api/hooks';
import { copy } from '../../copy';
import { errorMessage } from '../../api/client';
import { formatDateTime, shortId } from '../../lib/format';
import { Button } from '../../components/ui/Button';
import { Pill } from '../../components/ui/Pill';
import {
  EmptyState,
  ErrorState,
  LoadMore,
  LoadingRows,
  PageHeader,
} from '../../components/ui/Page';

const ENTITY_TYPES = ['post', 'assessment', 'appeal', 'user', 'wave', 'detection', 'scores'];

/** Audit log (TASK-097) with the plan's filters: entity type, entity id, actor id. */
export function AdminAuditPage(): React.ReactElement {
  const [draft, setDraft] = useState({ entityType: '', entityId: '', actorId: '', action: '' });
  const [filters, setFilters] = useState<Record<string, string>>({});
  const audit = useAdminAudit(filters);
  const items = flatten(audit.data);

  function apply(e: React.FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(draft)) if (v.trim()) next[k] = v.trim();
    setFilters(next);
  }

  return (
    <div>
      <PageHeader title={copy.admin.audit.title} subtitle={copy.admin.audit.subtitle} />
      <form onSubmit={apply} className="flex flex-wrap items-end gap-2">
        <label className="text-small text-muted">
          {copy.admin.audit.filters.entityType}
          <select
            value={draft.entityType}
            onChange={(e) => setDraft({ ...draft, entityType: e.target.value })}
            className="mt-1 block h-9 rounded-control border border-control bg-surface px-3 text-body text-ink"
          >
            <option value="">{copy.admin.audit.filters.any}</option>
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="text-small text-muted">
          {copy.admin.audit.filters.entityId}
          <input
            value={draft.entityId}
            onChange={(e) => setDraft({ ...draft, entityId: e.target.value })}
            className="mt-1 block h-9 w-56 rounded-control border border-control bg-surface px-3 font-mono text-body text-ink"
          />
        </label>
        <label className="text-small text-muted">
          {copy.admin.audit.filters.actorId}
          <input
            value={draft.actorId}
            onChange={(e) => setDraft({ ...draft, actorId: e.target.value })}
            className="mt-1 block h-9 w-56 rounded-control border border-control bg-surface px-3 font-mono text-body text-ink"
          />
        </label>
        <label className="text-small text-muted">
          {copy.admin.audit.filters.action}
          <input
            value={draft.action}
            onChange={(e) => setDraft({ ...draft, action: e.target.value })}
            placeholder="wave.finalize"
            className="mt-1 block h-9 w-44 rounded-control border border-control bg-surface px-3 font-mono text-body text-ink placeholder:text-faint"
          />
        </label>
        <Button type="submit" variant="secondary">
          {copy.admin.audit.filters.apply}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setDraft({ entityType: '', entityId: '', actorId: '', action: '' });
            setFilters({});
          }}
        >
          {copy.admin.audit.filters.clear}
        </Button>
      </form>

      <div className="mt-5">
        {audit.isLoading ? (
          <LoadingRows rows={4} />
        ) : audit.isError ? (
          <ErrorState
            message={errorMessage(audit.error, copy.common.error)}
            onRetry={() => void audit.refetch()}
          />
        ) : items.length === 0 ? (
          <EmptyState>{copy.admin.audit.empty}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-body">
              <thead>
                <tr className="text-left text-small text-muted">
                  <th className="py-2 pr-3 font-normal">{copy.admin.audit.columns.when}</th>
                  <th className="py-2 pr-3 font-normal">{copy.admin.audit.columns.actor}</th>
                  <th className="py-2 pr-3 font-normal">{copy.admin.audit.columns.action}</th>
                  <th className="py-2 pr-3 font-normal">{copy.admin.audit.columns.entity}</th>
                  <th className="py-2 font-normal">{copy.admin.audit.columns.change}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule align-top">
                {items.map((log) => (
                  <tr key={log.id}>
                    <td className="whitespace-nowrap py-2.5 pr-3 text-muted">
                      {formatDateTime(log.createdAt)}
                    </td>
                    <td className="py-2.5 pr-3">
                      {log.actorKind === 'system' ? (
                        <Pill tone="neutral">{copy.admin.audit.system}</Pill>
                      ) : (
                        <span className="font-mono text-small">
                          {log.actorId ? shortId(log.actorId) : copy.common.none}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-ink">{log.action}</td>
                    <td className="py-2.5 pr-3 font-mono text-small text-muted">
                      {log.entityType}
                      {log.entityId ? ` ${shortId(log.entityId)}` : ''}
                    </td>
                    <td className="py-2.5 font-mono text-small text-muted">
                      {log.before ? <div>before {JSON.stringify(log.before)}</div> : null}
                      {log.after ? <div>after {JSON.stringify(log.after)}</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <LoadMore
              hasMore={Boolean(audit.hasNextPage)}
              isLoading={audit.isFetchingNextPage}
              onLoad={() => void audit.fetchNextPage()}
              total={items.length}
            />
          </div>
        )}
      </div>
    </div>
  );
}
