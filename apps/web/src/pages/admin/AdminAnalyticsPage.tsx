import React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Download } from 'lucide-react';
import { useAdminAnalytics } from '../../api/hooks';
import { copy } from '../../copy';
import { errorMessage } from '../../api/client';
import type {
  DetectionBand,
  DetectorAnalytics,
  SpreadRow,
  Tier,
  WaveAnalyticsRow,
} from '../../types';
import { Button } from '../../components/ui/Button';
import {
  EmptyState,
  ErrorState,
  KeyValue,
  PageHeader,
  Panel,
  SectionTitle,
  Skeleton,
} from '../../components/ui/Page';

const HUE = '#1b6c80';
const HUE_2 = '#2f70bb';
const GRID = '#e5e5e5';
const AXIS = { fontSize: 12, fill: '#5d5f60' } as const;
const BANDS: DetectionBand[] = ['likely_fake', 'uncertain', 'likely_real'];
const TIERS: Tier[] = ['trusted', 'neutral', 'low'];

/** Analytics (TASK-098): one hue per chart, 3–5 gridlines, no legend for a single series. */
export function AdminAnalyticsPage(): React.ReactElement {
  const detector = useAdminAnalytics<DetectorAnalytics>('detector');
  const waves = useAdminAnalytics<{ items: WaveAnalyticsRow[] }>('waves');
  const spread = useAdminAnalytics<{ items: SpreadRow[] }>('spread');

  return (
    <div>
      <PageHeader
        title={copy.admin.analytics.title}
        subtitle={copy.admin.analytics.subtitle}
        action={
          <>
            <ExportButton file="ledger.csv" label={copy.admin.analytics.ledgerCsv} />
            <ExportButton file="events.csv" label={copy.admin.analytics.eventsCsv} />
            <ExportButton file="assessments.csv" label={copy.admin.analytics.assessmentsCsv} />
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="an-detector">
          <SectionTitle>
            <span id="an-detector">{copy.admin.analytics.detectorTitle}</span>
          </SectionTitle>
          <Panel>
            <p className="mb-3 text-small text-muted">{copy.admin.analytics.detectorHint}</p>
            {detector.isLoading ? (
              <Skeleton lines={5} />
            ) : detector.isError || !detector.data ? (
              <ErrorState
                message={errorMessage(detector.error, copy.common.error)}
                onRetry={() => void detector.refetch()}
                compact
              />
            ) : (
              <>
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={BANDS.map((b) => ({
                        band: copy.admin.analytics.bands[b],
                        count: detector.data!.countsByBand[b],
                      }))}
                      margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
                    >
                      <CartesianGrid vertical={false} stroke={GRID} />
                      <XAxis dataKey="band" tick={AXIS} axisLine={false} tickLine={false} />
                      <YAxis tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip
                        cursor={{ fill: '#f4f6f8' }}
                        contentStyle={{
                          fontSize: 12,
                          borderRadius: 6,
                          border: '1px solid #e8eaec',
                        }}
                      />
                      <Bar
                        dataKey="count"
                        fill={HUE}
                        radius={[2, 2, 0, 0]}
                        isAnimationActive={false}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <dl className="mt-3 divide-y divide-rule">
                  <KeyValue label={copy.admin.analytics.failureRate}>
                    {(detector.data.failureRate * 100).toFixed(1)} %
                  </KeyValue>
                  <KeyValue label={copy.admin.analytics.avgLatency}>
                    {Math.round(detector.data.avgLatencyMs)} ms
                  </KeyValue>
                </dl>
              </>
            )}
          </Panel>
        </section>

        <section aria-labelledby="an-agreement">
          <SectionTitle>
            <span id="an-agreement">{copy.admin.analytics.agreementTitle}</span>
          </SectionTitle>
          <Panel>
            <p className="mb-3 text-small text-muted">{copy.admin.analytics.agreementHint}</p>
            {detector.isLoading ? (
              <Skeleton lines={5} />
            ) : detector.data ? (
              <table className="w-full text-body">
                <thead>
                  <tr className="text-left text-small text-muted">
                    <th className="py-2 pr-3 font-normal" />
                    {BANDS.map((b) => (
                      <th key={b} className="num py-2 pr-3 text-right font-normal">
                        {copy.admin.analytics.bands[b]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  <tr className="h-row">
                    <td className="pr-3 text-ink">{copy.admin.analytics.verdicts.fake}</td>
                    <td className="num pr-3 text-right font-medium">
                      {detector.data.agreement.adminFakeVsBandLikelyFake}
                    </td>
                    <td className="num pr-3 text-right">
                      {detector.data.agreement.adminFakeVsBandUncertain}
                    </td>
                    <td className="num pr-3 text-right text-muted">
                      {detector.data.agreement.adminFakeVsBandLikelyReal}
                    </td>
                  </tr>
                  <tr className="h-row">
                    <td className="pr-3 text-ink">{copy.admin.analytics.verdicts.real}</td>
                    <td className="num pr-3 text-right text-muted">
                      {detector.data.agreement.adminRealVsBandLikelyFake}
                    </td>
                    <td className="num pr-3 text-right">
                      {detector.data.agreement.adminRealVsBandUncertain}
                    </td>
                    <td className="num pr-3 text-right font-medium">
                      {detector.data.agreement.adminRealVsBandLikelyReal}
                    </td>
                  </tr>
                </tbody>
              </table>
            ) : null}
          </Panel>
        </section>

        <section aria-labelledby="an-waves" className="lg:col-span-2">
          <SectionTitle>
            <span id="an-waves">{copy.admin.analytics.wavesTitle}</span>
          </SectionTitle>
          <Panel>
            <p className="mb-3 text-small text-muted">{copy.admin.analytics.wavesHint}</p>
            {waves.isLoading ? (
              <Skeleton lines={5} />
            ) : waves.isError || !waves.data ? (
              <ErrorState
                message={errorMessage(waves.error, copy.common.error)}
                onRetry={() => void waves.refetch()}
                compact
              />
            ) : waves.data.items.length === 0 ? (
              <EmptyState>{copy.admin.analytics.noData}</EmptyState>
            ) : (
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={waves.data.items.map((w) => ({
                        wave: `w${w.number}`,
                        nPos: w.nPos,
                        nNeg: w.nNeg,
                      }))}
                      margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
                    >
                      <CartesianGrid vertical={false} stroke={GRID} />
                      <XAxis dataKey="wave" tick={AXIS} axisLine={false} tickLine={false} />
                      <YAxis tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{
                          fontSize: 12,
                          borderRadius: 6,
                          border: '1px solid #e8eaec',
                        }}
                      />
                      <Line
                        type="linear"
                        dataKey="nPos"
                        name={copy.admin.analytics.nPos}
                        stroke={HUE}
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                      <Line
                        type="linear"
                        dataKey="nNeg"
                        name={copy.admin.analytics.nNeg}
                        stroke="#131416"
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                  <p className="mt-1 flex gap-4 text-small text-muted">
                    <span className="flex items-center gap-1.5">
                      <span className="h-0.5 w-4" style={{ background: HUE }} />
                      {copy.admin.analytics.nPos}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-0.5 w-4 bg-ink" />
                      {copy.admin.analytics.nNeg}
                    </span>
                  </p>
                </div>
                <table className="w-full self-start text-body">
                  <thead>
                    <tr className="text-left text-small text-muted">
                      <th className="py-2 pr-3 font-normal">{copy.score.columns.wave}</th>
                      <th className="num py-2 pr-3 text-right font-normal">Users</th>
                      <th className="num py-2 pr-3 text-right font-normal">
                        {copy.score.columns.nPos}
                      </th>
                      <th className="num py-2 pr-3 text-right font-normal">
                        {copy.score.columns.nNeg}
                      </th>
                      <th className="num py-2 pr-3 text-right font-normal">
                        {copy.score.columns.nAdj}
                      </th>
                      <th className="num py-2 text-right font-normal">
                        {copy.admin.analytics.sumDelta}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rule">
                    {waves.data.items.map((w) => (
                      <tr key={w.number}>
                        <td className="num py-1.5 pr-3 text-ink">{w.number}</td>
                        <td className="num py-1.5 pr-3 text-right">{w.usersScored}</td>
                        <td className="num py-1.5 pr-3 text-right">{w.nPos}</td>
                        <td className="num py-1.5 pr-3 text-right">{w.nNeg}</td>
                        <td className="num py-1.5 pr-3 text-right">{w.nAdj}</td>
                        <td className="num py-1.5 text-right font-medium">{w.sumDelta}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </section>

        <section aria-labelledby="an-spread" className="lg:col-span-2">
          <SectionTitle>
            <span id="an-spread">{copy.admin.analytics.spreadTitle}</span>
          </SectionTitle>
          <Panel>
            <p className="mb-3 text-small text-muted">{copy.admin.analytics.spreadHint}</p>
            {spread.isLoading ? (
              <Skeleton lines={5} />
            ) : spread.isError || !spread.data ? (
              <ErrorState
                message={errorMessage(spread.error, copy.common.error)}
                onRetry={() => void spread.refetch()}
                compact
              />
            ) : spread.data.items.length === 0 ? (
              <EmptyState>{copy.admin.analytics.noData}</EmptyState>
            ) : (
              <div className="grid gap-6 lg:grid-cols-2">
                <SpreadChart
                  title={copy.admin.analytics.shares}
                  rows={spread.data.items}
                  pick={(r) => r.reshares}
                />
                <SpreadChart
                  title={copy.admin.analytics.likes}
                  rows={spread.data.items}
                  pick={(r) => r.likes}
                />
              </div>
            )}
          </Panel>
        </section>
      </div>
    </div>
  );
}

function SpreadChart({
  title,
  rows,
  pick,
}: {
  title: string;
  rows: SpreadRow[];
  pick: (r: SpreadRow) => { before: number; after: number };
}): React.ReactElement {
  // Aggregate by tier across waves so the chart answers one question: before vs after the label, per tier.
  const data = TIERS.map((tier) => {
    const subset = rows.filter((r) => r.authorTier === tier);
    return {
      tier:
        tier === 'trusted'
          ? copy.tier.trusted
          : tier === 'low'
            ? 'Low credibility'
            : copy.tier.neutral,
      before: subset.reduce((s, r) => s + pick(r).before, 0),
      after: subset.reduce((s, r) => s + pick(r).after, 0),
    };
  });
  return (
    <div>
      <p className="text-body font-medium text-ink">{title}</p>
      <div className="mt-2 h-44">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="tier" tick={AXIS} axisLine={false} tickLine={false} />
            <YAxis tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip
              cursor={{ fill: '#f4f6f8' }}
              contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid #e8eaec' }}
            />
            <Bar
              dataKey="before"
              name={copy.admin.analytics.before}
              fill={HUE}
              isAnimationActive={false}
            />
            <Bar
              dataKey="after"
              name={copy.admin.analytics.after}
              fill={HUE_2}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 flex gap-4 text-small text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5" style={{ background: HUE }} />
          {copy.admin.analytics.before}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5" style={{ background: HUE_2 }} />
          {copy.admin.analytics.after}
        </span>
      </p>
    </div>
  );
}

function ExportButton({ file, label }: { file: string; label: string }): React.ReactElement {
  return (
    <a href={`/api/v1/admin/export/${file}`} download={file} className="inline-flex">
      <Button variant="secondary" size="sm" icon={<Download />}>
        {label}
      </Button>
    </a>
  );
}
