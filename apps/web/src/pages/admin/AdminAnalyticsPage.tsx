import React, { useState, useEffect } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from 'recharts';
import { Button } from '../../components/ui/Button';
import { copy } from '../../copy';
import { api } from '../../api/client';
import { Download, BarChart2, PieChart as PieIcon, TrendingUp, Loader2 } from 'lucide-react';

interface SpreadDataPoint {
  waveNumber: number;
  authorTier: string;
  preReshares: number;
  postReshares: number;
  preLikes: number;
  postLikes: number;
}

interface DetectorStats {
  total: number;
  bands: {
    likely_fake: number;
    uncertain: number;
    likely_real: number;
  };
}

interface WaveStatsPoint {
  waveNumber: number;
  nPosTotal: number;
  nNegTotal: number;
  netReputationDelta: number;
}

const COLORS = ['#ef4444', '#f59e0b', '#10b981'];

export const AdminAnalyticsPage: React.FC = () => {
  const [spreadData, setSpreadData] = useState<SpreadDataPoint[]>([]);
  const [detectorStats, setDetectorStats] = useState<DetectorStats | null>(null);
  const [wavesStats, setWavesStats] = useState<WaveStatsPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setIsLoading(true);

    Promise.all([
      api.get<{ items: SpreadDataPoint[] }>('/api/v1/admin/analytics/spread').catch(() => ({ items: [] })),
      api.get<DetectorStats>('/api/v1/admin/analytics/detector').catch(() => null),
      api.get<{ items: WaveStatsPoint[] }>('/api/v1/admin/analytics/waves').catch(() => ({ items: [] })),
    ])
      .then(([spreadRes, detRes, wavesRes]) => {
        if (!mounted) return;
        setSpreadData(spreadRes.items || []);
        setDetectorStats(detRes);
        setWavesStats(wavesRes.items || []);
      })
      .catch((err: unknown) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : copy.error);
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const downloadCsv = (endpoint: string, _filename: string) => {
    window.open(`/api/v1/admin/export/${endpoint}`, '_blank');
  };

  const detectorPieData = detectorStats
    ? [
        { name: 'Likely Fake', value: detectorStats.bands.likely_fake },
        { name: 'Uncertain', value: detectorStats.bands.uncertain },
        { name: 'Likely Real', value: detectorStats.bands.likely_real },
      ]
    : [];

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
          <BarChart2 className="w-5 h-5 text-primary-600" aria-hidden="true" />
          <span>{copy.admin.analytics.title}</span>
        </h2>
        <p className="text-xs text-neutral-500 mt-0.5">
          Research analytics on information spread, RoBERTa detector calibration, and verified ledger flows.
        </p>
      </div>

      {/* CSV Export Bar */}
      <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-5 shadow-sm space-y-3">
        <h3 className="text-xs font-bold text-neutral-900 dark:text-neutral-100 uppercase tracking-wider flex items-center gap-1.5">
          <Download className="w-4 h-4 text-primary-600" aria-hidden="true" />
          <span>{copy.admin.analytics.csvHeader}</span>
        </h3>
        <p className="text-xs text-neutral-500">
          Export full research data formatted according to RFC 4180 specification for statistical analysis.
        </p>
        <div className="flex flex-wrap gap-2.5 pt-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => downloadCsv('ledger.csv', 'ledger.csv')}
            icon={<Download className="w-3.5 h-3.5" aria-hidden="true" />}
          >
            {copy.admin.analytics.downloadLedger}
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => downloadCsv('events.csv', 'events.csv')}
            icon={<Download className="w-3.5 h-3.5" aria-hidden="true" />}
          >
            {copy.admin.analytics.downloadEvents}
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => downloadCsv('assessments.csv', 'assessments.csv')}
            icon={<Download className="w-3.5 h-3.5" aria-hidden="true" />}
          >
            {copy.admin.analytics.downloadAssessments}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="py-16 text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary-600" aria-hidden="true" />
          <p className="mt-3 text-sm text-neutral-500">{copy.loading}</p>
        </div>
      ) : error ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 p-6 text-center text-sm text-red-700 dark:text-red-300"
        >
          {error}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Spread Chart */}
          <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-5 shadow-sm space-y-4 lg:col-span-2">
            <h3 className="text-xs font-bold text-neutral-900 dark:text-neutral-100 uppercase tracking-wider">
              {copy.admin.analytics.spreadChartTitle}
            </h3>
            <p className="text-xs text-neutral-500">
              Measures containment of misinformation: shows interaction velocity before versus after fact-checking labels are published.
            </p>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={spreadData}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="authorTier" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="preReshares" name="Pre-Label Shares" fill="#f87171" />
                  <Bar dataKey="postReshares" name="Post-Label Shares" fill="#60a5fa" />
                  <Bar dataKey="preLikes" name="Pre-Label Likes" fill="#fb923c" />
                  <Bar dataKey="postLikes" name="Post-Label Likes" fill="#a78bfa" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Detector Bands Distribution */}
          <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-5 shadow-sm space-y-4">
            <h3 className="text-xs font-bold text-neutral-900 dark:text-neutral-100 uppercase tracking-wider flex items-center gap-1.5">
              <PieIcon className="w-4 h-4 text-primary-600" aria-hidden="true" />
              <span>{copy.admin.analytics.detectorChartTitle}</span>
            </h3>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={detectorPieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {detectorPieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Waves Net Reputation Flow */}
          <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-5 shadow-sm space-y-4">
            <h3 className="text-xs font-bold text-neutral-900 dark:text-neutral-100 uppercase tracking-wider flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-purple-600" aria-hidden="true" />
              <span>{copy.admin.analytics.wavesChartTitle}</span>
            </h3>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={wavesStats}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="waveNumber" label={{ value: 'Wave #', position: 'insideBottom', offset: -5 }} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="nPosTotal" name="Positive Total" stroke="#10b981" />
                  <Line type="monotone" dataKey="nNegTotal" name="Penalties Total" stroke="#ef4444" />
                  <Line type="monotone" dataKey="netReputationDelta" name="Net Delta" stroke="#6366f1" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
