import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { flatten, useAdminAppeals, useResolveAppeal } from '../../api/hooks';
import { copy } from '../../copy';
import { errorMessage } from '../../api/client';
import { formatDateTime } from '../../lib/format';
import type { AdminAppealItem, AppealStatus } from '../../types';
import { Button } from '../../components/ui/Button';
import { CharCount, Select, Textarea } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { Pill, type PillTone } from '../../components/ui/Pill';
import { Tabs } from '../../components/ui/Tabs';
import {
  EmptyState,
  ErrorState,
  LoadMore,
  LoadingRows,
  PageHeader,
} from '../../components/ui/Page';

const tone: Record<AppealStatus, PillTone> = {
  open: 'warning',
  upheld: 'negative',
  overturned: 'positive',
};

/** Admin appeals (TASK-095). */
export function AdminAppealsPage(): React.ReactElement {
  const [status, setStatus] = useState<AppealStatus>('open');
  const appeals = useAdminAppeals(status);
  const items = flatten(appeals.data);
  const [selected, setSelected] = useState<AdminAppealItem | null>(null);

  return (
    <div>
      <PageHeader title={copy.admin.appeals.title} subtitle={copy.admin.appeals.subtitle} />
      <Tabs<AppealStatus>
        label={copy.admin.appeals.title}
        value={status}
        onChange={setStatus}
        items={[
          { value: 'open', label: copy.admin.appeals.tabs.open },
          { value: 'upheld', label: copy.admin.appeals.tabs.upheld },
          { value: 'overturned', label: copy.admin.appeals.tabs.overturned },
        ]}
      />
      {appeals.isLoading ? (
        <LoadingRows rows={3} />
      ) : appeals.isError ? (
        <div className="pt-4">
          <ErrorState
            message={errorMessage(appeals.error, copy.common.error)}
            onRetry={() => void appeals.refetch()}
          />
        </div>
      ) : items.length === 0 ? (
        <div className="pt-4">
          <EmptyState>{copy.admin.appeals.empty}</EmptyState>
        </div>
      ) : (
        <>
          <ul className="divide-y divide-rule">
            {items.map((a) => (
              <li key={a.id} className="flex gap-4 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-small">
                    <Pill tone={tone[a.status]}>{copy.appeals.status[a.status]}</Pill>
                    {a.appellant ? (
                      <Link
                        to={`/u/${a.appellant.username}`}
                        className="font-medium text-ink hover:underline"
                      >
                        @{a.appellant.username}
                      </Link>
                    ) : (
                      <span className="font-mono text-muted">{a.appellantId.slice(0, 8)}</span>
                    )}
                    <span className="text-muted">
                      {copy.admin.appeals.appealedOn(formatDateTime(a.createdAt))}
                    </span>
                  </div>
                  {a.event ? (
                    <p className="mt-1 text-body text-ink">
                      {copy.eventKind[a.event.kind]}
                      {' · '}
                      <Link
                        to={`/admin/posts/${a.event.post.id}`}
                        className="text-muted hover:text-ink hover:underline"
                      >
                        “{a.event.post.excerpt}”
                      </Link>
                    </p>
                  ) : null}
                  <p className="mt-2 whitespace-pre-wrap text-body text-muted">{a.reason}</p>
                  {a.resolutionNote ? (
                    <p className="mt-2 text-body text-ink">
                      <span className="text-small text-muted">{copy.appeals.resolution}: </span>
                      {a.resolutionNote}
                    </p>
                  ) : null}
                </div>
                {a.status === 'open' ? (
                  <div className="shrink-0 self-center">
                    <Button variant="primary" size="sm" onClick={() => setSelected(a)}>
                      {copy.admin.appeals.resolve}
                    </Button>
                  </div>
                ) : null}
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
      {selected ? <ResolveDialog appeal={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

function ResolveDialog({
  appeal,
  onClose,
}: {
  appeal: AdminAppealItem;
  onClose: () => void;
}): React.ReactElement {
  const resolve = useResolveAppeal();
  const [decision, setDecision] = useState<'upheld' | 'overturned'>('upheld');
  const [newVerdict, setNewVerdict] = useState<'real' | 'unverifiable'>('unverifiable');
  const [note, setNote] = useState('');
  const [rationale, setRationale] = useState('');
  const [error, setError] = useState<string | null>(null);
  const noteOk = note.trim().length >= 10 && note.trim().length <= 1000;
  const rationaleOk =
    decision === 'upheld' || (rationale.trim().length >= 10 && rationale.trim().length <= 2000);
  const canSubmit = noteOk && rationaleOk && !resolve.isPending;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    const payload =
      decision === 'upheld'
        ? { appealId: appeal.id, decision: 'upheld' as const, note: note.trim() }
        : {
            appealId: appeal.id,
            decision: 'overturned' as const,
            note: note.trim(),
            newVerdict,
            rationale: rationale.trim(),
          };
    resolve.mutate(payload, {
      onSuccess: onClose,
      onError: (err) => setError(errorMessage(err, copy.common.error)),
    });
  }

  return (
    <Modal isOpen onClose={onClose} title={copy.admin.appeals.dialogTitle}>
      <form onSubmit={submit} className="space-y-4">
        {error ? <ErrorState message={error} compact /> : null}
        <div className="rounded-card border border-border p-3 text-body">
          <p className="text-small text-muted">{copy.admin.appeals.contested}</p>
          <p className="font-medium text-ink">
            {appeal.event ? copy.eventKind[appeal.event.kind] : appeal.eventId}
          </p>
          <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-muted">{appeal.reason}</p>
        </div>
        <fieldset>
          <legend className="text-body font-medium text-ink">
            {copy.admin.appeals.decisionLabel}
          </legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {(['upheld', 'overturned'] as const).map((d) => (
              <label
                key={d}
                className={`flex cursor-pointer items-start gap-3 rounded-control border p-3 ${decision === d ? 'border-ink bg-raised' : 'border-border'}`}
              >
                <input
                  type="radio"
                  name="decision"
                  checked={decision === d}
                  onChange={() => setDecision(d)}
                  className="mt-1"
                />
                <span>
                  <span className="block text-body font-medium text-ink">
                    {d === 'upheld' ? copy.admin.appeals.uphold : copy.admin.appeals.overturn}
                  </span>
                  <span className="block text-small text-muted">
                    {d === 'upheld'
                      ? copy.admin.appeals.upholdHint
                      : copy.admin.appeals.overturnHint}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {decision === 'overturned' ? (
          <>
            <Select
              label={copy.admin.appeals.newVerdictLabel}
              value={newVerdict}
              onChange={(e) => setNewVerdict(e.target.value as 'real' | 'unverifiable')}
            >
              <option value="unverifiable">{copy.admin.workspace.verdict.unverifiable}</option>
              <option value="real">{copy.admin.workspace.verdict.real}</option>
            </Select>
            <Textarea
              label={copy.admin.appeals.rationaleLabel}
              hint={copy.admin.appeals.rationaleHint}
              rows={3}
              maxLength={2000}
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              trailing={<CharCount value={rationale.trim().length} max={2000} />}
            />
          </>
        ) : null}
        <Textarea
          label={copy.admin.appeals.noteLabel}
          hint={copy.admin.appeals.noteHint}
          rows={3}
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          required
          trailing={<CharCount value={note.trim().length} max={1000} />}
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={resolve.isPending}>
            {copy.common.cancel}
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={!canSubmit}
            isLoading={resolve.isPending}
          >
            {resolve.isPending ? copy.admin.appeals.submitting : copy.admin.appeals.submit}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
