import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { PostCard } from '../components/posts/PostCard';
import { Avatar } from '../components/ui/Avatar';
import { TierBadge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { copy } from '../copy';
import { Post, Comment, PaginatedResponse } from '../types';
import { api } from '../api/client';
import { ArrowLeft, MessageSquare, Send, Trash2, Info, Loader2 } from 'lucide-react';

export const PostDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { me } = useAuth();

  const [post, setPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [newCommentBody, setNewCommentBody] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    if (!id) return;

    setIsLoading(true);
    setError(null);

    Promise.all([
      api.get<Post | { post: Post }>(`/api/v1/posts/${id}`),
      api.get<PaginatedResponse<Comment>>(`/api/v1/posts/${id}/comments`),
    ])
      .then(([postRes, commentsRes]) => {
        if (!mounted) return;
        const loadedPost = postRes && 'post' in postRes && postRes.post ? postRes.post : (postRes as Post);
        setPost(loadedPost);
        setComments(commentsRes?.items || []);
      })
      .catch((err: unknown) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : copy.error);
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [id]);

  const handleCreateComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !newCommentBody.trim() || isSubmittingComment) return;

    try {
      setIsSubmittingComment(true);
      const res = await api.post<Comment | { comment: Comment }>(`/api/v1/posts/${id}/comments`, {
        body: newCommentBody.trim(),
      });
      const createdComment = res && 'comment' in res && res.comment ? res.comment : (res as Comment);
      setComments((prev) => [createdComment, ...prev]);
      setNewCommentBody('');
      if (post) {
        setPost({
          ...post,
          counts: { ...post.counts, comments: post.counts.comments + 1 },
        });
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : copy.error);
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!id || !window.confirm(copy.comments.deleteConfirm)) return;
    try {
      await api.delete(`/api/v1/comments/${commentId}`);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
      if (post) {
        setPost({
          ...post,
          counts: { ...post.counts, comments: Math.max(0, post.counts.comments - 1) },
        });
      }
    } catch {
      // ignore
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Top back navigation */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="p-2 text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center focus:outline-none"
          aria-label={copy.back}
        >
          <ArrowLeft className="w-5 h-5" aria-hidden="true" />
        </button>
        <h1 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">
          Post
        </h1>
      </div>

      {isLoading ? (
        <div className="py-16 text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary-600" aria-hidden="true" />
          <p className="mt-3 text-sm text-neutral-500">{copy.loading}</p>
        </div>
      ) : error || !post ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 p-4 text-center text-sm text-red-700 dark:text-red-300"
        >
          {error || copy.empty}
        </div>
      ) : (
        <>
          <PostCard
            post={post}
            showCommentsLink={false}
            onPostUpdated={(updated) => setPost(updated)}
            onPostDeleted={() => navigate('/')}
          />

          {/* Comment Policy Notice (DEC-006) */}
          <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50 p-3 text-xs text-blue-700 dark:text-blue-300 flex items-start gap-2">
            <Info className="w-4 h-4 shrink-0 mt-0.5 text-blue-500" aria-hidden="true" />
            <span>{copy.comments.policyNote}</span>
          </div>

          {/* Comment Composer */}
          {me ? (
            <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-4 shadow-sm">
              <form onSubmit={handleCreateComment}>
                <div className="flex gap-3">
                  <Avatar
                    username={me.username}
                    displayName={me.displayName}
                    avatarUrl={me.avatarUrl}
                    size="sm"
                  />
                  <div className="flex-1">
                    <label htmlFor="comment-textarea" className="sr-only">
                      {copy.comments.placeholder}
                    </label>
                    <textarea
                      id="comment-textarea"
                      rows={2}
                      maxLength={300}
                      value={newCommentBody}
                      onChange={(e) => setNewCommentBody(e.target.value)}
                      placeholder={copy.comments.placeholder}
                      className="w-full resize-none border-0 bg-transparent p-0 text-sm text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:ring-0 focus:outline-none"
                    />
                    <div className="mt-2 pt-2 border-t border-neutral-100 dark:border-neutral-700 flex justify-between items-center">
                      <span className="text-xs text-neutral-400">
                        {copy.composer.charCount(newCommentBody.trim().length, 300)}
                      </span>
                      <Button
                        type="submit"
                        size="sm"
                        variant="primary"
                        disabled={!newCommentBody.trim() || isSubmittingComment}
                        isLoading={isSubmittingComment}
                        icon={<Send className="w-3.5 h-3.5" aria-hidden="true" />}
                      >
                        {copy.comments.submit}
                      </Button>
                    </div>
                  </div>
                </div>
              </form>
            </div>
          ) : (
            <div className="bg-neutral-50 dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-4 text-center">
              <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-2">
                Sign in to participate in the conversation.
              </p>
              <Link to="/login">
                <Button size="sm" variant="outline">
                  {copy.app.nav.login}
                </Button>
              </Link>
            </div>
          )}

          {/* Comments List */}
          <div className="space-y-3">
            <h2 className="text-sm font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-1.5">
              <MessageSquare className="w-4 h-4 text-neutral-500" aria-hidden="true" />
              <span>{copy.comments.title} ({comments.length})</span>
            </h2>

            {comments.length === 0 ? (
              <div className="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 p-6 text-center text-xs text-neutral-500">
                {copy.comments.empty}
              </div>
            ) : (
              comments.map((comment) => (
                <div
                  key={comment.id}
                  className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-3.5 shadow-sm space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Link to={`/u/${comment.author.username}`}>
                        <Avatar
                          username={comment.author.username}
                          displayName={comment.author.displayName}
                          avatarUrl={comment.author.avatarUrl}
                          size="sm"
                        />
                      </Link>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <Link
                            to={`/u/${comment.author.username}`}
                            className="text-xs font-semibold text-neutral-900 dark:text-neutral-100 hover:underline"
                          >
                            {comment.author.displayName}
                          </Link>
                          <span className="text-xs text-neutral-400">
                            @{comment.author.username}
                          </span>
                          <TierBadge tier={comment.author.tier} />
                        </div>
                        <time className="text-[11px] text-neutral-400">
                          {new Date(comment.createdAt).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </time>
                      </div>
                    </div>

                    {me && me.id === comment.author.id && (
                      <button
                        type="button"
                        onClick={() => handleDeleteComment(comment.id)}
                        className="p-1 text-neutral-400 hover:text-red-600 rounded transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center focus:outline-none"
                        aria-label="Delete comment"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>

                  <p className="text-xs text-neutral-800 dark:text-neutral-200 pl-8 whitespace-pre-line leading-relaxed">
                    {comment.body}
                  </p>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
};
