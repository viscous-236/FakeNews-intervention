import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { Composer } from '../components/posts/Composer';
import { PostCard } from '../components/posts/PostCard';
import { Avatar } from '../components/ui/Avatar';
import { TierBadge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { copy } from '../copy';
import { Post, UserSummary, PaginatedResponse } from '../types';
import { api } from '../api/client';
import { Globe, Users, Loader2, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';

export const HomePage: React.FC = () => {
  const { me } = useAuth();
  const [activeTab, setActiveTab] = useState<'global' | 'following'>('global');
  const [posts, setPosts] = useState<Post[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Suggestions ("Who to follow")
  const [suggestions, setSuggestions] = useState<UserSummary[]>([]);

  const fetchFeed = useCallback(async (tab: 'global' | 'following', cursor?: string | null) => {
    const endpoint = tab === 'global' ? '/api/v1/feed/global' : '/api/v1/feed/following';
    const params = cursor ? { cursor } : undefined;
    return api.get<PaginatedResponse<Post>>(endpoint, params);
  }, []);

  useEffect(() => {
    let mounted = true;
    setIsLoading(true);
    setError(null);

    fetchFeed(activeTab)
      .then((data) => {
        if (!mounted) return;
        setPosts(data.items);
        setNextCursor(data.nextCursor);
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
  }, [activeTab, fetchFeed]);

  // Load suggestions
  useEffect(() => {
    let mounted = true;
    if (me) {
      api
        .get<{ users: UserSummary[] }>('/api/v1/users/suggestions')
        .then((res) => {
          if (mounted) setSuggestions(res.users);
        })
        .catch(() => {
          // ignore suggestions error
        });
    }
    return () => {
      mounted = false;
    };
  }, [me]);

  const handleLoadMore = async () => {
    if (!nextCursor || isLoadingMore) return;
    try {
      setIsLoadingMore(true);
      const data = await fetchFeed(activeTab, nextCursor);
      setPosts((prev) => [...prev, ...data.items]);
      setNextCursor(data.nextCursor);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : copy.error);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handlePostCreated = (newPost: Post) => {
    setPosts((prev) => [newPost, ...prev]);
  };

  const handlePostUpdated = (updatedPost: Post) => {
    setPosts((prev) => prev.map((p) => (p.id === updatedPost.id ? updatedPost : p)));
  };

  const handlePostDeleted = (postId: string) => {
    setPosts((prev) => prev.filter((p) => p.id !== postId));
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      {/* Main feed column (2 cols on lg) */}
      <div className="lg:col-span-2 space-y-4">
        {/* Feed tabs */}
        <div className="flex border-b border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 rounded-xl p-1 shadow-sm">
          <button
            type="button"
            onClick={() => setActiveTab('global')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-lg transition-colors min-h-[44px] focus:outline-none ${
              activeTab === 'global'
                ? 'bg-neutral-100 dark:bg-neutral-700 text-neutral-900 dark:text-neutral-50 shadow-xs'
                : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'
            }`}
          >
            <Globe className="w-4 h-4" aria-hidden="true" />
            <span>{copy.feed.globalTab}</span>
          </button>

          {me && (
            <button
              type="button"
              onClick={() => setActiveTab('following')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-lg transition-colors min-h-[44px] focus:outline-none ${
                activeTab === 'following'
                  ? 'bg-neutral-100 dark:bg-neutral-700 text-neutral-900 dark:text-neutral-50 shadow-xs'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'
              }`}
            >
              <Users className="w-4 h-4" aria-hidden="true" />
              <span>{copy.feed.followingTab}</span>
            </button>
          )}
        </div>

        {/* Signed-in user composer */}
        {me && <Composer onPostCreated={handlePostCreated} />}

        {/* Feed content */}
        {isLoading ? (
          <div className="py-12 text-center">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary-600 dark:text-primary-400" aria-hidden="true" />
            <p className="mt-3 text-sm text-neutral-500">{copy.loading}</p>
          </div>
        ) : error ? (
          <div
            role="alert"
            className="rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 p-4 text-center text-sm text-red-700 dark:text-red-300"
          >
            {error}
          </div>
        ) : posts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 p-8 text-center bg-white dark:bg-neutral-800">
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              {activeTab === 'global' ? copy.feed.noGlobalPosts : copy.feed.noFollowingPosts}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                onPostUpdated={handlePostUpdated}
                onPostDeleted={handlePostDeleted}
              />
            ))}

            {/* Load more button */}
            {nextCursor ? (
              <div className="pt-2 text-center">
                <Button
                  variant="outline"
                  onClick={handleLoadMore}
                  isLoading={isLoadingMore}
                  className="w-full sm:w-auto"
                >
                  {copy.feed.loadMore}
                </Button>
              </div>
            ) : (
              <p className="pt-4 text-center text-xs text-neutral-400">
                {copy.feed.allCaughtUp}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Right sidebar widget (Who to follow & Trust info) */}
      <aside className="hidden lg:block space-y-6" aria-label="Sidebar">
        {/* Who to follow card */}
        {suggestions.length > 0 && (
          <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-neutral-100 dark:border-neutral-700">
              <Sparkles className="w-4 h-4 text-primary-600 dark:text-primary-400" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                {copy.feed.whoToFollow}
              </h2>
            </div>

            <div className="space-y-3">
              {suggestions.slice(0, 5).map((user) => (
                <div key={user.id} className="flex items-center justify-between gap-2">
                  <Link
                    to={`/u/${user.username}`}
                    className="flex items-center gap-2 min-w-0 hover:opacity-80 transition-opacity"
                  >
                    <Avatar
                      username={user.username}
                      displayName={user.displayName}
                      avatarUrl={user.avatarUrl}
                      size="sm"
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-neutral-900 dark:text-neutral-100 truncate">
                        {user.displayName}
                      </p>
                      <p className="text-xs text-neutral-500 truncate">
                        @{user.username}
                      </p>
                    </div>
                  </Link>

                  <TierBadge tier={user.tier} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Platform scoring guide summary */}
        <div className="bg-neutral-50 dark:bg-neutral-850 rounded-xl border border-neutral-200 dark:border-neutral-700 p-4 text-xs text-neutral-600 dark:text-neutral-400 space-y-2.5">
          <h3 className="font-semibold text-neutral-900 dark:text-neutral-200">
            Algorithmic Accountability
          </h3>
          <p>
            Credibility is updated through periodic <strong>reputation waves</strong>. Independent fact-checkers verify flagged content.
          </p>
          <div className="pt-1">
            <Link
              to="/legal/guidelines"
              className="text-primary-600 dark:text-primary-400 font-medium hover:underline"
            >
              Read Community & Credibility Guidelines →
            </Link>
          </div>
        </div>
      </aside>
    </div>
  );
};
