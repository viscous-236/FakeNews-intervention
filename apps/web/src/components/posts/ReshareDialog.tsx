import React, { useState } from 'react';
import { Repeat2 } from 'lucide-react';
import type { Post } from '../../types';
import { copy } from '../../copy';
import { errorMessage } from '../../api/client';
import { useReshare } from '../../api/hooks';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { CharCount, Textarea } from '../ui/Field';
import { ErrorState, Notice } from '../ui/Page';
import { PostLabelBadge } from '../ui/Badge';

interface ReshareDialogProps {
  post: Post;
  isOpen: boolean;
  onClose: () => void;
  /** Test seam: when provided, the dialog calls this instead of the API. */
  onConfirm?: (comment?: string, acknowledgedWarning?: boolean) => Promise<void>;
}

/**
 * Share dialog (RUL-019). When the post requires confirmation the warning is
 * shown and the share is sent with acknowledgedWarning = true.
 */
export function ReshareDialog({
  post,
  isOpen,
  onClose,
  onConfirm,
}: ReshareDialogProps): React.ReactElement | null {
  const [comment, setComment] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reshare = useReshare();

  const needsAck = post.requiresShareConfirmation;
  const canSubmit = !busy && comment.length <= 500 && (!needsAck || acknowledged);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setBusy(true);
    const trimmed = comment.trim() || undefined;
    try {
      if (onConfirm) {
        await onConfirm(trimmed, needsAck ? true : undefined);
      } else {
        await reshare.mutateAsync({ post, comment: trimmed, acknowledgedWarning: needsAck });
      }
      setComment('');
      setAcknowledged(false);
      onClose();
    } catch (err) {
      setError(errorMessage(err, copy.common.error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={copy.reshareDialog.title}>
      <form onSubmit={submit} className="space-y-4">
        {needsAck ? (
          <Notice tone="warning">
            <p role="alert">{copy.reshareDialog.warningPrompt}</p>
            <label className="mt-2 flex items-center gap-2 text-body text-ink">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="h-4 w-4 rounded border-control"
              />
              {copy.reshareDialog.acknowledge}
            </label>
          </Notice>
        ) : null}

        {error ? <ErrorState message={error} compact /> : null}

        <div className="rounded-card border border-border p-3">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-small text-muted">
            <span className="font-medium text-ink">{post.author.displayName}</span>
            <span>@{post.author.username}</span>
            <PostLabelBadge label={post.label} underAppeal={post.underAppeal} />
          </div>
          <p className="line-clamp-3 text-body text-ink">{post.body}</p>
        </div>

        <Textarea
          label={copy.reshareDialog.commentLabel}
          placeholder={copy.reshareDialog.commentPlaceholder}
          rows={3}
          maxLength={500}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          trailing={<CharCount value={comment.length} max={500} />}
        />

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {copy.common.cancel}
          </Button>
          <Button
            type="submit"
            variant="primary"
            isLoading={busy}
            disabled={!canSubmit}
            icon={<Repeat2 />}
          >
            {busy ? copy.reshareDialog.sharing : copy.reshareDialog.confirmShare}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
