import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { copy } from '../../copy';
import { Post } from '../../types';
import { api } from '../../api/client';
import { Edit3 } from 'lucide-react';

interface EditPostDialogProps {
  post: Post;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updated: Post) => void;
}

export const EditPostDialog: React.FC<EditPostDialogProps> = ({
  post,
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [body, setBody] = useState(post.body);
  const [sourceUrl, setSourceUrl] = useState(post.sourceUrl || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (body.trim().length < 20 || body.trim().length > 500) {
      setError('Post body must be between 20 and 500 characters.');
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await api.patch<Post | { post: Post }>(`/api/v1/posts/${post.id}`, {
        body: body.trim(),
        sourceUrl: sourceUrl.trim() ? sourceUrl.trim() : null,
      });
      const updated = res && 'post' in res && res.post ? res.post : (res as Post);
      onSuccess(updated);
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
      title={copy.composer.edit}
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
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
            htmlFor="edit-body"
            className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1"
          >
            Post Content
          </label>
          <textarea
            id="edit-body"
            rows={4}
            maxLength={500}
            className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="flex justify-between items-center text-xs text-neutral-500 dark:text-neutral-400 mt-1">
            <span>Min 20 characters</span>
            <span>{copy.composer.charCount(body.length, 500)}</span>
          </div>
        </div>

        <div>
          <label
            htmlFor="edit-sourceUrl"
            className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1"
          >
            Source URL (optional)
          </label>
          <input
            id="edit-sourceUrl"
            type="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://reuters.com/..."
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
            {copy.cancel}
          </Button>
          <Button
            type="submit"
            variant="primary"
            isLoading={isSubmitting}
            icon={<Edit3 className="w-4 h-4" aria-hidden="true" />}
          >
            {isSubmitting ? copy.composer.saving : copy.save}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
