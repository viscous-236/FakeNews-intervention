import React, { useState, useEffect } from 'react';
import { copy } from '../../copy';
import { PaginatedResponse } from '../../types';
import { api } from '../../api/client';
import { ShieldAlert, Loader2 } from 'lucide-react';

interface AuditLogItem {
  id: string;
  adminId: string;
  action: string;
  targetType: string;
  targetId: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export const AdminAuditPage: React.FC = () => {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setIsLoading(true);

    api
      .get<PaginatedResponse<AuditLogItem>>('/api/v1/admin/audit')
      .then((res) => {
        if (!mounted) return;
        setLogs(res.items);
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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-primary-600" aria-hidden="true" />
          <span>Governance Audit Log</span>
        </h2>
        <p className="text-xs text-neutral-500 mt-0.5">
          Immutable audit record of all moderator interventions, assessments, wave finalizations, and suspensions (REQ-014).
        </p>
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
      ) : logs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 p-12 text-center text-xs text-neutral-500 bg-white dark:bg-neutral-800">
          No audit entries recorded yet.
        </div>
      ) : (
        <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 shadow-sm overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-neutral-50 dark:bg-neutral-850 border-b border-neutral-200 dark:border-neutral-700 text-neutral-500 uppercase font-semibold">
              <tr>
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-3">Action</th>
                <th className="py-3 px-3">Target</th>
                <th className="py-3 px-4">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-700 font-mono">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-750">
                  <td className="py-3 px-4 font-sans text-neutral-400">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="py-3 px-3 font-semibold text-primary-600 dark:text-primary-400">
                    {log.action}
                  </td>
                  <td className="py-3 px-3 text-neutral-600 dark:text-neutral-300">
                    {log.targetType}:{log.targetId.slice(0, 8)}
                  </td>
                  <td className="py-3 px-4 text-[11px] text-neutral-500 truncate max-w-xs font-sans">
                    {JSON.stringify(log.details)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
