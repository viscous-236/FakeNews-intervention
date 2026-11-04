import React, { useState } from 'react';
import { EventItem, ReputationEventStatus } from '../../types';
import { Button } from '../ui/Button';
import { AppealDialog } from './AppealDialog';
import { copy } from '../../copy';
import {
  CheckCircle2,
  AlertTriangle,
  Ban,
  Clock,
  Scale,
} from 'lucide-react';

interface EventsListProps {
  events: EventItem[];
  onRefresh: () => void;
}

export const EventsList: React.FC<EventsListProps> = ({ events, onRefresh }) => {
  const [filter, setFilter] = useState<'all' | ReputationEventStatus>('all');
  const [selectedEventForAppeal, setSelectedEventForAppeal] = useState<EventItem | null>(null);

  const filtered = filter === 'all' ? events : events.filter((e) => e.status === filter);

  const isEligibleForAppeal = (ev: EventItem) => {
    const isNegative =
      ev.kind === 'MISINFO_POST' ||
      ev.kind === 'MISINFO_RESHARE' ||
      ev.kind === 'MISINFO_LIKE';
    const notVoided = ev.status !== 'voided';
    const noOpenAppeal = !ev.appeal || ev.appeal.status !== 'open';
    return isNegative && notVoided && noOpenAppeal;
  };

  const renderStatusBadge = (ev: EventItem) => {
    switch (ev.status) {
      case 'eligible':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
            <Clock className="w-3 h-3" aria-hidden="true" />
            <span>{copy.eventStatus.eligible}</span>
          </span>
        );
      case 'held':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300">
            <AlertTriangle className="w-3 h-3" aria-hidden="true" />
            <span>{copy.eventStatus.held}</span>
          </span>
        );
      case 'counted':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-300">
            <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
            <span>{copy.eventStatus.counted}</span>
          </span>
        );
      case 'voided':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
            <Ban className="w-3 h-3" aria-hidden="true" />
            <span>{copy.eventStatus.voided}</span>
          </span>
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* Filter Tabs */}
      <div className="flex flex-wrap gap-1.5 p-1 bg-neutral-100 dark:bg-neutral-800/80 rounded-xl text-xs">
        {(['all', 'eligible', 'counted', 'voided', 'held'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setFilter(tab)}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors min-h-[36px] focus:outline-none ${
              filter === tab
                ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-50 shadow-xs'
                : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900'
            }`}
          >
            {tab === 'all' ? copy.score.statusFilterAll : copy.eventStatus[tab]}
          </button>
        ))}
      </div>

      {/* Events List */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 p-8 text-center text-xs text-neutral-500 bg-white dark:bg-neutral-800">
          {copy.score.noEvents}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((ev) => {
            const isPositive = ev.value > 0;
            return (
              <div
                key={ev.id}
                className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-4 shadow-sm space-y-2.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={`font-mono text-xs font-bold px-2 py-0.5 rounded ${
                        isPositive
                          ? 'bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-300'
                          : 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300'
                      }`}
                    >
                      {isPositive ? `+${ev.value}` : ev.value}
                    </span>
                    <h4 className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                      {copy.eventKind[ev.kind] || ev.kind}
                    </h4>
                  </div>

                  <div className="flex items-center gap-2">
                    {renderStatusBadge(ev)}
                    <span className="text-[11px] text-neutral-400">
                      {new Date(ev.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                {/* Void reason chip if voided */}
                {ev.voidReason && (
                  <div className="rounded-md bg-neutral-100 dark:bg-neutral-750 px-2.5 py-1 text-[11px] text-neutral-600 dark:text-neutral-400 font-medium">
                    {copy.voidReason[ev.voidReason] || ev.voidReason}
                  </div>
                )}

                {/* Post excerpt */}
                <p className="text-xs text-neutral-600 dark:text-neutral-300 italic border-l-2 border-neutral-200 dark:border-neutral-700 pl-2.5 py-0.5 line-clamp-2">
                  "{ev.post.excerpt}"
                </p>

                {/* Assessment rationale */}
                {ev.assessment && (
                  <div className="text-[11px] text-neutral-500 bg-neutral-50 dark:bg-neutral-850 p-2 rounded-lg">
                    <span className="font-semibold text-neutral-700 dark:text-neutral-300">
                      Assessment ({ev.assessment.verdict}):{' '}
                    </span>
                    <span>{ev.assessment.rationale}</span>
                  </div>
                )}

                {/* Held under appeal notice or Appeal action */}
                <div className="pt-1 flex items-center justify-between">
                  {ev.status === 'held' ? (
                    <span className="text-xs text-purple-600 dark:text-purple-400 font-medium">
                      {copy.score.appealHeldNotice}
                    </span>
                  ) : ev.appeal ? (
                    <span className="text-xs text-neutral-500">
                      Appeal: <strong>{ev.appeal.status}</strong>
                    </span>
                  ) : isEligibleForAppeal(ev) ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSelectedEventForAppeal(ev)}
                      icon={<Scale className="w-3.5 h-3.5" aria-hidden="true" />}
                    >
                      {copy.score.appealPenalty}
                    </Button>
                  ) : (
                    <span />
                  )}

                  {ev.waveNumber && (
                    <span className="text-[11px] text-neutral-400 font-mono">
                      Wave #{ev.waveNumber}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Appeal Dialog */}
      <AppealDialog
        event={selectedEventForAppeal}
        isOpen={!!selectedEventForAppeal}
        onClose={() => setSelectedEventForAppeal(null)}
        onSuccess={onRefresh}
      />
    </div>
  );
};
