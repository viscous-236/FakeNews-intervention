import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ExternalLink,
  Flag,
  Heart,
  MessageCircle,
  Pencil,
  Repeat2,
  Trash2,
  Undo2,
} from 'lucide-react';
import type { Post } from '../../types';
import { copy } from '../../copy';
import { useAuth } from '../../context/AuthContext';
import { useDeletePost, useRetractReshare, useToggleLike } from '../../api/hooks';
import { formatRelative, pluralize } from '../../lib/format';
import { Avatar } from '../ui/Avatar';
import { PostLabelBadge, TierBadge } from '../ui/Badge';
import { Menu } from '../ui/Menu';
import { ConfirmDialog } from '../ui/Modal';
import { PostBody } from './PostBody';
import { ReshareDialog } from './ReshareDialog';
import { ReportDialog } from './ReportDialog';
import { EditPostDialog } from './EditPostDialog';

interface PostCardProps {
  post: Post;
  /** On the detail page the comments control is static. */
  detail?: boolean;
  editWindowMinutes?: number;
}

function detectionText(post: Post): string | null {
  const d = post.authorView?.detection;
  if (!d) return null;
  if (d.status === 'queued' || d.status === 'running') return copy.detectionStatus.pending;
  if (d.status === 'ok') {
    if (d.band === 'likely_real') return copy.detectionStatus.likely_real;
    if (d.band === 'uncertain') return copy.detectionStatus.uncertain;
    if (d.band === 'likely_fake') return copy.detectionStatus.likely_fake;
    return null;
  }
  return copy.detectionStatus.failed;
}

function ActionButton({
  label,
  count,
  icon,
  active = false,
  activeClass = 'text-ink',
  onClick,
  disabled,
  as = 'button',
  to,
}: {
  label: string;
  count?: number;
  icon: React.ReactNode;
  active?: boolean;
  activeClass?: string;
  onClick?: (e: React.MouseEvent) => void;
  disabled?: boolean;
  as?: 'button' | 'link';
  to?: string;
}): React.ReactElement {
  const cls = `inline-flex h-8 min-w-[44px] items-center gap-1.5 rounded-control px-2 text-small transition-colors disabled:opacity-50 [&>svg]:h-4 [&>svg]:w-4 ${
    active ? `${activeClass} font-medium` : 'text-muted hover:bg-raised hover:text-ink'
  }`;
  const body = (
    <>
      {icon}
      {count !== undefined ? <span className="num">{count}</span> : null}
    </>
  );
  // The visible count must be part of the accessible name (WCAG 2.5.3).
  const name = count !== undefined ? `${label}, ${count}` : label;
  if (as === 'link' && to) {
    return (
      <Link to={to} className={cls} aria-label={name} title={label}>
        {body}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={cls}
      aria-label={name}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
    >
      {body}
    </button>
  );
}

export function PostCard({
  post,
  detail = false,
  editWindowMinutes = 15,
}: PostCardProps): React.ReactElement {
  const { me, canAct } = useAuth();
  const navigate = useNavigate();
  const toggleLike = useToggleLike();
  const retract = useRetractReshare();
  const deletePost = useDeletePost();

  const [showReshare, setShowReshare] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  // For a reshare row the interactions target the original post.
  const target = post.kind === 'reshare' && post.reshareOf ? post.reshareOf : post;
  const isAuthor = me?.id === post.author.id;
  const isTargetAuthor = me?.id === target.author.id;
  const elapsedMinutes = Math.floor((Date.now() - new Date(post.createdAt).getTime()) / 60_000);
  const editMinutesLeft = Math.max(0, editWindowMinutes - elapsedMinutes);
  const canEdit = isAuthor && post.kind === 'original' && editMinutesLeft > 0;
  const detection = isAuthor ? detectionText(post) : null;

  const requireAuth = (fn: () => void) => () => {
    if (!me) {
      navigate('/login');
      return;
    }
    fn();
  };

  const menuItems = me
    ? [
        ...(canEdit
          ? [
              {
                label: `${copy.post.edit} · ${copy.post.editWindow(editMinutesLeft)}`,
                icon: <Pencil />,
                onSelect: () => setShowEdit(true),
              },
            ]
          : []),
        ...(isAuthor
          ? [
              {
                label: copy.post.delete,
                icon: <Trash2 />,
                danger: true,
                onSelect: () => setShowDelete(true),
              },
            ]
          : []),
        ...(!isTargetAuthor
          ? [
              {
                label: copy.post.report,
                icon: <Flag />,
                onSelect: () => setShowReport(true),
                disabled: !canAct,
              },
            ]
          : []),
      ]
    : [];

  return (
    <article className="py-4" aria-labelledby={`post-${post.id}-author`}>
      {post.kind === 'reshare' ? (
        <p className="mb-2 flex items-center gap-1.5 pl-[52px] text-small text-muted">
          <Repeat2 className="h-3.5 w-3.5" aria-hidden="true" />
          <Link to={`/u/${post.author.username}`} className="hover:text-ink hover:underline">
            {copy.post.resharedBy(post.author.displayName)}
          </Link>
          <span aria-hidden="true">·</span>
          <time dateTime={post.createdAt}>{formatRelative(post.createdAt)}</time>
        </p>
      ) : null}

      <div className="flex gap-3">
        <Link
          to={`/u/${target.author.username}`}
          className="shrink-0 rounded-full"
          tabIndex={-1}
          aria-hidden="true"
        >
          <Avatar
            avatarUrl={target.author.avatarUrl}
            displayName={target.author.displayName}
            username={target.author.username}
          />
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <Link
                to={`/u/${target.author.username}`}
                id={`post-${post.id}-author`}
                className="truncate text-body font-semibold text-ink hover:underline"
              >
                {target.author.displayName}
              </Link>
              <span className="truncate text-small text-muted">@{target.author.username}</span>
              <TierBadge tier={target.author.tier} />
              {post.kind !== 'reshare' ? (
                <>
                  <span className="text-small text-muted" aria-hidden="true">
                    ·
                  </span>
                  <Link
                    to={`/p/${post.id}`}
                    className="text-small text-muted hover:text-ink hover:underline"
                  >
                    <time dateTime={post.createdAt}>{formatRelative(post.createdAt)}</time>
                  </Link>
                </>
              ) : null}
              {target.editedAt ? (
                <span className="text-small text-muted">({copy.post.edited})</span>
              ) : null}
            </div>
            {menuItems.length ? <Menu label={copy.post.options} items={menuItems} /> : null}
          </div>

          {target.label !== 'none' || target.underAppeal ? (
            <div className="mt-1.5">
              <PostLabelBadge label={target.label} underAppeal={target.underAppeal} />
            </div>
          ) : null}

          {post.kind === 'reshare' && post.body ? (
            <PostBody text={post.body} className="mt-2 text-body" />
          ) : null}

          {post.kind === 'reshare' ? (
            <div className="mt-2 rounded-card border border-border p-3">
              <PostBody text={target.body} className="text-body" />
              {target.sourceUrl ? <SourceLink url={target.sourceUrl} /> : null}
              <PostImages post={target} />
            </div>
          ) : (
            <>
              <PostBody text={post.body} className="mt-1.5" />
              {post.sourceUrl ? <SourceLink url={post.sourceUrl} /> : null}
              <PostImages post={post} />
            </>
          )}

          {post.status === 'held' ? (
            <p className="mt-2 text-small text-warning-ink">{copy.post.heldNotice}</p>
          ) : null}

          {detection ? (
            <p className="mt-2 text-small text-muted" role="note">
              {detection}
            </p>
          ) : null}

          <div className="-ml-2 mt-2 flex items-center gap-1">
            <ActionButton
              label={target.viewer.liked ? copy.post.unlike : copy.post.like}
              count={target.counts.likes}
              icon={<Heart className={target.viewer.liked ? 'fill-current' : ''} />}
              active={target.viewer.liked}
              activeClass="text-negative"
              disabled={Boolean(me) && !canAct}
              onClick={requireAuth(() => toggleLike.mutate({ post: target }))}
            />
            {target.viewer.reshared ? (
              <ActionButton
                label={copy.post.retractShare}
                count={target.counts.reshares}
                icon={<Undo2 />}
                active
                activeClass="text-positive"
                disabled={retract.isPending}
                onClick={() => retract.mutate({ post: target })}
              />
            ) : (
              <ActionButton
                label={copy.post.share}
                count={target.counts.reshares}
                icon={<Repeat2 />}
                disabled={(Boolean(me) && !canAct) || isTargetAuthor}
                onClick={requireAuth(() => setShowReshare(true))}
              />
            )}
            {detail ? (
              <span className="inline-flex h-8 items-center gap-1.5 px-2 text-small text-muted [&>svg]:h-4 [&>svg]:w-4">
                <MessageCircle />
                <span className="num">{target.counts.comments}</span>
              </span>
            ) : (
              <ActionButton
                as="link"
                to={`/p/${target.id}`}
                label={pluralize(target.counts.comments, 'comment')}
                count={target.counts.comments}
                icon={<MessageCircle />}
              />
            )}
          </div>
        </div>
      </div>

      <ReshareDialog post={target} isOpen={showReshare} onClose={() => setShowReshare(false)} />
      <ReportDialog postId={target.id} isOpen={showReport} onClose={() => setShowReport(false)} />
      {canEdit ? (
        <EditPostDialog post={post} isOpen={showEdit} onClose={() => setShowEdit(false)} />
      ) : null}
      <ConfirmDialog
        isOpen={showDelete}
        onClose={() => setShowDelete(false)}
        title={copy.post.deleteTitle}
        body={post.kind === 'reshare' ? copy.post.deleteReshareBody : copy.post.deleteBody}
        confirmLabel={copy.post.delete}
        danger
        isLoading={deletePost.isPending}
        onConfirm={() =>
          deletePost.mutate(post.id, {
            onSuccess: () => {
              setShowDelete(false);
              if (detail) navigate('/');
            },
          })
        }
      />
    </article>
  );
}

function SourceLink({ url }: { url: string }): React.ReactElement {
  let host = url;
  try {
    host = new URL(url).host.replace(/^www\./, '');
  } catch {
    // keep the raw url
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      onClick={(e) => e.stopPropagation()}
      className="mt-2 inline-flex max-w-full items-center gap-1.5 text-small text-accent hover:underline"
    >
      <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">
        {copy.post.source}: {host}
      </span>
    </a>
  );
}

function PostImages({ post }: { post: Post }): React.ReactElement | null {
  if (!post.images.length) return null;
  const cols = post.images.length === 1 ? 'grid-cols-1' : 'grid-cols-2';
  return (
    <div className={`mt-3 grid gap-1 overflow-hidden rounded-card ${cols}`}>
      {post.images.map((img, i) => (
        <img
          key={img.id}
          src={img.url}
          alt={copy.post.imageAlt(i + 1)}
          width={img.width}
          height={img.height}
          loading="lazy"
          className={`w-full bg-raised object-cover ${post.images.length === 1 ? 'max-h-[480px]' : 'aspect-[4/3]'}`}
        />
      ))}
    </div>
  );
}
