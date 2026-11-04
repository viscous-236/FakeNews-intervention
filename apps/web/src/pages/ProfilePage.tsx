import React, { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Ban, Mail, UserMinus, UserPlus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  flatten,
  useBlock,
  useConnections,
  useFollow,
  useProfile,
  useUserPosts,
} from '../api/hooks';
import { copy } from '../copy';
import { errorMessage } from '../api/client';
import { formatMonthYear } from '../lib/format';
import type { UserSummary } from '../types';
import { PostCard } from '../components/posts/PostCard';
import { PostBody } from '../components/posts/PostBody';
import { Avatar } from '../components/ui/Avatar';
import { TierBadge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/Modal';
import { Notice, EmptyState, ErrorState, LoadMore, LoadingRows } from '../components/ui/Page';
import { LinkTabs } from '../components/ui/Tabs';

type ProfileTab = 'posts' | 'followers' | 'following';

export function ProfilePage(): React.ReactElement {
  const { username = '' } = useParams<{ username: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { me } = useAuth();
  const profile = useProfile(username);
  const follow = useFollow();
  const block = useBlock();
  const [confirmBlock, setConfirmBlock] = useState(false);

  const tab: ProfileTab = location.pathname.endsWith('/followers')
    ? 'followers'
    : location.pathname.endsWith('/following')
      ? 'following'
      : 'posts';
  const isSelf = me?.username.toLowerCase() === username.toLowerCase();

  if (profile.isLoading) return <LoadingRows rows={2} />;
  if (profile.isError || !profile.data) {
    return (
      <ErrorState
        message={errorMessage(profile.error, copy.profile.notFound)}
        onRetry={() => void profile.refetch()}
      />
    );
  }
  const p = profile.data;

  return (
    <div className="mx-auto max-w-3xl">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <Avatar
          avatarUrl={p.avatarUrl}
          displayName={p.displayName}
          username={p.username}
          size="xl"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-title text-ink">{p.displayName}</h1>
            <TierBadge tier={p.tier} />
          </div>
          <p className="text-body text-muted">@{p.username}</p>
          {p.bio ? <PostBody text={p.bio} className="mt-2 text-body" /> : null}
          <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-body text-muted">
            <div>
              <dt className="sr-only">{copy.profile.joined('')}</dt>
              <dd>{copy.profile.joined(formatMonthYear(p.createdAt))}</dd>
            </div>
            {p.q !== undefined ? (
              <div className="flex gap-1">
                <dt>{copy.profile.scoreLabel}</dt>
                <dd className="num font-medium text-ink">{p.q}</dd>
              </div>
            ) : null}
          </dl>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {isSelf ? (
            <Link to="/settings">
              <Button variant="secondary">{copy.profile.editProfile}</Button>
            </Link>
          ) : me ? (
            <>
              {!p.viewer.blocked ? (
                <Button
                  variant={p.viewer.following ? 'secondary' : 'primary'}
                  icon={p.viewer.following ? <UserMinus /> : <UserPlus />}
                  isLoading={follow.isPending}
                  onClick={() =>
                    follow.mutate({ username: p.username, follow: !p.viewer.following })
                  }
                >
                  {p.viewer.following ? copy.profile.unfollow : copy.profile.follow}
                </Button>
              ) : null}
              {!p.viewer.blocked ? (
                <Button
                  variant="secondary"
                  icon={<Mail />}
                  onClick={() => navigate(`/messages/${p.username}`)}
                >
                  {copy.profile.message}
                </Button>
              ) : null}
              <Button
                variant={p.viewer.blocked ? 'secondary' : 'ghost'}
                icon={<Ban />}
                onClick={() => setConfirmBlock(true)}
              >
                {p.viewer.blocked ? copy.profile.unblock : copy.profile.block}
              </Button>
            </>
          ) : (
            <Link to="/login">
              <Button variant="primary" icon={<UserPlus />}>
                {copy.profile.follow}
              </Button>
            </Link>
          )}
        </div>
      </header>

      {p.viewer.blocked ? (
        <div className="mt-4">
          <Notice tone="neutral">{copy.profile.blockedNotice}</Notice>
        </div>
      ) : null}

      <div className="mt-6">
        <LinkTabs
          label={copy.app.nav.profile}
          items={[
            { to: `/u/${p.username}`, label: copy.profile.posts, end: true, count: p.counts.posts },
            {
              to: `/u/${p.username}/followers`,
              label: copy.profile.followers,
              count: p.counts.followers,
            },
            {
              to: `/u/${p.username}/following`,
              label: copy.profile.following,
              count: p.counts.following,
            },
          ]}
        />
      </div>

      {tab === 'posts' ? (
        <PostsTab username={p.username} />
      ) : (
        <PeopleTab username={p.username} dir={tab} />
      )}

      <ConfirmDialog
        isOpen={confirmBlock}
        onClose={() => setConfirmBlock(false)}
        title={
          p.viewer.blocked
            ? copy.profile.unblockTitle(p.username)
            : copy.profile.blockTitle(p.username)
        }
        body={p.viewer.blocked ? copy.profile.unblockBody : copy.profile.blockBody}
        confirmLabel={p.viewer.blocked ? copy.profile.unblock : copy.profile.block}
        danger={!p.viewer.blocked}
        isLoading={block.isPending}
        onConfirm={() =>
          block.mutate(
            { username: p.username, block: !p.viewer.blocked },
            { onSuccess: () => setConfirmBlock(false) },
          )
        }
      />
    </div>
  );
}

function PostsTab({ username }: { username: string }): React.ReactElement {
  const posts = useUserPosts(username);
  const items = flatten(posts.data);
  if (posts.isLoading) return <LoadingRows rows={3} />;
  if (posts.isError)
    return (
      <div className="pt-4">
        <ErrorState
          message={errorMessage(posts.error, copy.common.error)}
          onRetry={() => void posts.refetch()}
        />
      </div>
    );
  if (items.length === 0)
    return (
      <div className="pt-4">
        <EmptyState>{copy.profile.noPosts}</EmptyState>
      </div>
    );
  return (
    <>
      <div className="divide-y divide-rule">
        {items.map((post) => (
          <PostCard key={post.id} post={post} />
        ))}
      </div>
      <LoadMore
        hasMore={Boolean(posts.hasNextPage)}
        isLoading={posts.isFetchingNextPage}
        onLoad={() => void posts.fetchNextPage()}
        total={items.length}
      />
    </>
  );
}

function PeopleTab({
  username,
  dir,
}: {
  username: string;
  dir: 'followers' | 'following';
}): React.ReactElement {
  const people = useConnections(username, dir);
  const items = flatten(people.data);
  if (people.isLoading) return <LoadingRows rows={3} />;
  if (people.isError)
    return (
      <div className="pt-4">
        <ErrorState
          message={errorMessage(people.error, copy.common.error)}
          onRetry={() => void people.refetch()}
        />
      </div>
    );
  if (items.length === 0) {
    return (
      <div className="pt-4">
        <EmptyState>
          {dir === 'followers' ? copy.profile.noFollowers : copy.profile.noFollowing}
        </EmptyState>
      </div>
    );
  }
  return (
    <>
      <UserList users={items} />
      <LoadMore
        hasMore={Boolean(people.hasNextPage)}
        isLoading={people.isFetchingNextPage}
        onLoad={() => void people.fetchNextPage()}
        total={items.length}
      />
    </>
  );
}

export function UserList({ users }: { users: UserSummary[] }): React.ReactElement {
  return (
    <ul className="divide-y divide-rule">
      {users.map((u) => (
        <li key={u.id}>
          <Link
            to={`/u/${u.username}`}
            className="flex items-center gap-3 py-3 hover:bg-raised/60 -mx-2 px-2 rounded-control"
          >
            <Avatar avatarUrl={u.avatarUrl} displayName={u.displayName} username={u.username} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-body font-medium text-ink">{u.displayName}</p>
              <p className="truncate text-small text-muted">@{u.username}</p>
            </div>
            <TierBadge tier={u.tier} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
