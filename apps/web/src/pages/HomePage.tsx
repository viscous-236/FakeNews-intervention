import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { flatten, useFeed, useFollow, useSuggestions } from '../api/hooks';
import { copy } from '../copy';
import { errorMessage } from '../api/client';
import { Composer } from '../components/posts/Composer';
import { PostCard } from '../components/posts/PostCard';
import { Avatar } from '../components/ui/Avatar';
import { TierBadge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Tabs } from '../components/ui/Tabs';
import { EmptyState, ErrorState, LoadMore, LoadingRows, SectionTitle } from '../components/ui/Page';

type FeedTab = 'global' | 'following';

export function HomePage(): React.ReactElement {
  const { me, isAuthenticated } = useAuth();
  const [tab, setTab] = useState<FeedTab>('global');
  const feed = useFeed(tab, tab === 'global' || isAuthenticated);
  const posts = flatten(feed.data);
  const sentinel = useRef<HTMLDivElement>(null);

  // Infinite scroll with a button fallback.
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !feed.hasNextPage) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !feed.isFetchingNextPage) void feed.fetchNextPage();
    });
    io.observe(node);
    return () => io.disconnect();
  }, [feed.hasNextPage, feed.isFetchingNextPage, feed.fetchNextPage, feed]);

  return (
    <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_384px]">
      <section aria-labelledby="feed-title">
        <h1 id="feed-title" className="sr-only">
          {copy.feed.title}
        </h1>
        <Tabs<FeedTab>
          label={copy.feed.title}
          value={tab}
          onChange={setTab}
          items={[
            { value: 'global', label: copy.feed.globalTab },
            ...(isAuthenticated
              ? [{ value: 'following' as const, label: copy.feed.followingTab }]
              : []),
          ]}
        />

        {me ? (
          <div className="pt-4">
            <Composer />
          </div>
        ) : null}

        {feed.isLoading ? (
          <LoadingRows rows={4} />
        ) : feed.isError ? (
          <div className="pt-4">
            <ErrorState
              message={errorMessage(feed.error, copy.common.error)}
              onRetry={() => void feed.refetch()}
            />
          </div>
        ) : posts.length === 0 ? (
          <div className="pt-4">
            <EmptyState
              action={
                tab === 'following' ? (
                  <Button variant="secondary" onClick={() => setTab('global')}>
                    {copy.feed.globalTab}
                  </Button>
                ) : undefined
              }
            >
              {tab === 'global' ? copy.feed.noGlobalPosts : copy.feed.noFollowingPosts}
            </EmptyState>
          </div>
        ) : (
          <>
            <div className="divide-y divide-rule">
              {posts.map((post) => (
                <PostCard key={post.id} post={post} />
              ))}
            </div>
            <div ref={sentinel} aria-hidden="true" />
            <LoadMore
              hasMore={Boolean(feed.hasNextPage)}
              isLoading={feed.isFetchingNextPage}
              onLoad={() => void feed.fetchNextPage()}
              total={posts.length}
            />
          </>
        )}
      </section>

      <aside className="hidden xl:block" aria-label={copy.feed.whoToFollow}>
        <div className="sticky top-16 space-y-8">
          {isAuthenticated ? <WhoToFollow /> : null}
          <section>
            <SectionTitle>{copy.feed.howScoringWorks}</SectionTitle>
            <p className="text-body text-muted">{copy.feed.scoringBlurb}</p>
            <p className="mt-2 font-mono text-body text-ink">{copy.score.formula}</p>
            <Link
              to="/legal/guidelines"
              className="mt-2 inline-block text-body text-accent hover:underline"
            >
              {copy.feed.readGuidelines}
            </Link>
          </section>
        </div>
      </aside>
    </div>
  );
}

function WhoToFollow(): React.ReactElement | null {
  const suggestions = useSuggestions(true);
  const follow = useFollow();
  const [followed, setFollowed] = useState<Record<string, boolean>>({});
  const items = suggestions.data?.items.slice(0, 5) ?? [];
  if (suggestions.isLoading || items.length === 0) return null;

  return (
    <section>
      <SectionTitle>{copy.feed.whoToFollow}</SectionTitle>
      <ul className="divide-y divide-rule">
        {items.map((user) => (
          <li key={user.id} className="flex items-center gap-3 py-3">
            <Link to={`/u/${user.username}`} className="rounded-full">
              <Avatar
                avatarUrl={user.avatarUrl}
                displayName={user.displayName}
                username={user.username}
                size="sm"
              />
            </Link>
            <div className="min-w-0 flex-1">
              <Link
                to={`/u/${user.username}`}
                className="block truncate text-body font-medium text-ink hover:underline"
              >
                {user.displayName}
              </Link>
              <div className="flex items-center gap-2">
                <span className="truncate text-small text-muted">@{user.username}</span>
                <TierBadge tier={user.tier} />
              </div>
            </div>
            <Button
              size="sm"
              variant={followed[user.id] ? 'ghost' : 'secondary'}
              disabled={followed[user.id]}
              onClick={() =>
                follow.mutate(
                  { username: user.username, follow: true },
                  { onSuccess: () => setFollowed((f) => ({ ...f, [user.id]: true })) },
                )
              }
            >
              {followed[user.id] ? copy.feed.following : copy.feed.follow}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
