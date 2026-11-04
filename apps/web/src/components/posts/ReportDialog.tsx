import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { copy } from '../../copy';
import { ReportReason } from '../../types';
import { Flag, CheckCircle2 } from 'lucide-react';
import { api } from '../../api/client';

interface ReportDialogProps {
  postId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const ReportDialog: React.FC<ReportDialogProps> = ({
  postId,
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [reason, setReason] = useState<ReportReason>('false_information');
  const [details, setDetails] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      setIsSubmitting(true);
      await api.post('/api/v1/reports', {
        postId,
        reason,
        details: details.trim() ? details.trim() : undefined,
      });
      setSubmitted(true);
      onSuccess?.();
      setTimeout(() => {
        setSubmitted(false);
        setDetails('');
        onClose();
      }, 1800);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : copy.error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={copy.reportDialog.title}
      size="md"
    >
      {submitted ? (
        <div className="py-6 text-center space-y-3">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-950/50 text-green-600 dark:text-green-400">
            <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
          </div>
          <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
            {copy.reportDialog.success}
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-xs text-neutral-600 dark:text-neutral-400">
            {copy.reportDialog.description}
          </p>

          {error && (
            <div
              role="alert"
              className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 p-3 text-sm text-red-700 dark:text-red-300"
            >
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor="report-reason"
              className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1"
            >
              {copy.reportDialog.reasonLabel}
            </label>
            <select
              id="report-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value as ReportReason)}
              className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="false_information">
                {copy.reportDialog.reasons.false_information}
              </option>
              <option value="misleading">
                {copy.reportDialog.reasons.misleading}
              </option>
              <option value="spam">
                {copy.reportDialog.reasons.spam}
              </option>
              <option value="harassment">
                {copy.reportDialog.reasons.harassment}
              </option>
              <option value="other">
                {copy.reportDialog.reasons.other}
              </option>
            </select>
          </div>

          <div>
            <label
              htmlFor="report-details"
              className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1"
            >
              Context or Debunking Links (Optional)
            </label>
            <textarea
              id="report-details"
              rows={3}
              maxLength={500}
              placeholder={copy.reportDialog.detailsPlaceholder}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={isSubmitting}
            >
              {copy.reportDialog.cancel}
            </Button>
            <Button
              type="submit"
              variant="danger"
              isLoading={isSubmitting}
              icon={<Flag className="w-4 h-4" aria-hidden="true" />}
            >
              {isSubmitting ? copy.reportDialog.submitting : copy.reportDialog.submit}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
};
