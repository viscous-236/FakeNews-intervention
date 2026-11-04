import React from 'react';
import { Link } from 'react-router-dom';
import { useAdminOverview, useDetectorStatus } from '../../api/hooks';
import { copy } from '../../copy';
import { errorMessage } from '../../api/client';
import type { DetectionStatus } from '../../types';
import { Button } from '../../components/ui/Button';
import { Pill } from '../../components/ui/Pill';
import {
  ErrorState,
  KeyValue,
  PageHeader,
  Panel,
  SectionTitle,
  Skeleton,
} from '../../components/ui/Page';

const STATUSES: DetectionStatus[] = ['queued', 'running', 'ok', 'failed', 'failed_permanent'];

/** Admin overview (TASK-092): counts as type, the queue one click away. */
export function AdminOverviewPage(): React.ReactElement {
  const overview = useAdminOverview();
  const detector = useDetectorStatus();
  const o = overview.data;

  return (
    <div>
      <PageHeader
        title={copy.admin.overview.title}
        action={
          <Link to="/admin/queue">
            <Button variant="primary">{copy.admin.overview.goToQueue}</Button>
          </Link>
        }
      />

      {overview.isError ? (
        <ErrorState
          message={errorMessage(overview.error, copy.common.error)}
          onRetry={() => void overview.refetch()}
        />
      ) : (
        <ul className="grid grid-cols-2 divide-border rounded-card border border-border sm:grid-cols-5 sm:divide-x">
          <Stat
            label={copy.admin.overview.openQueue}
            value={o?.openQueue}
            to="/admin/queue"
            lead
            loading={overview.isLoading}
          />
          <Stat
            label={copy.admin.overview.openAppeals}
            value={o?.openAppeals}
            to="/admin/appeals"
            loading={overview.isLoading}
          />
          <Stat
            label={copy.admin.overview.users}
            value={o?.users}
            to="/admin/users"
            loading={overview.isLoading}
          />
          <Stat label={copy.admin.overview.posts} value={o?.posts} loading={overview.isLoading} />
          <Stat
            label={copy.admin.overview.waves}
            value={o?.waves}
            to="/admin/waves"
            loading={overview.isLoading}
          />
        </ul>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="detection-title">
          <SectionTitle>
            <span id="detection-title">{copy.admin.overview.detectionTitle}</span>
          </SectionTitle>
          <Panel>
            {overview.isLoading ? (
              <Skeleton lines={5} />
            ) : (
              <dl className="divide-y divide-rule">
                {STATUSES.map((s) => (
                  <KeyValue key={s} label={copy.admin.overview.detectionStatus[s]}>
                    <span
                      className={
                        s === 'failed_permanent' && (o?.detectionStatusCounts[s] ?? 0) > 0
                          ? 'text-negative'
                          : ''
                      }
                    >
                      {o?.detectionStatusCounts[s] ?? 0}
                    </span>
                  </KeyValue>
                ))}
              </dl>
            )}
          </Panel>
        </section>

        <section aria-labelledby="detector-title">
          <SectionTitle>
            <span id="detector-title">{copy.admin.overview.detectorTitle}</span>
          </SectionTitle>
          <Panel>
            {detector.isLoading ? (
              <Skeleton lines={3} />
            ) : detector.isError ? (
              <ErrorState
                message={errorMessage(detector.error, copy.common.error)}
                onRetry={() => void detector.refetch()}
                compact
              />
            ) : (
              <dl className="divide-y divide-rule">
                <KeyValue label={copy.admin.overview.detectorTitle}>
                  <Pill tone={detector.data?.health?.status === 'ok' ? 'positive' : 'negative'}>
                    {detector.data?.health?.status === 'ok'
                      ? copy.admin.overview.detectorHealthy
                      : copy.admin.overview.detectorDown}
                  </Pill>
                </KeyValue>
                <KeyValue label={copy.admin.overview.detectorModel} mono>
                  {detector.data?.modelInfo
                    ? `${detector.data.modelInfo.model_name} · ${detector.data.modelInfo.model_version}`
                    : copy.admin.overview.detectorUnknown}
                </KeyValue>
                {detector.data?.modelInfo?.recommended_thresholds ? (
                  <KeyValue label="Recommended thresholds" mono>
                    {`fake ≥ ${detector.data.modelInfo.recommended_thresholds.fake_high} · real ≤ ${detector.data.modelInfo.recommended_thresholds.real_low}`}
                  </KeyValue>
                ) : null}
              </dl>
            )}
          </Panel>
        </section>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  to,
  lead = false,
  loading,
}: {
  label: string;
  value: number | undefined;
  to?: string;
  lead?: boolean;
  loading: boolean;
}): React.ReactElement {
  const body = (
    <>
      <span className="block text-small text-muted">{label}</span>
      <span
        className={`num mt-1 text-kpi ${lead ? 'font-medium' : ''} ${lead && (value ?? 0) > 0 ? 'text-accent' : 'text-ink'}`}
      >
        {loading ? <span className="inline-block h-7 w-12 rounded bg-raised" /> : (value ?? 0)}
      </span>
    </>
  );
  const cls =
    'block px-5 py-4 border-border [&:nth-child(odd)]:border-r sm:[&:nth-child(odd)]:border-r-0 [&:nth-child(-n+4)]:border-b sm:[&:nth-child(-n+4)]:border-b-0';
  return (
    <li className="contents">
      {to ? (
        <Link to={to} className={`${cls} hover:bg-raised/60`}>
          {body}
        </Link>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  );
}
