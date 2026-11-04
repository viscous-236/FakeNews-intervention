import React, { useRef, useState } from 'react';
import { Image as ImageIcon, Link2, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { copy } from '../../copy';
import { errorMessage } from '../../api/client';
import { useCreatePost, useUploadMedia } from '../../api/hooks';
import { isValidHttpUrl } from '../../lib/format';
import type { Post } from '../../types';
import { Avatar } from '../ui/Avatar';
import { Button, IconButton } from '../ui/Button';
import { ErrorState, Notice } from '../ui/Page';

interface ComposerProps {
  onPostCreated?: (post: Post) => void;
  placeholder?: string;
}

const MAX_IMAGES = 4;
const ACCEPT = 'image/jpeg,image/png,image/webp';

/** Composer (TASK-080). The post is created by POST /posts; images go through POST /media first. */
export function Composer({
  onPostCreated,
  placeholder = copy.composer.placeholder,
}: ComposerProps): React.ReactElement | null {
  const { me, canAct } = useAuth();
  const [body, setBody] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [showSource, setShowSource] = useState(false);
  const [images, setImages] = useState<Array<{ id: string; url: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const createPost = useCreatePost();
  const upload = useUploadMedia();

  if (!me) return null;

  const length = body.trim().length;
  const validLength = length >= 20 && length <= 500;
  const urlValue = sourceUrl.trim();
  const urlOk = !urlValue || isValidHttpUrl(urlValue);
  const canSubmit = canAct && validLength && urlOk && !createPost.isPending && !upload.isPending;

  async function pickImages(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (fileInput.current) fileInput.current.value = '';
    if (!files.length) return;
    if (images.length + files.length > MAX_IMAGES) {
      setError(copy.composer.tooManyImages);
      return;
    }
    setError(null);
    for (const file of files) {
      try {
        const res = await upload.mutateAsync({ file, kind: 'post_image' });
        setImages((prev) => [...prev, { id: res.id, url: res.url }]);
      } catch (err) {
        setError(errorMessage(err, copy.common.error));
        break;
      }
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    createPost.mutate(
      {
        body: body.trim(),
        ...(urlValue ? { sourceUrl: urlValue } : {}),
        ...(images.length ? { mediaIds: images.map((i) => i.id) } : {}),
      },
      {
        onSuccess: (post) => {
          setBody('');
          setSourceUrl('');
          setShowSource(false);
          setImages([]);
          onPostCreated?.(post);
        },
        onError: (err) => setError(errorMessage(err, copy.common.error)),
      },
    );
  }

  return (
    <form
      onSubmit={submit}
      className="border-b border-border pb-4"
      aria-label={copy.composer.publish}
    >
      {me.score.tier === 'low' ? (
        <div className="mb-3">
          <Notice tone="warning">{copy.composer.lowTierWarning}</Notice>
        </div>
      ) : null}
      {error ? (
        <div className="mb-3">
          <ErrorState message={error} compact />
        </div>
      ) : null}

      <div className="flex gap-3">
        <Avatar
          avatarUrl={me.avatarUrl}
          displayName={me.displayName}
          username={me.username}
          className="mt-1"
        />
        <div className="min-w-0 flex-1">
          <label htmlFor="composer-body" className="sr-only">
            {copy.composer.bodyLabel}
          </label>
          <textarea
            id="composer-body"
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={placeholder}
            maxLength={500}
            disabled={!canAct}
            className="block w-full resize-y border-0 bg-transparent p-0 py-1.5 text-prose text-ink placeholder:text-faint focus:outline-none disabled:text-muted"
          />

          {showSource ? (
            <div className="mt-2">
              <label htmlFor="composer-source" className="sr-only">
                {copy.composer.sourceUrlLabel}
              </label>
              <input
                id="composer-source"
                type="url"
                inputMode="url"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder={copy.composer.sourceUrlPlaceholder}
                aria-invalid={!urlOk || undefined}
                className={`h-9 w-full rounded-control border bg-surface px-3 text-body placeholder:text-faint ${urlOk ? 'border-control' : 'border-negative'}`}
              />
              {!urlOk ? (
                <p className="mt-1 text-small text-negative">{copy.composer.sourceUrlInvalid}</p>
              ) : null}
            </div>
          ) : null}

          {images.length ? (
            <ul className="mt-3 grid grid-cols-4 gap-2">
              {images.map((img, i) => (
                <li
                  key={img.id}
                  className="relative aspect-square overflow-hidden rounded-card bg-raised"
                >
                  <img
                    src={img.url}
                    alt={copy.post.imageAlt(i + 1)}
                    className="h-full w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setImages((prev) => prev.filter((p) => p.id !== img.id))}
                    aria-label={copy.composer.removeImage}
                    className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-ink/70 text-white hover:bg-ink"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-1">
              <input
                ref={fileInput}
                type="file"
                accept={ACCEPT}
                multiple
                className="hidden"
                onChange={(e) => void pickImages(e)}
              />
              <IconButton
                label={copy.composer.attachImage}
                onClick={() => fileInput.current?.click()}
                disabled={!canAct || images.length >= MAX_IMAGES || upload.isPending}
              >
                <ImageIcon />
              </IconButton>
              <IconButton
                label={copy.composer.toggleSource}
                active={showSource}
                onClick={() => setShowSource((v) => !v)}
                disabled={!canAct}
              >
                <Link2 />
              </IconButton>
              {upload.isPending ? (
                <span className="text-small text-muted">{copy.composer.uploading}</span>
              ) : null}
            </div>
            <div className="flex items-center gap-3">
              <span
                className={`num text-small ${length > 500 ? 'text-negative' : 'text-muted'}`}
                aria-live="polite"
              >
                {copy.common.characters(length, 500)}
              </span>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={!canSubmit}
                isLoading={createPost.isPending}
              >
                {createPost.isPending ? copy.composer.publishing : copy.composer.publish}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}
