import React, { useState } from 'react';
import { flatten, useEvents, useScore, useScoreHistory, useWaveExplanation } from '../api/hooks';
import { copy } from '../copy';
import { errorMessage } from '../api/client';
import { formatDate, signed, signedDecimal } from '../lib/format';
import { TierBadge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import {
  EmptyState,
  ErrorState,
  LoadMore,
  LoadingBlock,
  PageHeader,
  Panel,
  SectionTitle,
  Skeleton,
} from '../components/ui/Page';
import { EventsList } from '../components/score/EventsList';
import { ScoreExplanationDrawer } from '../components/score/ScoreExplanationDrawer';
import { WaveLedgerChart } from '../components/score/WaveLedgerChart';

/**
 * My score (TASK-089/090/091). Every number on this page is the API's
 * string or integer, rendered as-is; projections are computed server-side.
 */
export function ScorePage(): React.ReactElement {
  const score = useScore();
  const history = useScoreHistory();
  const events = useEvents();
  const [explainWave, setExplainWave] = useState<number | null>(null);
  const explanation = useWaveExplanation(explainWave);
  const rows = flatten(history.data);
  const eventItems = flatten(events.data);

  if (score.isLoading) return <LoadingBlock />;
  if (score.isError || !score.data) {
    return (
      <ErrorState
        message={errorMessage(score.error, copy.common.error)}
        onRetry={() => void score.refetch()}
      />
    );
  }
  const s = score.data;
  const pending = s.currentWave.pending;

  return (
    <div>
      <PageHeader title={copy.score.title} subtitle={copy.score.subtitle} />

      {/* KPI strip: one container split by hairlines, label over value. */}
      <dl className="grid grid-cols-2 divide-border rounded-card border border-border sm:grid-cols-4 sm:divide-x">
        <Kpi
          label={copy.score.qLabel}
          value={s.q}
          caption={copy.score.thresholds(s.thresholds.trustedMin, s.thresholds.lowMax)}
          lead
        />
        <Kpi
          label={copy.score.tierLabel}
          value={
            <span className="flex min-h-[34px] items-center">
              {s.tier === 'neutral' ? (
                <span className="text-kpi">{copy.tier.neutral}</span>
              ) : (
                <TierBadge tier={s.tier} />
              )}
            </span>
          }
          caption={copy.score.tierExplainer[s.tier]}
        />
        <Kpi label={copy.score.sigmaLabel} value={s.sigma} caption={copy.score.sigmaHint} />
        <Kpi
          label={copy.score.projectedDelta}
          value={
            <span
              className={
                Number(pending.projectedDelta) < 0
                  ? 'text-negative'
                  : Number(pending.projectedDelta) > 0
                    ? 'text-positive'
                    : ''
              }
            >
              {signedDecimal(pending.projectedDelta)}
            </span>
          }
          caption={copy.score.currentWave(s.currentWave.number)}
        />
      </dl>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_384px]">
        <section aria-labelledby="ledger-title">
          <SectionTitle>
            <span id="ledger-title">{copy.score.ledgerTitle}</span>
          </SectionTitle>
          <Panel>
            <p className="mb-3 text-small text-muted">{copy.score.ledgerChartTitle}</p>
            {history.isLoading ? (
              <Skeleton lines={4} />
            ) : (
              <WaveLedgerChart
                rows={rows}
                projected={{ waveNumber: s.currentWave.number, q: pending.projectedQ }}
              />
            )}
          </Panel>

          <div className="mt-4">
            {history.isLoading ? (
              <Skeleton lines={3} />
            ) : history.isError ? (
              <ErrorState
                message={errorMessage(history.error, copy.common.error)}
                onRetry={() => void history.refetch()}
              />
            ) : rows.length === 0 ? (
              <EmptyState>{copy.score.noHistory}</EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-body">
                  <thead>
                    <tr className="text-left text-small text-muted">
                      <th className="py-2 pr-3 font-normal">{copy.score.columns.wave}</th>
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
                      <th className="num py-2 pr-3 text-right font-normal">
                        {copy.score.columns.r}
                      </th>
                      <th className="num py-2 pr-3 text-right font-normal">
                        {copy.score.columns.delta}
                      </th>
                      <th className="num py-2 pr-3 text-right font-normal">
                        {copy.score.columns.qAfter}
                      </th>
                      <th className="py-2 pr-3 font-normal">{copy.score.columns.finalized}</th>
                      <th className="py-2 font-normal" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rule">
                    {rows.map((r) => (
                      <tr key={r.waveNumber} className="h-row">
                        <td className="num pr-3 font-medium text-ink">{r.waveNumber}</td>
                        <td className="num pr-3 text-right text-muted">{r.qBefore}</td>
                        <td className="num pr-3 text-right">{r.nPos}</td>
                        <td className="num pr-3 text-right">{r.nNeg}</td>
                        <td className="num pr-3 text-right">{signed(r.nAdj)}</td>
                        <td className="num pr-3 text-right">{signed(r.r)}</td>
                        <td
                          className={`num pr-3 text-right ${Number(r.delta) < 0 ? 'text-negative' : Number(r.delta) > 0 ? 'text-positive' : ''}`}
                        >
                          {signedDecimal(r.delta)}
                        </td>
                        <td className="num pr-3 text-right font-medium text-ink">{r.qAfter}</td>
                        <td className="pr-3 text-muted">
                          {r.finalizedAt ? formatDate(r.finalizedAt) : copy.common.none}
                        </td>
                        <td className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setExplainWave(r.waveNumber)}
                          >
                            {copy.score.explain}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <LoadMore
                  hasMore={Boolean(history.hasNextPage)}
                  isLoading={history.isFetchingNextPage}
                  onLoad={() => void history.fetchNextPage()}
                />
              </div>
            )}
          </div>
        </section>

        <aside aria-labelledby="pending-title">
          <SectionTitle>
            <span id="pending-title">{copy.score.pendingTitle}</span>
          </SectionTitle>
          <Panel>
            <p className="text-small text-muted">
              {copy.score.currentWave(s.currentWave.number)} ·{' '}
              {copy.score.openedAt(formatDate(s.currentWave.openedAt))}
            </p>
            <dl className="mt-3 divide-y divide-rule font-mono text-body">
              <PendingRow label={copy.score.nPos} value={signed(pending.nPos)} tone="positive" />
              <PendingRow label={copy.score.nNeg} value={`-${pending.nNeg}`} tone="negative" />
              <PendingRow label={copy.score.nAdj} value={signed(pending.nAdj)} />
              <PendingRow label={copy.score.r} value={signed(pending.r)} strong />
              <PendingRow
                label={copy.score.projectedDelta}
                value={`${s.sigma} × ${pending.r} = ${signedDecimal(pending.projectedDelta)}`}
                strong
              />
            </dl>
            <p className="mt-3 font-mono text-small text-muted">{copy.score.formula}</p>
            <p className="mt-2 text-small text-muted">{copy.score.formulaNotice}</p>
          </Panel>
        </aside>
      </div>

      <section className="mt-10" aria-labelledby="events-title">
        <SectionTitle>
          <span id="events-title">{copy.score.eventsTitle}</span>
        </SectionTitle>
        {events.isLoading ? (
          <Skeleton lines={4} />
        ) : events.isError ? (
          <ErrorState
            message={errorMessage(events.error, copy.common.error)}
            onRetry={() => void events.refetch()}
          />
        ) : (
          <>
            <EventsList events={eventItems} />
            <LoadMore
              hasMore={Boolean(events.hasNextPage)}
              isLoading={events.isFetchingNextPage}
              onLoad={() => void events.fetchNextPage()}
            />
          </>
        )}
      </section>

      {explainWave !== null && explanation.data ? (
        <ScoreExplanationDrawer
          isOpen
          onClose={() => setExplainWave(null)}
          waveNumber={explanation.data.row.waveNumber}
          qBefore={explanation.data.row.qBefore}
          sigma={explanation.data.row.sigmaUsed}
          nPos={explanation.data.row.nPos}
          nNeg={explanation.data.row.nNeg}
          nAdj={explanation.data.row.nAdj}
          r={explanation.data.row.r}
          delta={explanation.data.row.delta}
          qAfter={explanation.data.row.qAfter}
          countedEvents={explanation.data.events}
        />
      ) : null}
    </div>
  );
}

function Kpi({
  label,
  value,
  caption,
  lead = false,
}: {
  label: string;
  value: React.ReactNode;
  caption: string;
  lead?: boolean;
}): React.ReactElement {
  return (
    <div className="px-5 py-4 [&:nth-child(odd)]:border-r sm:[&:nth-child(odd)]:border-r-0 border-border [&:nth-child(-n+2)]:border-b sm:[&:nth-child(-n+2)]:border-b-0">
      <dt className="text-small text-muted">{label}</dt>
      <dd className={`num mt-1 text-kpi text-ink ${lead ? 'font-medium' : ''}`}>{value}</dd>
      <dd className="mt-1 text-small text-muted">{caption}</dd>
    </div>
  );
}

function PendingRow({
  label,
  value,
  tone,
  strong = false,
}: {
  label: string;
  value: string;
  tone?: 'positive' | 'negative';
  strong?: boolean;
}): React.ReactElement {
  const color =
    tone === 'positive' ? 'text-positive' : tone === 'negative' ? 'text-negative' : 'text-ink';
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="font-sans text-muted">{label}</dt>
      <dd className={`num text-right ${color} ${strong ? 'font-medium' : ''}`}>{value}</dd>
    </div>
  );
}
