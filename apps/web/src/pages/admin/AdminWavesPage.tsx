import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { flatten, useAdminLedger, useAdminWaves, useFinalizeWave } from '../../api/hooks';
import { copy } from '../../copy';
import { errorMessage } from '../../api/client';
import { formatDateTime, signed, signedDecimal } from '../../lib/format';
import type { WaveItem } from '../../types';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/Modal';
import { Pill } from '../../components/ui/Pill';
import {
  EmptyState,
  ErrorState,
  LoadMore,
  LoadingBlock,
  Notice,
  PageHeader,
  Panel,
  SectionTitle,
  Skeleton,
} from '../../components/ui/Page';

/** Waves (TASK-096): the open wave, its pending counts, finalize with confirmation, and the ledger viewer. */
export function AdminWavesPage(): React.ReactElement {
  const waves = useAdminWaves();
  const finalize = useFinalizeWave();
  const items = flatten(waves.data);
  const open = items.find((w) => w.status === 'open');
  const finalized = items.filter((w) => w.status === 'finalized');
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ledgerWave, setLedgerWave] = useState<WaveItem | null>(null);

  if (waves.isLoading) return <LoadingBlock />;
  if (waves.isError)
    return (
      <ErrorState
        message={errorMessage(waves.error, copy.common.error)}
        onRetry={() => void waves.refetch()}
      />
    );

  return (
    <div>
      <PageHeader
        title={copy.admin.waves.title}
        subtitle={copy.admin.waves.subtitle}
        action={
          open ? (
            <Button
              variant="primary"
              onClick={() => setConfirm(true)}
              isLoading={finalize.isPending}
            >
              {copy.admin.waves.finalize}
            </Button>
          ) : null
        }
      />

      {result ? (
        <div className="mb-4">
          <Notice tone="positive">{result}</Notice>
        </div>
      ) : null}
      {error ? (
        <div className="mb-4">
          <ErrorState message={error} />
        </div>
      ) : null}

      {open ? (
        <dl className="grid grid-cols-2 divide-border rounded-card border border-border sm:grid-cols-3 sm:divide-x">
          <div className="border-b border-border px-5 py-4 sm:border-b-0">
            <dt className="text-small text-muted">{copy.admin.waves.openWave(open.number)}</dt>
            <dd className="mt-1 text-body text-ink">
              {copy.admin.waves.opened(formatDateTime(open.openedAt))}
            </dd>
            <dd className="mt-1 font-mono text-small text-muted">{open.formulaVersion}</dd>
          </div>
          <div className="border-b border-l border-border px-5 py-4 sm:border-b-0 sm:border-l-0">
            <dt className="text-small text-muted">{copy.admin.waves.pendingEvents}</dt>
            <dd className="num mt-1 text-kpi text-accent">{open.pendingEvents ?? 0}</dd>
          </div>
          <div className="col-span-2 px-5 py-4 sm:col-span-1">
            <dt className="text-small text-muted">{copy.admin.waves.heldEvents}</dt>
            <dd className="num mt-1 text-kpi text-ink">{open.heldEvents ?? 0}</dd>
          </div>
        </dl>
      ) : null}

      <section className="mt-8" aria-labelledby="waves-history">
        <SectionTitle>
          <span id="waves-history">{copy.admin.waves.historyTitle}</span>
        </SectionTitle>
        {finalized.length === 0 ? (
          <EmptyState>{copy.admin.waves.noHistory}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-body">
              <thead>
                <tr className="text-left text-small text-muted">
                  <th className="py-2 pr-3 font-normal">{copy.admin.waves.columns.wave}</th>
                  <th className="py-2 pr-3 font-normal">{copy.admin.waves.columns.opened}</th>
                  <th className="py-2 pr-3 font-normal">{copy.admin.waves.columns.finalized}</th>
                  <th className="py-2 pr-3 font-normal">{copy.admin.waves.columns.by}</th>
                  <th className="num py-2 pr-3 text-right font-normal">
                    {copy.admin.waves.columns.usersScored}
                  </th>
                  <th className="num py-2 pr-3 text-right font-normal">
                    {copy.admin.waves.columns.eventsCounted}
                  </th>
                  <th className="py-2 font-normal" />
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {finalized.map((w) => (
                  <tr key={w.id} className="h-row">
                    <td className="num pr-3 font-medium text-ink">{w.number}</td>
                    <td className="pr-3 text-muted">{formatDateTime(w.openedAt)}</td>
                    <td className="pr-3 text-muted">
                      {w.finalizedAt ? formatDateTime(w.finalizedAt) : copy.common.none}
                    </td>
                    <td className="pr-3">
                      <Pill tone="neutral">
                        {w.finalizedBySystem ? copy.admin.waves.bySystem : copy.admin.waves.byAdmin}
                      </Pill>
                    </td>
                    <td className="num pr-3 text-right">{w.usersScored ?? copy.common.none}</td>
                    <td className="num pr-3 text-right">{w.eventsCounted ?? copy.common.none}</td>
                    <td className="text-right">
                      <Button
                        size="sm"
                        variant={ledgerWave?.id === w.id ? 'secondary' : 'ghost'}
                        onClick={() => setLedgerWave(ledgerWave?.id === w.id ? null : w)}
                      >
                        {copy.admin.waves.ledger}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <LoadMore
              hasMore={Boolean(waves.hasNextPage)}
              isLoading={waves.isFetchingNextPage}
              onLoad={() => void waves.fetchNextPage()}
            />
          </div>
        )}
      </section>

      {ledgerWave ? <LedgerViewer wave={ledgerWave} /> : null}

      <ConfirmDialog
        isOpen={confirm && Boolean(open)}
        onClose={() => setConfirm(false)}
        title={copy.admin.waves.confirmTitle(open?.number ?? 0)}
        body={copy.admin.waves.confirmBody}
        confirmLabel={copy.admin.waves.finalize}
        isLoading={finalize.isPending}
        onConfirm={() => {
          if (!open) return;
          setError(null);
          finalize.mutate(open.id, {
            onSuccess: (r) => {
              setConfirm(false);
              setResult(copy.admin.waves.finalized(r.wave.number, r.usersScored, r.eventsCounted));
            },
            onError: (err) => {
              setConfirm(false);
              setError(errorMessage(err, copy.common.error));
            },
          });
        }}
      />
    </div>
  );
}

function LedgerViewer({ wave }: { wave: WaveItem }): React.ReactElement {
  const ledger = useAdminLedger(wave.id);
  const rows = flatten(ledger.data);
  return (
    <section className="mt-8" aria-labelledby="ledger-title">
      <SectionTitle>
        <span id="ledger-title">{copy.admin.waves.ledgerTitle(wave.number)}</span>
      </SectionTitle>
      <Panel padded={false}>
        {ledger.isLoading ? (
          <div className="p-5">
            <Skeleton lines={4} />
          </div>
        ) : ledger.isError ? (
          <div className="p-5">
            <ErrorState
              message={errorMessage(ledger.error, copy.common.error)}
              onRetry={() => void ledger.refetch()}
              compact
            />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-5">
            <EmptyState>{copy.admin.waves.ledgerEmpty}</EmptyState>
          </div>
        ) : (
          <div className="overflow-x-auto px-5">
            <table className="w-full text-body">
              <thead>
                <tr className="text-left text-small text-muted">
                  <th className="py-2 pr-3 font-normal">{copy.admin.waves.user}</th>
                  <th className="num py-2 pr-3 text-right font-normal">
                    {copy.score.columns.qBefore}
                  </th>
                  <th className="num py-2 pr-3 text-right font-normal">
                    {copy.score.columns.nPos}
                  </th>
                  <th className="num py-2 pr-3 text-right font-normal">
                    {copy.score.columns.nNeg}
                  </th>
                  <th className="num py-2 pr-3 text-right font-normal">
                    {copy.score.columns.nAdj}
                  </th>
                  <th className="num py-2 pr-3 text-right font-normal">{copy.score.columns.r}</th>
                  <th className="num py-2 pr-3 text-right font-normal">σ</th>
                  <th className="num py-2 pr-3 text-right font-normal">
                    {copy.score.columns.delta}
                  </th>
                  <th className="num py-2 text-right font-normal">{copy.score.columns.qAfter}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {rows.map((r) => (
                  <tr key={r.user.id} className="h-row">
                    <td className="pr-3">
                      <Link to={`/u/${r.user.username}`} className="text-ink hover:underline">
                        @{r.user.username}
                      </Link>
                    </td>
                    <td className="num pr-3 text-right text-muted">{r.qBefore}</td>
                    <td className="num pr-3 text-right">{r.nPos}</td>
                    <td className="num pr-3 text-right">{r.nNeg}</td>
                    <td className="num pr-3 text-right">{signed(r.nAdj)}</td>
                    <td className="num pr-3 text-right">{signed(r.r)}</td>
                    <td className="num pr-3 text-right text-muted">{r.sigmaUsed}</td>
                    <td
                      className={`num pr-3 text-right ${Number(r.delta) < 0 ? 'text-negative' : Number(r.delta) > 0 ? 'text-positive' : ''}`}
                    >
                      {signedDecimal(r.delta)}
                    </td>
                    <td className="num text-right font-medium text-ink">{r.qAfter}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <LoadMore
              hasMore={Boolean(ledger.hasNextPage)}
              isLoading={ledger.isFetchingNextPage}
              onLoad={() => void ledger.fetchNextPage()}
            />
          </div>
        )}
      </Panel>
    </section>
  );
}
