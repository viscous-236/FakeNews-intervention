import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { copy } from '../../copy';
import { EventItem } from '../../types';
import { api } from '../../api/client';
import { Scale } from 'lucide-react';

interface AppealDialogProps {
  event: EventItem | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const AppealDialog: React.FC<AppealDialogProps> = ({
  event,
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!event) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (reason.trim().length < 20 || reason.trim().length > 1000) {
      setError('Appeal statement must be between 20 and 1000 characters.');
      return;
    }

    try {
      setIsSubmitting(true);
      await api.post('/api/v1/appeals', {
        eventId: event.id,
        reason: reason.trim(),
      });
      setReason('');
      onSuccess();
      onClose();
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
      title={copy.appealDialog.title}
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">
          {copy.appealDialog.description}
        </p>

        {error && (
          <div
            role="alert"
            className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 p-3 text-xs text-red-700 dark:text-red-300"
          >
            {error}
          </div>
        )}

        <div className="rounded-lg bg-neutral-50 dark:bg-neutral-800 p-3 text-xs border border-neutral-200 dark:border-neutral-700">
          <p className="font-semibold text-neutral-900 dark:text-neutral-100">
            Contested Penalty: {copy.eventKind[event.kind]}
          </p>
          <p className="text-neutral-500 italic mt-0.5 line-clamp-2">
            "{event.post.excerpt}"
          </p>
        </div>

        <div>
          <label
            htmlFor="appeal-reason"
            className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1"
          >
            {copy.appealDialog.reasonLabel}
          </label>
          <textarea
            id="appeal-reason"
            rows={5}
            maxLength={1000}
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={copy.appealDialog.reasonPlaceholder}
            className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2 text-xs text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <div className="flex justify-between items-center text-[11px] text-neutral-400 mt-1">
            <span>Min 20 characters</span>
            <span>{copy.composer.charCount(reason.trim().length, 1000)}</span>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isSubmitting}
          >
            {copy.appealDialog.cancel}
          </Button>
          <Button
            type="submit"
            variant="primary"
            isLoading={isSubmitting}
            disabled={reason.trim().length < 20}
            icon={<Scale className="w-4 h-4" aria-hidden="true" />}
          >
            {isSubmitting ? copy.appealDialog.submitting : copy.appealDialog.submit}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
