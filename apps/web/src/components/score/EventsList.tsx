import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import type { EventItem, ReputationEventStatus } from '../../types';
import { copy } from '../../copy';
import { formatDate, signed } from '../../lib/format';
import { Button } from '../ui/Button';
import { Pill, type PillTone } from '../ui/Pill';
import { Tabs } from '../ui/Tabs';
import { EmptyState } from '../ui/Page';
import { AppealDialog } from './AppealDialog';

type Filter = 'all' | ReputationEventStatus;

const statusTone: Record<ReputationEventStatus, PillTone> = {
  eligible: 'accent',
  held: 'warning',
  counted: 'positive',
  voided: 'neutral',
};

export function canAppeal(ev: EventItem): boolean {
  const negative =
    ev.kind === 'MISINFO_POST' || ev.kind === 'MISINFO_RESHARE' || ev.kind === 'MISINFO_LIKE';
  return negative && ev.status !== 'voided' && !ev.appeal;
}

/** Events with status chips, void reasons and the appeal action (TASK-091). */
export function EventsList({ events }: { events: EventItem[] }): React.ReactElement {
  const [filter, setFilter] = useState<Filter>('all');
  const [appealing, setAppealing] = useState<EventItem | null>(null);
  const filtered = filter === 'all' ? events : events.filter((e) => e.status === filter);

  const countOf = (s: ReputationEventStatus) => events.filter((e) => e.status === s).length;

  return (
    <div>
      <Tabs<Filter>
        label={copy.score.eventsTitle}
        value={filter}
        onChange={setFilter}
        items={[
          { value: 'all', label: copy.score.filterAll, count: events.length },
          { value: 'eligible', label: copy.eventStatus.eligible, count: countOf('eligible') },
          { value: 'held', label: copy.eventStatus.held, count: countOf('held') },
          { value: 'counted', label: copy.eventStatus.counted, count: countOf('counted') },
          { value: 'voided', label: copy.eventStatus.voided, count: countOf('voided') },
        ]}
      />

      {filtered.length === 0 ? (
        <div className="mt-4">
          <EmptyState>{copy.score.noEvents}</EmptyState>
        </div>
      ) : (
        <ul className="divide-y divide-rule">
          {filtered.map((ev) => (
            <li key={ev.id} className="flex gap-4 py-4">
              <span
                className={`num mt-0.5 w-9 shrink-0 text-right font-mono text-section ${
                  ev.value > 0 ? 'text-positive' : 'text-negative'
                }`}
                aria-label={signed(ev.value)}
              >
                {signed(ev.value)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-body font-medium text-ink">{copy.eventKind[ev.kind]}</p>
                  <Pill tone={statusTone[ev.status]}>{copy.eventStatus[ev.status]}</Pill>
                  {ev.waveNumber ? (
                    <span className="num text-small text-muted">Wave {ev.waveNumber}</span>
                  ) : null}
                </div>
                <Link
                  to={`/p/${ev.post.id}`}
                  className="mt-1 block line-clamp-2 text-body text-muted hover:text-ink"
                >
                  “{ev.post.excerpt}”
                </Link>
                {ev.voidReason ? (
                  <p className="mt-1 text-small text-muted">{copy.voidReason[ev.voidReason]}</p>
                ) : null}
                {ev.assessment ? (
                  <p className="mt-1 text-small text-muted">
                    <span className="font-medium text-ink">
                      {copy.admin.workspace.verdict[ev.assessment.verdict]}
                    </span>
                    {' · '}
                    {ev.assessment.rationale}
                  </p>
                ) : null}
                {ev.status === 'held' ? (
                  <p className="mt-1 text-small text-warning-ink">{copy.score.heldNotice}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2 text-small text-muted">
                <time dateTime={ev.createdAt}>{formatDate(ev.createdAt)}</time>
                {ev.appeal ? (
                  <Link to="/appeals" className="text-accent hover:underline">
                    {copy.score.appealed(copy.appeals.status[ev.appeal.status])}
                  </Link>
                ) : canAppeal(ev) ? (
                  <Button size="sm" variant="secondary" onClick={() => setAppealing(ev)}>
                    {copy.score.appeal}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <AppealDialog event={appealing} onClose={() => setAppealing(null)} />
    </div>
  );
}
