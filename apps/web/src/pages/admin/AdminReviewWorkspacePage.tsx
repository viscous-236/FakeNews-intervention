import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAdminPost, useAdminPostAction, useAssessPost } from '../../api/hooks';
import { copy } from '../../copy';
import { errorMessage } from '../../api/client';
import { formatDateTime, signed } from '../../lib/format';
import type { AssessmentVerdict } from '../../types';
import { PostBody } from '../../components/posts/PostBody';
import { Avatar } from '../../components/ui/Avatar';
import { PostLabelBadge, TierBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { CharCount, Textarea } from '../../components/ui/Field';
import { ConfirmDialog } from '../../components/ui/Modal';
import { Pill } from '../../components/ui/Pill';
import {
  EmptyState,
  ErrorState,
  KeyValue,
  LoadingBlock,
  Notice,
  PageHeader,
  Panel,
  SectionTitle,
} from '../../components/ui/Page';

const VERDICTS: AssessmentVerdict[] = ['fake', 'real', 'unverifiable'];
const verdictTone = { fake: 'negative', real: 'positive', unverifiable: 'neutral' } as const;

/** Review workspace (TASK-094): post, model output, reports, history and the decision form. */
export function AdminReviewWorkspacePage(): React.ReactElement {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const detail = useAdminPost(id);
  const assess = useAssessPost(id);
  const action = useAdminPostAction(id);
  const [verdict, setVerdict] = useState<AssessmentVerdict>('fake');
  const [rationale, setRationale] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');

  if (detail.isLoading) return <LoadingBlock />;
  if (detail.isError || !detail.data) {
    return (
      <ErrorState
        message={errorMessage(detail.error, copy.common.error)}
        onRetry={() => void detail.refetch()}
      />
    );
  }
  const d = detail.data;
  const current = d.assessments.find((a) => a.isCurrent);
  const latestDetection = d.detections[0];
  const rationaleOk = rationale.trim().length >= 10 && rationale.trim().length <= 2000;
  const canSubmit = !d.conflictOfInterest && rationaleOk && !assess.isPending;

  const consequence =
    verdict === 'fake'
      ? copy.admin.workspace.consequenceFake(
          d.interactors.resharers,
          d.interactors.likers,
          d.interactors.reporters,
        )
      : verdict === 'real'
        ? copy.admin.workspace.consequenceReal(d.interactors.resharers)
        : copy.admin.workspace.consequenceUnverifiable;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    assess.mutate(
      { verdict, rationale: rationale.trim() },
      {
        onSuccess: () => navigate('/admin/queue'),
        onError: (err) => setError(errorMessage(err, copy.common.error)),
      },
    );
  }

  return (
    <div>
      <PageHeader
        title={copy.admin.workspace.title}
        backTo="/admin/queue"
        backLabel={copy.admin.workspace.backToQueue}
        action={
          <>
            {d.post.status === 'held' ? (
              <Button
                variant="secondary"
                onClick={() => action.mutate({ kind: 'release' })}
                isLoading={action.isPending}
              >
                {copy.admin.workspace.release}
              </Button>
            ) : null}
            <Button
              variant="secondary"
              onClick={() => action.mutate({ kind: 'redetect' })}
              isLoading={action.isPending}
            >
              {copy.admin.workspace.redetect}
            </Button>
            {d.post.status !== 'deleted' ? (
              <Button variant="danger" onClick={() => setDeleting(true)}>
                {copy.admin.workspace.deletePost}
              </Button>
            ) : null}
          </>
        }
      />

      {d.conflictOfInterest ? (
        <div className="mb-6">
          <Notice tone="negative">{copy.admin.workspace.conflict}</Notice>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_384px]">
        <div className="space-y-6">
          <section aria-labelledby="ws-post">
            <SectionTitle>
              <span id="ws-post">{copy.admin.workspace.postTitle}</span>
            </SectionTitle>
            <Panel>
              <div className="flex flex-wrap items-center gap-2">
                <Avatar
                  avatarUrl={d.post.author.avatarUrl}
                  displayName={d.post.author.displayName}
                  username={d.post.author.username}
                  size="sm"
                />
                <Link
                  to={`/u/${d.post.author.username}`}
                  className="text-body font-medium text-ink hover:underline"
                >
                  {d.post.author.displayName}
                </Link>
                <span className="text-small text-muted">@{d.post.author.username}</span>
                <TierBadge tier={d.author.tier} />
                <span className="num text-small text-muted">
                  {copy.admin.workspace.q} {d.author.q} · {copy.admin.workspace.sigma}{' '}
                  {d.author.sigma}
                </span>
                <time dateTime={d.post.createdAt} className="text-small text-muted">
                  {formatDateTime(d.post.createdAt)}
                </time>
                <Pill
                  tone={
                    d.post.status === 'published'
                      ? 'neutral'
                      : d.post.status === 'held'
                        ? 'accent'
                        : 'negative'
                  }
                >
                  {d.post.status}
                </Pill>
                <PostLabelBadge label={d.post.label} underAppeal={d.post.underAppeal} />
              </div>
              <PostBody text={d.post.body} className="mt-3" />
              {d.post.sourceUrl ? (
                <a
                  href={d.post.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="mt-2 inline-block break-all text-small text-accent hover:underline"
                >
                  {d.post.sourceUrl}
                </a>
              ) : null}
              {d.post.images.length ? (
                <div className="mt-3 grid grid-cols-2 gap-1 sm:grid-cols-4">
                  {d.post.images.map((img, i) => (
                    <img
                      key={img.id}
                      src={img.url}
                      alt={copy.post.imageAlt(i + 1)}
                      className="aspect-square w-full rounded-card bg-raised object-cover"
                      loading="lazy"
                    />
                  ))}
                </div>
              ) : null}
            </Panel>
          </section>

          <section aria-labelledby="ws-reports">
            <SectionTitle>
              <span id="ws-reports">
                {copy.admin.workspace.reportsTitle}{' '}
                <span className="num text-muted">{d.reports.length}</span>
              </span>
            </SectionTitle>
            {d.reports.length === 0 ? (
              <EmptyState>{copy.admin.workspace.noReports}</EmptyState>
            ) : (
              <ul className="divide-y divide-rule rounded-card border border-border px-5">
                {d.reports.map((r) => (
                  <li key={r.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-2 text-small">
                      <Link
                        to={`/u/${r.reporter.username}`}
                        className="font-medium text-ink hover:underline"
                      >
                        @{r.reporter.username}
                      </Link>
                      <Pill tone={r.status === 'open' ? 'warning' : 'neutral'}>{r.status}</Pill>
                      <span className="text-muted">{copy.reportDialog.reasons[r.reason]}</span>
                      <time dateTime={r.createdAt} className="text-muted">
                        {formatDateTime(r.createdAt)}
                      </time>
                    </div>
                    {r.details ? (
                      <p className="mt-1 whitespace-pre-wrap text-body text-ink">{r.details}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="ws-history">
            <SectionTitle>
              <span id="ws-history">{copy.admin.workspace.historyTitle}</span>
            </SectionTitle>
            {d.assessments.length === 0 ? (
              <EmptyState>{copy.admin.workspace.noHistory}</EmptyState>
            ) : (
              <ul className="divide-y divide-rule rounded-card border border-border px-5">
                {d.assessments.map((a) => (
                  <li key={a.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-2 text-small">
                      <Pill tone={verdictTone[a.verdict]}>
                        {copy.admin.workspace.verdict[a.verdict]}
                      </Pill>
                      <span className="text-muted">
                        {a.source === 'admin' ? 'Reviewer' : 'Automatic low-risk rule'}
                      </span>
                      {a.isCurrent ? <Pill tone="accent">current</Pill> : null}
                      <time dateTime={a.createdAt} className="text-muted">
                        {formatDateTime(a.createdAt)}
                      </time>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-body text-ink">{a.rationale}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="ws-events">
            <SectionTitle>
              <span id="ws-events">
                {copy.admin.workspace.eventsTitle}{' '}
                <span className="num text-muted">{d.events.length}</span>
              </span>
            </SectionTitle>
            {d.events.length === 0 ? (
              <EmptyState>{copy.admin.workspace.noEvents}</EmptyState>
            ) : (
              <table className="w-full text-body">
                <thead>
                  <tr className="text-left text-small text-muted">
                    <th className="py-2 pr-3 font-normal">{copy.admin.waves.user}</th>
                    <th className="py-2 pr-3 font-normal">Event</th>
                    <th className="num py-2 pr-3 text-right font-normal">Value</th>
                    <th className="py-2 pr-3 font-normal">Status</th>
                    <th className="py-2 font-normal">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {d.events.map((ev) => (
                    <tr key={ev.id} className="h-row">
                      <td className="pr-3 text-ink">@{ev.username}</td>
                      <td className="pr-3">{copy.eventKind[ev.kind]}</td>
                      <td
                        className={`num pr-3 text-right font-mono ${ev.value > 0 ? 'text-positive' : 'text-negative'}`}
                      >
                        {signed(ev.value)}
                      </td>
                      <td className="pr-3">
                        <Pill
                          tone={
                            ev.status === 'counted'
                              ? 'positive'
                              : ev.status === 'voided'
                                ? 'neutral'
                                : ev.status === 'held'
                                  ? 'warning'
                                  : 'accent'
                          }
                        >
                          {copy.eventStatus[ev.status]}
                        </Pill>
                        {ev.voidReason ? (
                          <span className="ml-2 text-small text-muted">
                            {copy.voidReason[ev.voidReason]}
                          </span>
                        ) : null}
                      </td>
                      <td className="text-muted">{formatDateTime(ev.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <section aria-labelledby="ws-model">
            <SectionTitle>
              <span id="ws-model">{copy.admin.workspace.modelTitle}</span>
            </SectionTitle>
            <Panel>
              {latestDetection ? (
                <dl className="divide-y divide-rule">
                  <KeyValue label="Status">
                    <Pill
                      tone={
                        latestDetection.status === 'ok'
                          ? 'neutral'
                          : latestDetection.status === 'failed_permanent'
                            ? 'negative'
                            : 'warning'
                      }
                    >
                      {copy.admin.overview.detectionStatus[latestDetection.status]}
                    </Pill>
                  </KeyValue>
                  <KeyValue label={copy.admin.workspace.band}>
                    {latestDetection.band
                      ? copy.admin.analytics.bands[latestDetection.band]
                      : copy.common.none}
                  </KeyValue>
                  <KeyValue label={copy.admin.workspace.pFake} mono>
                    {latestDetection.pFake ?? copy.common.none}
                  </KeyValue>
                  <KeyValue label={copy.admin.workspace.model} mono>
                    {latestDetection.modelName
                      ? `${latestDetection.modelName} ${latestDetection.modelVersion ?? ''}`
                      : copy.common.none}
                  </KeyValue>
                  {latestDetection.errorCode ? (
                    <KeyValue label="Error" mono>
                      {latestDetection.errorCode}
                    </KeyValue>
                  ) : null}
                </dl>
              ) : (
                <p className="text-body text-muted">{copy.admin.workspace.noDetection}</p>
              )}
              {latestDetection?.status === 'failed_permanent' ? (
                <div className="mt-3">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      action.mutate({ kind: 'requeue', detectionId: latestDetection.id })
                    }
                    isLoading={action.isPending}
                  >
                    {copy.admin.workspace.requeue}
                  </Button>
                </div>
              ) : null}
            </Panel>
          </section>

          <section aria-labelledby="ws-decision">
            <SectionTitle>
              <span id="ws-decision">{copy.admin.workspace.decisionTitle}</span>
            </SectionTitle>
            <Panel>
              <form onSubmit={submit} className="space-y-4">
                {error ? <ErrorState message={error} compact /> : null}
                {current && current.source === 'admin' ? (
                  <p className="text-small text-muted">
                    {copy.admin.workspace.alreadyAssessed(
                      copy.admin.workspace.verdict[current.verdict],
                    )}
                  </p>
                ) : null}
                <fieldset>
                  <legend className="text-body font-medium text-ink">
                    {copy.admin.workspace.verdictLabel}
                  </legend>
                  <div className="mt-2 space-y-1.5">
                    {VERDICTS.map((v) => (
                      <label
                        key={v}
                        className={`flex cursor-pointer items-start gap-3 rounded-control border p-3 ${verdict === v ? 'border-ink bg-raised' : 'border-border hover:bg-raised/60'}`}
                      >
                        <input
                          type="radio"
                          name="verdict"
                          value={v}
                          checked={verdict === v}
                          onChange={() => setVerdict(v)}
                          className="mt-1"
                        />
                        <span>
                          <span className="block text-body font-medium text-ink">
                            {copy.admin.workspace.verdict[v]}
                          </span>
                          <span className="block text-small text-muted">
                            {copy.admin.workspace.verdictHint[v]}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className="rounded-control bg-raised p-3 text-body">
                  <p className="text-small text-muted">{copy.admin.workspace.consequences}</p>
                  <p className="mt-1 text-ink">{consequence}</p>
                </div>

                <Textarea
                  label={copy.admin.workspace.rationaleLabel}
                  hint={copy.admin.workspace.rationaleHint}
                  rows={4}
                  maxLength={2000}
                  value={rationale}
                  onChange={(e) => setRationale(e.target.value)}
                  required
                  trailing={<CharCount value={rationale.trim().length} max={2000} />}
                />

                <Button
                  type="submit"
                  variant="primary"
                  className="w-full"
                  disabled={!canSubmit}
                  isLoading={assess.isPending}
                >
                  {assess.isPending ? copy.admin.workspace.submitting : copy.admin.workspace.submit}
                </Button>
              </form>
            </Panel>
          </section>
        </div>
      </div>

      <ConfirmDialog
        isOpen={deleting}
        onClose={() => setDeleting(false)}
        title={copy.post.deleteTitle}
        body={copy.post.deleteBody}
        confirmLabel={copy.admin.workspace.deletePost}
        danger
        isLoading={action.isPending}
        onConfirm={() =>
          action.mutate(
            { kind: 'delete', reason: deleteReason.trim() },
            { onSuccess: () => navigate('/admin/queue') },
          )
        }
      >
        <Textarea
          label={copy.admin.workspace.deleteReason}
          rows={2}
          value={deleteReason}
          onChange={(e) => setDeleteReason(e.target.value)}
          maxLength={1000}
        />
      </ConfirmDialog>
    </div>
  );
}
