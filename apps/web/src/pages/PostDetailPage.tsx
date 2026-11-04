import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { flatten, useComments, useCreateComment, useDeleteComment, usePost } from '../api/hooks';
import { copy } from '../copy';
import { errorMessage } from '../api/client';
import { formatRelative, pluralize } from '../lib/format';
import { PostCard } from '../components/posts/PostCard';
import { PostBody } from '../components/posts/PostBody';
import { Avatar } from '../components/ui/Avatar';
import { TierBadge } from '../components/ui/Badge';
import { Button, IconButton } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/Modal';
import {
  EmptyState,
  ErrorState,
  LoadMore,
  LoadingRows,
  PageHeader,
  SectionTitle,
} from '../components/ui/Page';
import { Trash2 } from 'lucide-react';

export function PostDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const { me, canAct, isAdmin } = useAuth();
  const post = usePost(id);
  const comments = useComments(id);
  const createComment = useCreateComment(id ?? '');
  const deleteComment = useDeleteComment(id ?? '');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const items = flatten(comments.data);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || trimmed.length > 300) return;
    setError(null);
    createComment.mutate(trimmed, {
      onSuccess: () => setBody(''),
      onError: (err) => setError(errorMessage(err, copy.common.error)),
    });
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={copy.post.openPost} backTo="/" backLabel={copy.feed.title} />

      {post.isLoading ? (
        <LoadingRows rows={1} />
      ) : post.isError || !post.data ? (
        <ErrorState
          message={errorMessage(post.error, copy.notFound.body)}
          onRetry={() => void post.refetch()}
        />
      ) : (
        <>
          <div className="border-b border-border">
            <PostCard post={post.data} detail />
          </div>

          <section className="mt-6" aria-labelledby="comments-title">
            <SectionTitle>
              <span id="comments-title">
                {copy.comments.title}{' '}
                <span className="num text-muted">{post.data.counts.comments}</span>
              </span>
            </SectionTitle>
            <p className="mb-4 text-small text-muted">{copy.comments.policyNote}</p>

            {me ? (
              <form onSubmit={submit} className="mb-4 flex gap-3">
                <Avatar
                  avatarUrl={me.avatarUrl}
                  displayName={me.displayName}
                  username={me.username}
                  size="sm"
                  className="mt-1"
                />
                <div className="min-w-0 flex-1">
                  <label htmlFor="comment-body" className="sr-only">
                    {copy.comments.placeholder}
                  </label>
                  <textarea
                    id="comment-body"
                    rows={2}
                    maxLength={300}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder={copy.comments.placeholder}
                    disabled={!canAct}
                    className="block w-full rounded-control border border-control bg-surface px-3 py-2 text-body text-ink placeholder:text-faint disabled:bg-raised"
                  />
                  {error ? <p className="mt-1 text-small text-negative">{error}</p> : null}
                  <div className="mt-2 flex items-center justify-between">
                    <span className="num text-small text-muted">
                      {copy.common.characters(body.trim().length, 300)}
                    </span>
                    <Button
                      type="submit"
                      size="sm"
                      variant="primary"
                      disabled={!canAct || !body.trim()}
                      isLoading={createComment.isPending}
                    >
                      {createComment.isPending ? copy.comments.submitting : copy.comments.submit}
                    </Button>
                  </div>
                </div>
              </form>
            ) : (
              <p className="mb-4 text-body text-muted">
                <Link to="/login" className="text-accent hover:underline">
                  {copy.post.signInToInteract}
                </Link>
              </p>
            )}

            {comments.isLoading ? (
              <LoadingRows rows={2} />
            ) : comments.isError ? (
              <ErrorState
                message={errorMessage(comments.error, copy.common.error)}
                onRetry={() => void comments.refetch()}
              />
            ) : items.length === 0 ? (
              <EmptyState>{copy.comments.empty}</EmptyState>
            ) : (
              <>
                <ul className="divide-y divide-rule">
                  {items.map((c) => (
                    <li key={c.id} className="flex gap-3 py-3">
                      <Link to={`/u/${c.author.username}`} className="shrink-0 rounded-full">
                        <Avatar
                          avatarUrl={c.author.avatarUrl}
                          displayName={c.author.displayName}
                          username={c.author.username}
                          size="sm"
                        />
                      </Link>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-small">
                          <Link
                            to={`/u/${c.author.username}`}
                            className="font-medium text-ink hover:underline"
                          >
                            {c.author.displayName}
                          </Link>
                          <span className="text-muted">@{c.author.username}</span>
                          <TierBadge tier={c.author.tier} />
                          <time dateTime={c.createdAt} className="text-muted">
                            {formatRelative(c.createdAt)}
                          </time>
                        </div>
                        <PostBody text={c.body} className="mt-0.5 text-body" />
                      </div>
                      {me && (me.id === c.author.id || isAdmin) ? (
                        <IconButton
                          label={copy.comments.deleteAria}
                          onClick={() => setDeleting(c.id)}
                        >
                          <Trash2 />
                        </IconButton>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <LoadMore
                  hasMore={Boolean(comments.hasNextPage)}
                  isLoading={comments.isFetchingNextPage}
                  onLoad={() => void comments.fetchNextPage()}
                  total={items.length}
                />
              </>
            )}
          </section>

          <ConfirmDialog
            isOpen={deleting !== null}
            onClose={() => setDeleting(null)}
            title={copy.comments.deleteTitle}
            body={copy.comments.deleteBody}
            confirmLabel={copy.common.delete}
            danger
            isLoading={deleteComment.isPending}
            onConfirm={() =>
              deleting && deleteComment.mutate(deleting, { onSuccess: () => setDeleting(null) })
            }
          />
          <p className="sr-only">{pluralize(items.length, 'comment')}</p>
        </>
      )}
    </div>
  );
}
