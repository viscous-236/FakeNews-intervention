import React, { useState, useEffect } from 'react';
import { copy } from '../copy';
import { AppealItem, PaginatedResponse } from '../types';
import { api } from '../api/client';
import { Scale, CheckCircle2, XCircle, Clock, Loader2 } from 'lucide-react';

export const AppealsPage: React.FC = () => {
  const [appeals, setAppeals] = useState<AppealItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setIsLoading(true);

    api
      .get<PaginatedResponse<AppealItem>>('/api/v1/appeals')
      .then((res) => {
        if (!mounted) return;
        setAppeals(res.items);
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

  const renderStatus = (status: AppealItem['status']) => {
    switch (status) {
      case 'open':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
            <Clock className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{copy.appeals.statusOpen}</span>
          </span>
        );
      case 'upheld':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300">
            <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{copy.appeals.statusUpheld}</span>
          </span>
        );
      case 'overturned':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-300">
            <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{copy.appeals.statusOverturned}</span>
          </span>
        );
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
          <Scale className="w-6 h-6 text-primary-600 dark:text-primary-400" aria-hidden="true" />
          <span>{copy.appeals.title}</span>
        </h1>
        <p className="mt-1 text-xs text-neutral-500">
          {copy.appeals.subtitle}
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
          className="rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 p-4 text-center text-sm text-red-700 dark:text-red-300"
        >
          {error}
        </div>
      ) : appeals.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 p-12 text-center text-xs text-neutral-500 bg-white dark:bg-neutral-800">
          {copy.appeals.empty}
        </div>
      ) : (
        <div className="space-y-4">
          {appeals.map((appeal) => (
            <div
              key={appeal.id}
              className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-5 shadow-sm space-y-3"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                    Appeal #{appeal.id.slice(0, 8)}
                  </h3>
                  <time className="text-[11px] text-neutral-400">
                    Submitted {new Date(appeal.createdAt).toLocaleDateString()}
                  </time>
                </div>
                {renderStatus(appeal.status)}
              </div>

              {appeal.event && (
                <div className="rounded-lg bg-neutral-50 dark:bg-neutral-850 p-2.5 text-xs border border-neutral-200 dark:border-neutral-700">
                  <span className="font-semibold text-neutral-700 dark:text-neutral-300">
                    Contested Penalty: {copy.eventKind[appeal.event.kind]}
                  </span>
                  <p className="text-[11px] text-neutral-500 italic mt-0.5 line-clamp-2">
                    "{appeal.event.post.excerpt}"
                  </p>
                </div>
              )}

              <div className="text-xs space-y-1">
                <span className="font-semibold text-neutral-700 dark:text-neutral-300">
                  {copy.appeals.reasonLabel}:
                </span>
                <p className="text-neutral-600 dark:text-neutral-300 bg-white dark:bg-neutral-900/50 p-2.5 rounded border border-neutral-200 dark:border-neutral-700 whitespace-pre-line">
                  {appeal.reason}
                </p>
              </div>

              {appeal.resolutionNote && (
                <div className="text-xs space-y-1 pt-1 border-t border-neutral-100 dark:border-neutral-700">
                  <span className="font-semibold text-neutral-700 dark:text-neutral-300">
                    {copy.appeals.resolutionNoteLabel}:
                  </span>
                  <p className="text-neutral-600 dark:text-neutral-300 bg-neutral-50 dark:bg-neutral-850 p-2.5 rounded italic">
                    {appeal.resolutionNote}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
