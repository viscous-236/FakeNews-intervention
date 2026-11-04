import React, { useState, useEffect } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { copy } from '../../copy';
import { AppealItem, PaginatedResponse, AssessmentVerdict } from '../../types';
import { api } from '../../api/client';
import { Scale, CheckCircle2, XCircle, Loader2 } from 'lucide-react';

export const AdminAppealsPage: React.FC = () => {
  const [appeals, setAppeals] = useState<AppealItem[]>([]);
  const [selectedAppeal, setSelectedAppeal] = useState<AppealItem | null>(null);
  const [decision, setDecision] = useState<'upheld' | 'overturned'>('overturned');
  const [newVerdict, setNewVerdict] = useState<AssessmentVerdict>('unverifiable');
  const [resolutionNote, setResolutionNote] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAppeals = async () => {
    try {
      setIsLoading(true);
      const res = await api.get<PaginatedResponse<AppealItem>>('/api/v1/admin/appeals');
      setAppeals(res.items);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : copy.error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchAppeals();
  }, []);

  const handleResolve = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAppeal || resolutionNote.trim().length < 10 || isSubmitting) return;

    try {
      setIsSubmitting(true);
      await api.post(`/api/v1/admin/appeals/${selectedAppeal.id}/resolve`, {
        decision,
        resolutionNote: resolutionNote.trim(),
        newVerdict: decision === 'overturned' ? newVerdict : undefined,
      });
      setSelectedAppeal(null);
      setResolutionNote('');
      await fetchAppeals();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : copy.error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
          <Scale className="w-5 h-5 text-purple-600" aria-hidden="true" />
          <span>{copy.admin.appeals.title}</span>
        </h2>
        <p className="text-xs text-neutral-500 mt-0.5">
          Adjudicate contested penalties. Overturning creates REVERSAL events and unfreezes reputation.
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
      ) : appeals.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 p-12 text-center text-xs text-neutral-500 bg-white dark:bg-neutral-800">
          {copy.admin.appeals.empty}
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
                    Appeal #{appeal.id.slice(0, 8)} • User @{appeal.user?.username || appeal.userId}
                  </h3>
                  <time className="text-[11px] text-neutral-400">
                    Submitted {new Date(appeal.createdAt).toLocaleString()}
                  </time>
                </div>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => setSelectedAppeal(appeal)}
                >
                  Adjudicate Appeal
                </Button>
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
                  Appellant's Statement & Evidence:
                </span>
                <p className="text-neutral-600 dark:text-neutral-300 bg-neutral-50 dark:bg-neutral-850 p-3 rounded border border-neutral-100 dark:border-neutral-750 whitespace-pre-line leading-relaxed">
                  {appeal.reason}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Adjudicate Dialog */}
      {selectedAppeal && (
        <Modal
          isOpen={!!selectedAppeal}
          onClose={() => setSelectedAppeal(null)}
          title="Adjudicate Credibility Appeal"
          size="md"
        >
          <form onSubmit={handleResolve} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
                {copy.admin.appeals.decisionLabel}
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setDecision('overturned')}
                  className={`p-3 rounded-lg border text-left text-xs transition-colors flex items-center gap-2 ${
                    decision === 'overturned'
                      ? 'border-green-500 bg-green-50 dark:bg-green-950/40 text-green-900 dark:text-green-200'
                      : 'border-neutral-200 dark:border-neutral-700'
                  }`}
                >
                  <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" aria-hidden="true" />
                  <span className="font-semibold">{copy.admin.appeals.overturnOption}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setDecision('upheld')}
                  className={`p-3 rounded-lg border text-left text-xs transition-colors flex items-center gap-2 ${
                    decision === 'upheld'
                      ? 'border-red-500 bg-red-50 dark:bg-red-950/40 text-red-900 dark:text-red-200'
                      : 'border-neutral-200 dark:border-neutral-700'
                  }`}
                >
                  <XCircle className="w-4 h-4 text-red-600 shrink-0" aria-hidden="true" />
                  <span className="font-semibold">{copy.admin.appeals.upholdOption}</span>
                </button>
              </div>
            </div>

            {decision === 'overturned' && (
              <div>
                <label
                  htmlFor="new-verdict"
                  className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1"
                >
                  {copy.admin.appeals.newVerdictLabel}
                </label>
                <select
                  id="new-verdict"
                  value={newVerdict}
                  onChange={(e) => setNewVerdict(e.target.value as AssessmentVerdict)}
                  className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2 text-xs text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="unverifiable">Unverifiable (Nullify penalty)</option>
                  <option value="real">Real / Verified (Award responsible sharing)</option>
                </select>
              </div>
            )}

            <div>
              <label
                htmlFor="resolution-note"
                className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1"
              >
                Adjudication Rationale (min 10 characters)
              </label>
              <textarea
                id="resolution-note"
                rows={4}
                required
                value={resolutionNote}
                onChange={(e) => setResolutionNote(e.target.value)}
                placeholder={copy.admin.appeals.resolutionNotePlaceholder}
                className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2 text-xs text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setSelectedAppeal(null)}
                disabled={isSubmitting}
              >
                {copy.cancel}
              </Button>
              <Button
                type="submit"
                variant="primary"
                isLoading={isSubmitting}
                disabled={resolutionNote.trim().length < 10}
              >
                {copy.admin.appeals.submitResolution}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
