import React, { useState, useEffect } from 'react';
import { Button } from '../../components/ui/Button';
import { copy } from '../../copy';
import { WaveItem } from '../../types';
import { api } from '../../api/client';
import { Waves, CheckCircle2, Loader2 } from 'lucide-react';

interface CurrentWaveInfo {
  number: number;
  openedAt: string;
  pendingEventsCount: number;
  activeUsersCount: number;
}

export const AdminWavesPage: React.FC = () => {
  const [currentWave, setCurrentWave] = useState<CurrentWaveInfo | null>(null);
  const [history, setHistory] = useState<WaveItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchWaveData = async () => {
    try {
      setIsLoading(true);
      const [currentRes, historyRes] = await Promise.all([
        api.get<CurrentWaveInfo>('/api/v1/admin/waves/current'),
        api.get<{ waves: WaveItem[] }>('/api/v1/admin/waves'),
      ]);
      setCurrentWave(currentRes);
      setHistory(historyRes.waves || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : copy.error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchWaveData();
  }, []);

  const handleFinalizeWave = async () => {
    if (!window.confirm(copy.admin.waves.finalizeConfirm)) return;

    try {
      setIsFinalizing(true);
      await api.post('/api/v1/admin/waves/finalize');
      await fetchWaveData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : copy.error);
    } finally {
      setIsFinalizing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="py-16 text-center">
        <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary-600" aria-hidden="true" />
        <p className="mt-3 text-sm text-neutral-500">{copy.loading}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
          <Waves className="w-5 h-5 text-primary-600" aria-hidden="true" />
          <span>{copy.admin.waves.title}</span>
        </h2>
        <p className="text-xs text-neutral-500 mt-0.5">
          Reputation waves partition user interactions into discrete mathematical batches.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 p-4 text-xs text-red-700 dark:text-red-300"
        >
          {error}
        </div>
      )}

      {/* Active Open Wave Banner */}
      {currentWave && (
        <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-6 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-neutral-100 dark:border-neutral-700 pb-3">
            <div>
              <span className="text-xs font-semibold text-primary-600 dark:text-primary-400 uppercase tracking-wider">
                {copy.admin.waves.currentWaveHeader}
              </span>
              <h3 className="text-xl font-extrabold text-neutral-900 dark:text-neutral-50 font-mono">
                Wave #{currentWave.number}
              </h3>
            </div>

            <Button
              variant="primary"
              onClick={handleFinalizeWave}
              isLoading={isFinalizing}
              icon={<CheckCircle2 className="w-4 h-4" aria-hidden="true" />}
            >
              {isFinalizing ? copy.admin.waves.finalizing : copy.admin.waves.finalizeBtn}
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div className="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-850 border border-neutral-200 dark:border-neutral-700">
              <span className="text-neutral-400 block text-[11px]">Opened At</span>
              <span className="font-semibold text-neutral-800 dark:text-neutral-200">
                {new Date(currentWave.openedAt).toLocaleString()}
              </span>
            </div>

            <div className="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-850 border border-neutral-200 dark:border-neutral-700">
              <span className="text-neutral-400 block text-[11px]">Pending Eligible Events</span>
              <span className="font-mono font-bold text-amber-600 dark:text-amber-400 text-sm">
                {currentWave.pendingEventsCount}
              </span>
            </div>

            <div className="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-850 border border-neutral-200 dark:border-neutral-700">
              <span className="text-neutral-400 block text-[11px]">Active Interacting Users</span>
              <span className="font-mono font-bold text-neutral-800 dark:text-neutral-200 text-sm">
                {currentWave.activeUsersCount}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* History Archive Table */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
          {copy.admin.waves.historyTitle}
        </h3>

        {history.length === 0 ? (
          <p className="text-xs text-neutral-400">No past finalized waves recorded.</p>
        ) : (
          <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 shadow-sm overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-neutral-50 dark:bg-neutral-850 border-b border-neutral-200 dark:border-neutral-700 text-neutral-500 uppercase font-semibold">
                <tr>
                  <th className="py-3 px-4">Wave Number</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">Opened</th>
                  <th className="py-3 px-3">Finalized</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-700">
                {history.map((w) => (
                  <tr key={w.number} className="hover:bg-neutral-50 dark:hover:bg-neutral-750">
                    <td className="py-3 px-4 font-mono font-bold">#{w.number}</td>
                    <td className="py-3 px-3">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-neutral-100 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200">
                        {w.status}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-neutral-500">
                      {new Date(w.openedAt).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-3 text-neutral-500">
                      {w.finalizedAt ? new Date(w.finalizedAt).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
