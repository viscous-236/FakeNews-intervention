import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { copy } from '../../copy';
import { Post } from '../../types';
import { AlertTriangle, Repeat } from 'lucide-react';

interface ReshareDialogProps {
  post: Post;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (comment?: string) => Promise<void>;
}

export const ReshareDialog: React.FC<ReshareDialogProps> = ({
  post,
  isOpen,
  onClose,
  onConfirm,
}) => {
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      setIsSubmitting(true);
      await onConfirm(comment.trim() ? comment.trim() : undefined);
      setComment('');
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
      title={copy.reshareDialog.title}
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {post.requiresShareConfirmation && (
          <div
            role="alert"
            className="rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 p-3 text-sm text-amber-800 dark:text-amber-200 flex items-start gap-2.5"
          >
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
            <p className="leading-snug">{copy.reshareDialog.warningPrompt}</p>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 p-3 text-sm text-red-700 dark:text-red-300"
          >
            {error}
          </div>
        )}

        {/* Embedded post preview */}
        <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/50 p-3 text-sm">
          <p className="font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
            @{post.author.username}
          </p>
          <p className="text-neutral-700 dark:text-neutral-300 line-clamp-3">
            {post.body}
          </p>
        </div>

        <div>
          <label
            htmlFor="reshare-comment"
            className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1"
          >
            Add an optional comment
          </label>
          <textarea
            id="reshare-comment"
            rows={3}
            maxLength={500}
            className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            placeholder={copy.reshareDialog.commentPlaceholder}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <div className="text-right text-xs text-neutral-500 dark:text-neutral-400 mt-1">
            {copy.composer.charCount(comment.length, 500)}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isSubmitting}
          >
            {copy.reshareDialog.cancel}
          </Button>
          <Button
            type="submit"
            variant={post.requiresShareConfirmation ? 'danger' : 'primary'}
            isLoading={isSubmitting}
            icon={<Repeat className="w-4 h-4" aria-hidden="true" />}
          >
            {isSubmitting ? copy.reshareDialog.sharing : copy.reshareDialog.confirmShare}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
