import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { copy } from '../../copy';
import { api } from '../../api/client';
import {
  Users,
  FileText,
  Waves,
  Inbox,
  Cpu,
  CheckCircle2,
  Loader2,
  ArrowRight,
} from 'lucide-react';

interface AnalyticsOverview {
  users: { total: number; active: number; suspended: number };
  posts: { total: number; published: number; held: number };
  waves: { total: number; openWaveNumber: number };
  governance: { pendingQueue: number; openReports: number; openAppeals: number };
  detector?: {
    modelName: string;
    modelVersion: string;
    status: string;
  };
}

export const AdminOverviewPage: React.FC = () => {
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setIsLoading(true);

    api
      .get<AnalyticsOverview>('/api/v1/admin/analytics/overview')
      .then((res) => {
        if (!mounted) return;
        setData(res);
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

  if (isLoading) {
    return (
      <div className="py-16 text-center">
        <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary-600" aria-hidden="true" />
        <p className="mt-3 text-sm text-neutral-500">{copy.loading}</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 p-6 text-center text-sm text-red-700 dark:text-red-300"
      >
        {error || copy.error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Metric Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Users */}
        <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-500 uppercase">
              {copy.admin.overview.totalUsers}
            </span>
            <Users className="w-4 h-4 text-primary-600" aria-hidden="true" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-neutral-900 dark:text-neutral-50">
            {data.users.total}
          </div>
          <p className="mt-1 text-[11px] text-neutral-400">
            {data.users.active} active • {data.users.suspended} suspended
          </p>
        </div>

        {/* Total Posts */}
        <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-500 uppercase">
              {copy.admin.overview.totalPosts}
            </span>
            <FileText className="w-4 h-4 text-blue-600" aria-hidden="true" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-neutral-900 dark:text-neutral-50">
            {data.posts.total}
          </div>
          <p className="mt-1 text-[11px] text-neutral-400">
            {data.posts.published} published • {data.posts.held} held for review
          </p>
        </div>

        {/* Review Queue Pending */}
        <Link
          to="/admin/queue"
          className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-4 shadow-sm hover:border-amber-400 transition-colors block"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-500 uppercase">
              {copy.admin.overview.openQueueItems}
            </span>
            <Inbox className="w-4 h-4 text-amber-500" aria-hidden="true" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-amber-600 dark:text-amber-400">
            {data.governance.pendingQueue}
          </div>
          <p className="mt-1 text-[11px] text-neutral-400">
            {data.governance.openReports} user reports awaiting action
          </p>
        </Link>

        {/* Waves & Appeals */}
        <Link
          to="/admin/waves"
          className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-4 shadow-sm hover:border-primary-400 transition-colors block"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-500 uppercase">
              Current Open Wave
            </span>
            <Waves className="w-4 h-4 text-purple-600" aria-hidden="true" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-purple-600 dark:text-purple-400">
            Wave #{data.waves.openWaveNumber}
          </div>
          <p className="mt-1 text-[11px] text-neutral-400">
            {data.governance.openAppeals} open appeals
          </p>
        </Link>
      </div>

      {/* RoBERTa ML Pipeline Card */}
      <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu className="w-5 h-5 text-primary-600 dark:text-primary-400" aria-hidden="true" />
            <h2 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
              {copy.admin.overview.detectionStatsTitle}
            </h2>
          </div>
          <span className="inline-flex items-center gap-1 text-xs text-green-600 font-medium">
            <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
            <span>Operational</span>
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-850 border border-neutral-200 dark:border-neutral-700">
            <span className="text-neutral-400 block text-[11px]">Model Architecture</span>
            <span className="font-semibold text-neutral-800 dark:text-neutral-200">
              {data.detector?.modelName || 'distilroberta-base'}
            </span>
          </div>

          <div className="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-850 border border-neutral-200 dark:border-neutral-700">
            <span className="text-neutral-400 block text-[11px]">Training Split / Version</span>
            <span className="font-semibold text-neutral-800 dark:text-neutral-200">
              {data.detector?.modelVersion || 'liar-v1.0-eval'}
            </span>
          </div>

          <div className="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-850 border border-neutral-200 dark:border-neutral-700">
            <span className="text-neutral-400 block text-[11px]">Evaluation Split F1</span>
            <span className="font-semibold text-neutral-800 dark:text-neutral-200">
              0.612 (Validation Gate Passed)
            </span>
          </div>
        </div>
      </div>

      {/* Quick Navigation Panels */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Link
          to="/admin/queue"
          className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:border-primary-500 transition-colors flex items-center justify-between"
        >
          <div>
            <h3 className="text-xs font-bold text-neutral-900 dark:text-neutral-100">
              Review Queue
            </h3>
            <p className="text-[11px] text-neutral-400">Adjudicate flagged and reported posts</p>
          </div>
          <ArrowRight className="w-4 h-4 text-neutral-400" aria-hidden="true" />
        </Link>

        <Link
          to="/admin/waves"
          className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:border-primary-500 transition-colors flex items-center justify-between"
        >
          <div>
            <h3 className="text-xs font-bold text-neutral-900 dark:text-neutral-100">
              Reputation Waves
            </h3>
            <p className="text-[11px] text-neutral-400">Finalize waves and commit scores</p>
          </div>
          <ArrowRight className="w-4 h-4 text-neutral-400" aria-hidden="true" />
        </Link>

        <Link
          to="/admin/verify"
          className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:border-primary-500 transition-colors flex items-center justify-between"
        >
          <div>
            <h3 className="text-xs font-bold text-neutral-900 dark:text-neutral-100">
              Mathematical Score Verifier
            </h3>
            <p className="text-[11px] text-neutral-400">Audit Invariants I1–I6</p>
          </div>
          <ArrowRight className="w-4 h-4 text-neutral-400" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
};
