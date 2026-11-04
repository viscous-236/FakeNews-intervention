import React, { useState } from 'react';
import type { Post } from '../../types';
import { copy } from '../../copy';
import { errorMessage } from '../../api/client';
import { useEditPost } from '../../api/hooks';
import { isValidHttpUrl } from '../../lib/format';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { CharCount, Input, Textarea } from '../ui/Field';
import { ErrorState } from '../ui/Page';

export function EditPostDialog({
  post,
  isOpen,
  onClose,
}: {
  post: Post;
  isOpen: boolean;
  onClose: () => void;
}): React.ReactElement | null {
  const [body, setBody] = useState(post.body);
  const [sourceUrl, setSourceUrl] = useState(post.sourceUrl ?? '');
  const [error, setError] = useState<string | null>(null);
  const edit = useEditPost();

  const trimmed = body.trim();
  const bodyError =
    trimmed.length > 0 && trimmed.length < 20 ? copy.composer.tooShort(20 - trimmed.length) : null;
  const urlError =
    sourceUrl.trim() && !isValidHttpUrl(sourceUrl.trim()) ? copy.composer.sourceUrlInvalid : null;
  const canSubmit = trimmed.length >= 20 && trimmed.length <= 500 && !urlError && !edit.isPending;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    edit.mutate(
      { id: post.id, body: trimmed, sourceUrl: sourceUrl.trim() || null },
      {
        onSuccess: onClose,
        onError: (err) => setError(errorMessage(err, copy.common.error)),
      },
    );
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={copy.composer.edit}>
      <form onSubmit={submit} className="space-y-4">
        {error ? <ErrorState message={error} compact /> : null}
        <Textarea
          label={copy.composer.bodyLabel}
          rows={5}
          maxLength={500}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          error={bodyError}
          hint={copy.composer.minChars}
          trailing={<CharCount value={trimmed.length} max={500} />}
        />
        <Input
          label={copy.composer.sourceUrlLabel}
          optional
          type="url"
          inputMode="url"
          placeholder={copy.composer.sourceUrlPlaceholder}
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          error={urlError}
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={edit.isPending}>
            {copy.common.cancel}
          </Button>
          <Button type="submit" variant="primary" isLoading={edit.isPending} disabled={!canSubmit}>
            {edit.isPending ? copy.composer.saving : copy.common.save}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
