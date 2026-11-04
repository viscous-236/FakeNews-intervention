import React, { useState, useEffect, useCallback } from 'react';
import { ScoreExplanationDrawer } from '../components/score/ScoreExplanationDrawer';
import { EventsList } from '../components/score/EventsList';
import { TierBadge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { copy } from '../copy';
import {
  ScoreResponse,
  LedgerRow,
  EventItem,
  PaginatedResponse,
} from '../types';
import { api } from '../api/client';
import {
  Award,
  Activity,
  History,
  Calendar,
  Info,
  Loader2,
} from 'lucide-react';

interface WaveExplanationData {
  waveNumber: number;
  qBefore: string;
  sigma: string;
  nPos: number;
  nNeg: number;
  nAdj: number;
  r: number;
  delta: string;
  qAfter: string;
  countedEvents: EventItem[];
}

export const ScorePage: React.FC = () => {
  const [scoreData, setScoreData] = useState<ScoreResponse | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Drawer state
  const [drawerData, setDrawerData] = useState<WaveExplanationData | null>(null);
  const [isLoadingExplanation, setIsLoadingExplanation] = useState(false);

  const loadAllData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const [scoreRes, ledgerRes, eventsRes] = await Promise.all([
        api.get<ScoreResponse>('/api/v1/score'),
        api.get<PaginatedResponse<LedgerRow>>('/api/v1/score/ledger'),
        api.get<PaginatedResponse<EventItem>>('/api/v1/score/events'),
      ]);
      setScoreData(scoreRes);
      setLedger(ledgerRes.items);
      setEvents(eventsRes.items);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : copy.error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAllData();
  }, [loadAllData]);

  const handleOpenExplanation = async (waveNumber: number, _row?: LedgerRow) => {
    try {
      setIsLoadingExplanation(true);
      const res = await api.get<{
        waveNumber: number;
        formula: string;
        qBefore: string;
        sigma: string;
        nPos: number;
        nNeg: number;
        nAdj: number;
        r: number;
        delta: string;
        qAfter: string;
        countedEvents: EventItem[];
      }>(`/api/v1/score/explain/${waveNumber}`);

      setDrawerData({
        waveNumber: res.waveNumber,
        qBefore: res.qBefore,
        sigma: res.sigma,
        nPos: res.nPos,
        nNeg: res.nNeg,
        nAdj: res.nAdj,
        r: res.r,
        delta: res.delta,
        qAfter: res.qAfter,
        countedEvents: res.countedEvents || [],
      });
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to fetch wave explanation.');
    } finally {
      setIsLoadingExplanation(false);
    }
  };

  if (isLoading) {
    return (
      <div className="py-20 text-center">
        <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary-600" aria-hidden="true" />
        <p className="mt-3 text-sm text-neutral-500">{copy.loading}</p>
      </div>
    );
  }

  if (error || !scoreData) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 p-6 text-center text-sm text-red-700 dark:text-red-300"
      >
        {error || copy.error}
      </div>
    );
  }

  const { q, sigma, tier, currentWave } = scoreData;

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Page Title & Intro */}
      <div>
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
          <Award className="w-6 h-6 text-primary-600 dark:text-primary-400" aria-hidden="true" />
          <span>{copy.score.title}</span>
        </h1>
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          {copy.score.subtitle}
        </p>
      </div>

      {/* Top Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Q Score */}
        <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-5 shadow-sm space-y-1">
          <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
            {copy.score.qScoreLabel}
          </p>
          <div className="text-3xl font-extrabold text-neutral-900 dark:text-neutral-50 font-mono">
            {Number(q).toFixed(3)}
          </div>
          <p className="text-[11px] text-neutral-400">
            Trusted minimum: {scoreData.thresholds.trustedMin} • Low threshold: {scoreData.thresholds.lowMax}
          </p>
        </div>

        {/* Credibility Tier */}
        <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-5 shadow-sm space-y-2">
          <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
            {copy.score.tierLabel}
          </p>
          <div>
            <TierBadge tier={tier} />
          </div>
          <p className="text-[11px] text-neutral-400">
            {copy.tier[tier]}
          </p>
        </div>

        {/* Sigma Parameter */}
        <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-5 shadow-sm space-y-1">
          <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
            {copy.score.sigmaLabel}
          </p>
          <div className="text-3xl font-extrabold text-neutral-900 dark:text-neutral-50 font-mono">
            {sigma}
          </div>
          <p className="text-[11px] text-neutral-400">
            Fixed responsiveness rate (RUL-010)
          </p>
        </div>
      </div>

      {/* Current Wave Projection Banner */}
      <div className="bg-gradient-to-br from-primary-50 to-neutral-50 dark:from-neutral-800 dark:to-neutral-850 rounded-2xl border border-primary-200 dark:border-neutral-700 p-6 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-primary-100 dark:border-neutral-700 pb-3">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary-600 dark:text-primary-400" aria-hidden="true" />
            <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-100">
              {copy.score.currentWaveTitle} ({copy.score.waveNumber(currentWave.number)})
            </h2>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-neutral-500">
            <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
            <span>
              Opened {new Date(currentWave.openedAt).toLocaleDateString()}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
          <div className="bg-white dark:bg-neutral-800 rounded-xl p-3 border border-neutral-200 dark:border-neutral-700">
            <span className="text-[11px] text-neutral-500 block">{copy.score.nPos}</span>
            <span className="font-mono text-base font-bold text-green-600 dark:text-green-400">
              +{currentWave.pending.nPos}
            </span>
          </div>

          <div className="bg-white dark:bg-neutral-800 rounded-xl p-3 border border-neutral-200 dark:border-neutral-700">
            <span className="text-[11px] text-neutral-500 block">{copy.score.nNeg}</span>
            <span className="font-mono text-base font-bold text-red-600 dark:text-red-400">
              -{currentWave.pending.nNeg}
            </span>
          </div>

          <div className="bg-white dark:bg-neutral-800 rounded-xl p-3 border border-neutral-200 dark:border-neutral-700">
            <span className="text-[11px] text-neutral-500 block">{copy.score.nAdj}</span>
            <span className="font-mono text-base font-bold text-purple-600 dark:text-purple-400">
              {currentWave.pending.nAdj >= 0 ? `+${currentWave.pending.nAdj}` : currentWave.pending.nAdj}
            </span>
          </div>

          <div className="bg-white dark:bg-neutral-800 rounded-xl p-3 border border-neutral-200 dark:border-neutral-700">
            <span className="text-[11px] text-neutral-500 block">Pending R</span>
            <span className="font-mono text-base font-bold text-neutral-900 dark:text-neutral-100">
              {currentWave.pending.r >= 0 ? `+${currentWave.pending.r}` : currentWave.pending.r}
            </span>
          </div>

          <div className="bg-white dark:bg-neutral-800 rounded-xl p-3 border border-neutral-200 dark:border-neutral-700 col-span-2 sm:col-span-1">
            <span className="text-[11px] text-primary-600 dark:text-primary-400 font-semibold block">
              {copy.score.projectedDelta}
            </span>
            <span className="font-mono text-base font-extrabold text-primary-600 dark:text-primary-400">
              {Number(currentWave.pending.projectedDelta) >= 0 ? `+${currentWave.pending.projectedDelta}` : currentWave.pending.projectedDelta}
            </span>
          </div>
        </div>

        <p className="text-[11px] text-neutral-500 flex items-start gap-1.5 pt-1">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-primary-500" aria-hidden="true" />
          <span>{copy.score.formulaNotice}</span>
        </p>
      </div>

      {/* Ledger History Table */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <History className="w-5 h-5 text-primary-600 dark:text-primary-400" aria-hidden="true" />
          <h2 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">
            {copy.score.historyTitle}
          </h2>
        </div>

        {ledger.length === 0 ? (
          <div className="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 p-8 text-center text-xs text-neutral-500 bg-white dark:bg-neutral-800">
            {copy.score.noHistory}
          </div>
        ) : (
          <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 shadow-sm overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-neutral-50 dark:bg-neutral-850 border-b border-neutral-200 dark:border-neutral-700 text-neutral-500 uppercase font-semibold">
                <tr>
                  <th className="py-3 px-4">Wave</th>
                  <th className="py-3 px-3">Q Before</th>
                  <th className="py-3 px-3">n⁺</th>
                  <th className="py-3 px-3">n⁻</th>
                  <th className="py-3 px-3">R</th>
                  <th className="py-3 px-3">Δ</th>
                  <th className="py-3 px-3">Q After</th>
                  <th className="py-3 px-3">Finalized</th>
                  <th className="py-3 px-4 text-right">Formula Breakdown</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-700 font-mono">
                {ledger.map((row) => (
                  <tr key={row.waveNumber} className="hover:bg-neutral-50 dark:hover:bg-neutral-750 transition-colors">
                    <td className="py-3 px-4 font-bold">#{row.waveNumber}</td>
                    <td className="py-3 px-3">{Number(row.qBefore).toFixed(3)}</td>
                    <td className="py-3 px-3 text-green-600 font-bold">+{row.nPos}</td>
                    <td className="py-3 px-3 text-red-600 font-bold">-{row.nNeg}</td>
                    <td className="py-3 px-3 font-semibold">{row.r >= 0 ? `+${row.r}` : row.r}</td>
                    <td className="py-3 px-3 text-primary-600 font-bold">
                      {Number(row.delta) >= 0 ? `+${row.delta}` : row.delta}
                    </td>
                    <td className="py-3 px-3 font-bold">{Number(row.qAfter).toFixed(3)}</td>
                    <td className="py-3 px-3 font-sans text-neutral-400">
                      {new Date(row.finalizedAt).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-4 text-right font-sans">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleOpenExplanation(row.waveNumber, row)}
                        isLoading={isLoadingExplanation}
                      >
                        Explain →
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Reputation Events Section */}
      <section className="space-y-4">
        <h2 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">
          {copy.score.eventsTitle}
        </h2>
        <EventsList events={events} onRefresh={loadAllData} />
      </section>

      {/* Explanation Drawer */}
      {drawerData && (
        <ScoreExplanationDrawer
          isOpen={!!drawerData}
          onClose={() => setDrawerData(null)}
          waveNumber={drawerData.waveNumber}
          qBefore={drawerData.qBefore}
          sigma={drawerData.sigma}
          nPos={drawerData.nPos}
          nNeg={drawerData.nNeg}
          nAdj={drawerData.nAdj}
          r={drawerData.r}
          delta={drawerData.delta}
          qAfter={drawerData.qAfter}
          countedEvents={drawerData.countedEvents}
        />
      )}
    </div>
  );
};
