import React, { useState, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { copy } from '../../copy';
import { Post } from '../../types';
import { api } from '../../api/client';
import { Image as ImageIcon, X, AlertTriangle, Send, Link as LinkIcon, Loader2 } from 'lucide-react';

interface ComposerProps {
  onPostCreated?: (newPost: Post) => void;
  placeholder?: string;
  className?: string;
}

export const Composer: React.FC<ComposerProps> = ({
  onPostCreated,
  placeholder = copy.composer.placeholder,
  className = '',
}) => {
  const { me } = useAuth();
  const [body, setBody] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [showSourceInput, setShowSourceInput] = useState(false);
  const [mediaIds, setMediaIds] = useState<string[]>([]);
  const [imagePreviews, setImagePreviews] = useState<Array<{ id: string; url: string }>>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!me) return null;

  const charLength = body.trim().length;
  const isValidLength = charLength >= 20 && charLength <= 500;
  const isLowTier = me.score?.tier === 'low';

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (imagePreviews.length + files.length > 4) {
      setError('You can attach a maximum of 4 images per post.');
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file) continue;
        const formData = new FormData();
        formData.append('file', file);

        const res = await api.upload<{ id: string; url: string }>('/api/v1/media/upload', formData);
        setImagePreviews((prev) => [...prev, { id: res.id, url: res.url }]);
        setMediaIds((prev) => [...prev, res.id]);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to upload image.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemoveImage = (idToRemove: string) => {
    setImagePreviews((prev) => prev.filter((img) => img.id !== idToRemove));
    setMediaIds((prev) => prev.filter((id) => id !== idToRemove));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidLength || isSubmitting || isUploading) return;

    setError(null);
    setIsSubmitting(true);

    try {
      const res = await api.post<{ post: Post }>('/api/v1/posts', {
        kind: 'original',
        body: body.trim(),
        sourceUrl: sourceUrl.trim() ? sourceUrl.trim() : undefined,
        mediaIds: mediaIds.length > 0 ? mediaIds : undefined,
      });

      setBody('');
      setSourceUrl('');
      setShowSourceInput(false);
      setImagePreviews([]);
      setMediaIds([]);
      onPostCreated?.(res.post);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : copy.error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className={`bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 shadow-sm p-4 ${className}`}
    >
      {isLowTier && (
        <div
          role="alert"
          className="mb-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 p-2.5 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2"
        >
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{copy.composer.lowTierWarning}</span>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mb-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 p-2.5 text-xs text-red-700 dark:text-red-300"
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="flex gap-3">
          <Avatar
            username={me.username}
            displayName={me.displayName}
            avatarUrl={me.avatarUrl}
            size="md"
          />

          <div className="flex-1">
            <label htmlFor="composer-textarea" className="sr-only">
              {placeholder}
            </label>
            <textarea
              id="composer-textarea"
              rows={3}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={placeholder}
              maxLength={500}
              className="w-full resize-none border-0 bg-transparent p-0 text-sm text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-500 focus:ring-0 focus:outline-none"
            />

            {showSourceInput && (
              <div className="mt-2 flex items-center gap-1.5 border-b border-neutral-200 dark:border-neutral-700 pb-2">
                <LinkIcon className="w-3.5 h-3.5 text-neutral-400 shrink-0" aria-hidden="true" />
                <input
                  type="url"
                  placeholder={copy.composer.sourceUrlPlaceholder}
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  className="w-full bg-transparent text-xs text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none"
                />
              </div>
            )}

            {imagePreviews.length > 0 && (
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {imagePreviews.map((img) => (
                  <div key={img.id} className="relative rounded-lg overflow-hidden border border-neutral-200 dark:border-neutral-700 aspect-video bg-neutral-100 dark:bg-neutral-900">
                    <img
                      src={img.url}
                      alt="Uploaded preview"
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveImage(img.id)}
                      className="absolute top-1 right-1 bg-black/70 hover:bg-black text-white p-1 rounded-full transition-colors focus:outline-none"
                      aria-label={copy.composer.removeImage}
                    >
                      <X className="w-3 h-3" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {isUploading && (
              <div className="mt-2 flex items-center gap-2 text-xs text-neutral-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-primary-600" aria-hidden="true" />
                <span>Uploading media…</span>
              </div>
            )}

            <div className="mt-3 pt-2 border-t border-neutral-100 dark:border-neutral-700 flex items-center justify-between">
              <div className="flex items-center gap-1">
                <input
                  type="file"
                  ref={fileInputRef}
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  multiple
                  onChange={handleImageSelect}
                  className="hidden"
                  id="composer-file-input"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={imagePreviews.length >= 4 || isUploading}
                  className="p-2 text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded-lg transition-colors disabled:opacity-50 min-h-[44px] min-w-[44px] flex items-center justify-center"
                  aria-label={copy.composer.attachImage}
                >
                  <ImageIcon className="w-4 h-4" aria-hidden="true" />
                </button>

                <button
                  type="button"
                  onClick={() => setShowSourceInput(!showSourceInput)}
                  className={`p-2 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center ${
                    showSourceInput
                      ? 'text-primary-600 bg-primary-50 dark:bg-primary-950/40 dark:text-primary-400'
                      : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700'
                  }`}
                  aria-label="Toggle source URL input"
                >
                  <LinkIcon className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>

              <div className="flex items-center gap-3">
                <span
                  className={`text-xs ${
                    charLength > 500
                      ? 'text-red-600 font-semibold'
                      : charLength > 0 && charLength < 20
                      ? 'text-amber-600'
                      : 'text-neutral-400 dark:text-neutral-500'
                  }`}
                >
                  {copy.composer.charCount(charLength, 500)}
                </span>

                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={!isValidLength || isSubmitting || isUploading}
                  isLoading={isSubmitting}
                  icon={<Send className="w-3.5 h-3.5" aria-hidden="true" />}
                >
                  {isSubmitting ? copy.composer.publishing : copy.composer.publish}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
};
