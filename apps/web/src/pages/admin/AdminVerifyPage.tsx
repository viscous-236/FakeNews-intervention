import React, { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { copy } from '../../copy';
import { api } from '../../api/client';
import { CheckCheck, CheckCircle2, AlertOctagon, ShieldCheck } from 'lucide-react';

interface InvariantResult {
  ok?: boolean;
  passed?: boolean;
  issues: Array<{
    invariant: string;
    message?: string;
    userId?: string;
    expected?: string;
    actual?: string;
  }>;
}

export const AdminVerifyPage: React.FC = () => {
  const [result, setResult] = useState<InvariantResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRunVerification = async () => {
    try {
      setIsRunning(true);
      setError(null);
      const res = await api.post<InvariantResult>('/api/v1/admin/verify-scores');
      setResult(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : copy.error);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h2 className="text-lg font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-primary-600" aria-hidden="true" />
          <span>{copy.admin.verify.title}</span>
        </h2>
        <p className="text-xs text-neutral-500 mt-0.5 leading-relaxed">
          {copy.admin.verify.description}
        </p>
      </div>

      <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              Audit Invariants Engine
            </h3>
            <p className="text-xs text-neutral-400">
              Performs exhaustive verification against database constraints and ledger rows.
            </p>
          </div>

          <Button
            variant="primary"
            onClick={handleRunVerification}
            isLoading={isRunning}
            icon={<CheckCheck className="w-4 h-4" aria-hidden="true" />}
          >
            {isRunning ? copy.admin.verify.running : copy.admin.verify.runBtn}
          </Button>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 p-3 text-xs text-red-700 dark:text-red-300"
          >
            {error}
          </div>
        )}

        {result && (
          <div className="pt-2">
            {(result.ok ?? result.passed ?? (result.issues?.length === 0)) ? (
              <div className="rounded-xl bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-900/60 p-4 text-xs text-green-800 dark:text-green-200 flex items-center gap-3">
                <CheckCircle2 className="w-6 h-6 text-green-600 shrink-0" aria-hidden="true" />
                <div>
                  <p className="font-bold text-sm">Audit Passed</p>
                  <p>{copy.admin.verify.passed}</p>
                </div>
              </div>
            ) : (
              <div className="rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 p-4 text-xs text-red-800 dark:text-red-200 space-y-3">
                <div className="flex items-center gap-2">
                  <AlertOctagon className="w-5 h-5 text-red-600 shrink-0" aria-hidden="true" />
                  <p className="font-bold text-sm">
                    {copy.admin.verify.failed(result.issues?.length ?? 0)}
                  </p>
                </div>
                <ul className="list-disc list-inside space-y-1 font-mono text-[11px]">
                  {(result.issues || []).map((issue, idx) => (
                    <li key={idx}>
                      <strong>{issue.invariant}:</strong>{' '}
                      {issue.message ||
                        `expected ${issue.expected}, got ${issue.actual}${
                          issue.userId ? ` (user: ${issue.userId})` : ''
                        }`}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
