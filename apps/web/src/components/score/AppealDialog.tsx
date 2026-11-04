import React, { useState } from 'react';
import type { EventItem } from '../../types';
import { copy } from '../../copy';
import { errorMessage } from '../../api/client';
import { useOpenAppeal } from '../../api/hooks';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { CharCount, Textarea } from '../ui/Field';
import { ErrorState } from '../ui/Page';

export function AppealDialog({
  event,
  onClose,
}: {
  event: EventItem | null;
  onClose: () => void;
}): React.ReactElement | null {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const appeal = useOpenAppeal();
  if (!event) return null;

  const trimmed = reason.trim();
  const canSubmit = trimmed.length >= 20 && trimmed.length <= 1000 && !appeal.isPending;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!event || !canSubmit) return;
    setError(null);
    appeal.mutate(
      { eventId: event.id, reason: trimmed },
      {
        onSuccess: () => {
          setReason('');
          onClose();
        },
        onError: (err) => setError(errorMessage(err, copy.common.error)),
      },
    );
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={copy.appealDialog.title}
      description={copy.appealDialog.description}
    >
      <form onSubmit={submit} className="space-y-4">
        {error ? <ErrorState message={error} compact /> : null}
        <div className="rounded-card border border-border p-3 text-body">
          <p className="text-small text-muted">{copy.appealDialog.contested}</p>
          <p className="font-medium text-ink">{copy.eventKind[event.kind]}</p>
          <p className="mt-1 line-clamp-2 text-muted">“{event.post.excerpt}”</p>
        </div>
        <Textarea
          label={copy.appealDialog.reasonLabel}
          placeholder={copy.appealDialog.reasonPlaceholder}
          rows={5}
          maxLength={1000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          trailing={<CharCount value={trimmed.length} max={1000} />}
          required
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={appeal.isPending}>
            {copy.common.cancel}
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={!canSubmit}
            isLoading={appeal.isPending}
          >
            {appeal.isPending ? copy.appealDialog.submitting : copy.appealDialog.submit}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
