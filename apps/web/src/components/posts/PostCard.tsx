import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Post } from '../../types';
import { Avatar } from '../ui/Avatar';
import { TierBadge, PostLabelBadge } from '../ui/Badge';
import { ReshareDialog } from './ReshareDialog';
import { ReportDialog } from './ReportDialog';
import { EditPostDialog } from './EditPostDialog';
import { copy } from '../../copy';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';
import {
  Heart,
  Repeat,
  MessageCircle,
  Flag,
  MoreVertical,
  ExternalLink,
  Edit2,
  Trash2,
  ShieldAlert,
  Undo2,
} from 'lucide-react';

interface PostCardProps {
  post: Post;
  onPostUpdated?: (updated: Post) => void;
  onPostDeleted?: (postId: string) => void;
  showCommentsLink?: boolean;
}

export const PostCard: React.FC<PostCardProps> = ({
  post,
  onPostUpdated,
  onPostDeleted,
  showCommentsLink = true,
}) => {
  const { me } = useAuth();
  const navigate = useNavigate();

  const [currentPost, setCurrentPost] = useState<Post>(post);
  const [showReshareDialog, setShowReshareDialog] = useState(false);
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [isLiking, setIsLiking] = useState(false);
  const [isRetracting, setIsRetracting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const isAuthor = me?.id === currentPost.author.id;

  // Check 15-minute edit window (REQ-021, EDIT_WINDOW_MINUTES = 15)
  const createdAtMs = new Date(currentPost.createdAt).getTime();
  const nowMs = Date.now();
  const elapsedMinutes = Math.floor((nowMs - createdAtMs) / (60 * 1000));
  const editWindowRemaining = Math.max(0, 15 - elapsedMinutes);
  const canEdit = isAuthor && currentPost.kind === 'original' && editWindowRemaining > 0;

  // Author-only detection text logic (Section 1.8)
  const authorDetection = currentPost.authorView?.detection;
  let detectionText: string | null = null;
  if (isAuthor && authorDetection) {
    if (authorDetection.status === 'queued' || authorDetection.status === 'running') {
      detectionText = copy.detectionStatus.pending;
    } else if (authorDetection.status === 'ok') {
      if (authorDetection.band === 'likely_real') {
        detectionText = copy.detectionStatus.likely_real;
      } else if (authorDetection.band === 'uncertain') {
        detectionText = copy.detectionStatus.uncertain;
      } else if (authorDetection.band === 'likely_fake') {
        detectionText = copy.detectionStatus.likely_fake;
      }
    } else if (authorDetection.status === 'failed' || authorDetection.status === 'failed_permanent') {
      detectionText = copy.detectionStatus.failed;
    }
  }

  // Like / Unlike action
  const handleLikeToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!me || isLiking) return;
    try {
      setIsLiking(true);
      if (currentPost.viewer.liked) {
        await api.delete(`/api/v1/posts/${currentPost.id}/like`);
        const updated: Post = {
          ...currentPost,
          viewer: { ...currentPost.viewer, liked: false },
          counts: { ...currentPost.counts, likes: Math.max(0, currentPost.counts.likes - 1) },
        };
        setCurrentPost(updated);
        onPostUpdated?.(updated);
      } else {
        await api.post(`/api/v1/posts/${currentPost.id}/like`);
        const updated: Post = {
          ...currentPost,
          viewer: { ...currentPost.viewer, liked: true },
          counts: { ...currentPost.counts, likes: currentPost.counts.likes + 1 },
        };
        setCurrentPost(updated);
        onPostUpdated?.(updated);
      }
    } catch {
      // ignore
    } finally {
      setIsLiking(false);
    }
  };

  // Retract Reshare (Good-faith window / pre-wave finalization)
  const handleRetractReshare = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!me || isRetracting) return;
    try {
      setIsRetracting(true);
      await api.delete(`/api/v1/posts/${currentPost.id}/reshare`);
      const updated: Post = {
        ...currentPost,
        viewer: { ...currentPost.viewer, reshared: false },
        counts: { ...currentPost.counts, reshares: Math.max(0, currentPost.counts.reshares - 1) },
      };
      setCurrentPost(updated);
      onPostUpdated?.(updated);
    } catch {
      // ignore
    } finally {
      setIsRetracting(false);
    }
  };

  // Reshare Confirm
  const handleConfirmReshare = async (comment?: string) => {
    await api.post<Post | { post: Post }>('/api/v1/posts', {
      kind: 'reshare',
      reshareOfId: currentPost.id,
      body: comment,
    });
    const updated: Post = {
      ...currentPost,
      viewer: { ...currentPost.viewer, reshared: true },
      counts: { ...currentPost.counts, reshares: currentPost.counts.reshares + 1 },
    };
    setCurrentPost(updated);
    onPostUpdated?.(updated);
  };

  // Delete Post
  const handleDeletePost = async () => {
    if (!window.confirm(copy.post.deleteConfirm)) return;
    try {
      setIsDeleting(true);
      await api.delete(`/api/v1/posts/${currentPost.id}`);
      onPostDeleted?.(currentPost.id);
    } catch {
      // ignore
    } finally {
      setIsDeleting(false);
    }
  };

  // Text safe auto-linker (REQ-027: plain text, http and https auto-linked)
  const renderBodyWithLinks = (text: string) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);
    return parts.map((part, idx) => {
      if (part.match(urlRegex)) {
        return (
          <a
            key={idx}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-primary-600 dark:text-primary-400 hover:underline break-all"
          >
            {part}
          </a>
        );
      }
      return <span key={idx}>{part}</span>;
    });
  };

  return (
    <article
      className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-4 shadow-sm transition-colors hover:border-neutral-300 dark:hover:border-neutral-600"
      aria-labelledby={`post-author-${currentPost.id}`}
    >
      {/* Reshare attribution */}
      {currentPost.kind === 'reshare' && (
        <div className="mb-2.5 flex items-center gap-1.5 text-xs font-medium text-neutral-500 dark:text-neutral-400">
          <Repeat className="w-3.5 h-3.5 text-neutral-400" aria-hidden="true" />
          <Link
            to={`/u/${currentPost.author.username}`}
            className="hover:underline focus:outline-none"
          >
            {copy.post.resharedBy(currentPost.author.username)}
          </Link>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to={`/u/${currentPost.author.username}`} tabIndex={-1}>
            <Avatar
              username={currentPost.author.username}
              displayName={currentPost.author.displayName}
              avatarUrl={currentPost.author.avatarUrl}
              size="md"
            />
          </Link>

          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Link
                to={`/u/${currentPost.author.username}`}
                id={`post-author-${currentPost.id}`}
                className="font-semibold text-neutral-900 dark:text-neutral-100 hover:underline text-sm focus:outline-none focus:underline"
              >
                {currentPost.author.displayName}
              </Link>
              <span className="text-xs text-neutral-500 dark:text-neutral-400">
                @{currentPost.author.username}
              </span>
              <TierBadge tier={currentPost.author.tier} />
            </div>

            <div className="flex items-center gap-2 text-xs text-neutral-400 dark:text-neutral-500 mt-0.5">
              <time dateTime={currentPost.createdAt}>
                {new Date(currentPost.createdAt).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </time>
              {currentPost.editedAt && (
                <span className="italic">({copy.post.edited})</span>
              )}
            </div>
          </div>
        </div>

        {/* Labels & Menu */}
        <div className="flex items-center gap-2">
          {currentPost.label !== 'none' && (
            <PostLabelBadge
              label={currentPost.label}
              underAppeal={currentPost.underAppeal}
            />
          )}

          {me && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowMenu(!showMenu)}
                className="p-1.5 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 rounded-lg transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center focus:outline-none"
                aria-label="Post options"
                aria-haspopup="true"
                aria-expanded={showMenu}
              >
                <MoreVertical className="w-4 h-4" aria-hidden="true" />
              </button>

              {showMenu && (
                <div
                  className="absolute right-0 mt-1 w-44 rounded-lg bg-white dark:bg-neutral-800 shadow-lg border border-neutral-200 dark:border-neutral-700 py-1 z-20 text-xs"
                  role="menu"
                >
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowMenu(false);
                        setShowEditDialog(true);
                      }}
                      className="w-full text-left px-3 py-2 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 flex items-center gap-2"
                      role="menuitem"
                    >
                      <Edit2 className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{copy.post.edit} ({editWindowRemaining}m left)</span>
                    </button>
                  )}

                  {isAuthor && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowMenu(false);
                        void handleDeletePost();
                      }}
                      disabled={isDeleting}
                      className="w-full text-left px-3 py-2 text-red-600 dark:text-red-400 hover:bg-neutral-100 dark:hover:bg-neutral-700 flex items-center gap-2"
                      role="menuitem"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{copy.post.delete}</span>
                    </button>
                  )}

                  {!isAuthor && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowMenu(false);
                        setShowReportDialog(true);
                      }}
                      className="w-full text-left px-3 py-2 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 flex items-center gap-2"
                      role="menuitem"
                    >
                      <Flag className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{copy.post.report}</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Author-only Automated Detection Status Notice (Section 1.8) */}
      {detectionText && (
        <div
          role="note"
          className="mt-2.5 rounded-md bg-neutral-100 dark:bg-neutral-750 px-2.5 py-1 text-xs text-neutral-600 dark:text-neutral-400 flex items-center gap-1.5"
        >
          <ShieldAlert className="w-3.5 h-3.5 text-neutral-500 shrink-0" aria-hidden="true" />
          <span>{detectionText}</span>
        </div>
      )}

      {/* Post Body Content */}
      <div className="mt-3 text-sm text-neutral-800 dark:text-neutral-200 leading-relaxed whitespace-pre-line">
        {renderBodyWithLinks(currentPost.body)}
      </div>

      {/* Source URL */}
      {currentPost.sourceUrl && (
        <div className="mt-2">
          <a
            href={currentPost.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline max-w-full truncate"
          >
            <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{currentPost.sourceUrl}</span>
          </a>
        </div>
      )}

      {/* Images Grid */}
      {currentPost.images && currentPost.images.length > 0 && (
        <div
          className={`mt-3 grid gap-2 rounded-lg overflow-hidden ${
            currentPost.images.length === 1
              ? 'grid-cols-1'
              : currentPost.images.length === 2
              ? 'grid-cols-2'
              : 'grid-cols-2 sm:grid-cols-3'
          }`}
        >
          {currentPost.images.map((img) => (
            <div
              key={img.id}
              className="relative aspect-video bg-neutral-100 dark:bg-neutral-900 overflow-hidden rounded-md"
            >
              <img
                src={img.url}
                alt="Post attachment"
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </div>
          ))}
        </div>
      )}

      {/* Embedded Original Post if Reshare */}
      {currentPost.reshareOf && (
        <div className="mt-3 border border-neutral-200 dark:border-neutral-700 rounded-lg p-3 bg-neutral-50 dark:bg-neutral-800/40">
          <div className="flex items-center gap-2 mb-1.5">
            <Avatar
              username={currentPost.reshareOf.author.username}
              displayName={currentPost.reshareOf.author.displayName}
              avatarUrl={currentPost.reshareOf.author.avatarUrl}
              size="sm"
            />
            <span className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">
              {currentPost.reshareOf.author.displayName}
            </span>
            <span className="text-xs text-neutral-500">
              @{currentPost.reshareOf.author.username}
            </span>
            {currentPost.reshareOf.label !== 'none' && (
              <PostLabelBadge
                label={currentPost.reshareOf.label}
                underAppeal={currentPost.reshareOf.underAppeal}
              />
            )}
          </div>
          <p className="text-xs text-neutral-700 dark:text-neutral-300 line-clamp-3">
            {currentPost.reshareOf.body}
          </p>
        </div>
      )}

      {/* Interaction Actions Bar */}
      <div className="mt-4 pt-3 border-t border-neutral-100 dark:border-neutral-700 flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
        <div className="flex items-center gap-4 sm:gap-6">
          {/* Like */}
          <button
            type="button"
            onClick={handleLikeToggle}
            disabled={!me || isLiking}
            className={`flex items-center gap-1.5 py-1.5 px-2 rounded-md transition-colors min-h-[44px] min-w-[44px] focus:outline-none ${
              currentPost.viewer.liked
                ? 'text-red-600 dark:text-red-400'
                : 'hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30'
            }`}
            aria-label={
              currentPost.viewer.liked ? copy.post.unlike : copy.post.like
            }
          >
            <Heart
              className={`w-4 h-4 ${
                currentPost.viewer.liked ? 'fill-current' : ''
              }`}
              aria-hidden="true"
            />
            <span>{currentPost.counts.likes}</span>
          </button>

          {/* Reshare / Retract Reshare */}
          {currentPost.viewer.reshared ? (
            <button
              type="button"
              onClick={handleRetractReshare}
              disabled={isRetracting}
              className="flex items-center gap-1.5 py-1.5 px-2 rounded-md text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/40 hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors min-h-[44px] min-w-[44px] focus:outline-none"
              title={copy.post.retractReshare}
              aria-label={copy.post.retractReshare}
            >
              <Undo2 className="w-4 h-4" aria-hidden="true" />
              <span>{currentPost.counts.reshares}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (me) setShowReshareDialog(true);
                else navigate('/login');
              }}
              className="flex items-center gap-1.5 py-1.5 px-2 rounded-md hover:text-green-600 dark:hover:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/30 transition-colors min-h-[44px] min-w-[44px] focus:outline-none"
              aria-label={copy.post.reshare}
            >
              <Repeat className="w-4 h-4" aria-hidden="true" />
              <span>{currentPost.counts.reshares}</span>
            </button>
          )}

          {/* Comment / Post Detail */}
          {showCommentsLink ? (
            <Link
              to={`/p/${currentPost.id}`}
              className="flex items-center gap-1.5 py-1.5 px-2 rounded-md hover:text-primary-600 dark:hover:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-950/30 transition-colors min-h-[44px] min-w-[44px] focus:outline-none"
              aria-label={copy.post.commentsCount(currentPost.counts.comments)}
            >
              <MessageCircle className="w-4 h-4" aria-hidden="true" />
              <span>{currentPost.counts.comments}</span>
            </Link>
          ) : (
            <div className="flex items-center gap-1.5 py-1.5 px-2 text-neutral-400">
              <MessageCircle className="w-4 h-4" aria-hidden="true" />
              <span>{currentPost.counts.comments}</span>
            </div>
          )}
        </div>

        {/* Report / Flag button on bottom right */}
        {!isAuthor && me && (
          <button
            type="button"
            onClick={() => setShowReportDialog(true)}
            className="flex items-center gap-1 py-1 px-2 rounded-md hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors min-h-[44px] focus:outline-none"
            aria-label={copy.post.report}
          >
            <Flag className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">{copy.post.report}</span>
          </button>
        )}
      </div>

      {/* Dialogs */}
      <ReshareDialog
        post={currentPost}
        isOpen={showReshareDialog}
        onClose={() => setShowReshareDialog(false)}
        onConfirm={handleConfirmReshare}
      />

      <ReportDialog
        postId={currentPost.id}
        isOpen={showReportDialog}
        onClose={() => setShowReportDialog(false)}
      />

      {canEdit && (
        <EditPostDialog
          post={currentPost}
          isOpen={showEditDialog}
          onClose={() => setShowEditDialog(false)}
          onSuccess={(updated) => {
            setCurrentPost(updated);
            onPostUpdated?.(updated);
          }}
        />
      )}
    </article>
  );
};
