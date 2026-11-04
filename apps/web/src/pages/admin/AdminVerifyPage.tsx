import React, { useState } from 'react';
import { useVerifyScores } from '../../api/hooks';
import { copy } from '../../copy';
import { errorMessage } from '../../api/client';
import { formatDateTime, shortId } from '../../lib/format';
import { Button } from '../../components/ui/Button';
import { ErrorState, Notice, PageHeader, Panel, SectionTitle } from '../../components/ui/Page';

const INVARIANTS = ['I1', 'I2', 'I3', 'I4', 'I5', 'I6'] as const;

/** Verify scores (TASK-097): run the I1–I6 audit and list every violation. */
export function AdminVerifyPage(): React.ReactElement {
  const verify = useVerifyScores();
  const [ranAt, setRanAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const result = verify.data;

  return (
    <div className="mx-auto max-w-sheet">
      <PageHeader
        title={copy.admin.verify.title}
        subtitle={copy.admin.verify.subtitle}
        action={
          <Button
            variant="primary"
            isLoading={verify.isPending}
            onClick={() => {
              setError(null);
              verify.mutate(undefined, {
                onSuccess: () => setRanAt(new Date().toISOString()),
                onError: (err) => setError(errorMessage(err, copy.common.error)),
              });
            }}
          >
            {verify.isPending ? copy.admin.verify.running : copy.admin.verify.run}
          </Button>
        }
      />

      {error ? (
        <div className="mb-4">
          <ErrorState message={error} />
        </div>
      ) : null}

      {result ? (
        <div className="mb-6">
          <Notice tone={result.ok ? 'positive' : 'negative'}>
            {result.ok ? copy.admin.verify.passed : copy.admin.verify.failed(result.issues.length)}
            {ranAt ? (
              <span className="ml-2 text-small">
                {copy.admin.verify.lastRun(formatDateTime(ranAt))}
              </span>
            ) : null}
          </Notice>
        </div>
      ) : null}

      {result && !result.ok ? (
        <div className="mb-8 overflow-x-auto">
          <table className="w-full text-body">
            <thead>
              <tr className="text-left text-small text-muted">
                <th className="py-2 pr-3 font-normal">{copy.admin.verify.columns.invariant}</th>
                <th className="py-2 pr-3 font-normal">{copy.admin.verify.columns.user}</th>
                <th className="py-2 pr-3 font-normal">{copy.admin.verify.columns.wave}</th>
                <th className="py-2 pr-3 font-normal">{copy.admin.verify.columns.expected}</th>
                <th className="py-2 font-normal">{copy.admin.verify.columns.actual}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule font-mono">
              {result.issues.map((issue, i) => (
                <tr key={i}>
                  <td className="py-2 pr-3 text-negative">{issue.invariant}</td>
                  <td className="py-2 pr-3">{shortId(issue.userId)}</td>
                  <td className="py-2 pr-3">
                    {issue.waveNumber ?? (issue.waveId ? shortId(issue.waveId) : copy.common.none)}
                  </td>
                  <td className="py-2 pr-3">{issue.expected}</td>
                  <td className="py-2">{issue.actual}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <SectionTitle>Invariants</SectionTitle>
      <Panel>
        <dl className="divide-y divide-rule">
          {INVARIANTS.map((k) => (
            <div key={k} className="flex gap-4 py-2 text-body">
              <dt className="w-8 shrink-0 font-mono text-ink">{k}</dt>
              <dd className="text-muted">{copy.admin.verify.invariants[k]}</dd>
            </div>
          ))}
        </dl>
      </Panel>
    </div>
  );
}
