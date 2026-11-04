import React, { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { PostCard } from '../components/posts/PostCard';
import { Avatar } from '../components/ui/Avatar';
import { TierBadge } from '../components/ui/Badge';
import { copy } from '../copy';
import { Post, UserSummary, PaginatedResponse } from '../types';
import { api } from '../api/client';
import { Search as SearchIcon, FileText, Users, Loader2 } from 'lucide-react';

export const SearchPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get('q') || '';
  const initialTab = (searchParams.get('tab') as 'posts' | 'users') || 'posts';

  const [query, setQuery] = useState(initialQuery);
  const [activeTab, setActiveTab] = useState<'posts' | 'users'>(initialTab);
  const [posts, setPosts] = useState<Post[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const currentQ = searchParams.get('q') || '';
    if (!currentQ.trim()) {
      setPosts([]);
      setUsers([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    if (activeTab === 'posts') {
      api
        .get<PaginatedResponse<Post>>('/api/v1/search/posts', { q: currentQ })
        .then((res) => {
          if (mounted) setPosts(res.items);
        })
        .catch((err: unknown) => {
          if (mounted) setError(err instanceof Error ? err.message : copy.error);
        })
        .finally(() => {
          if (mounted) setIsLoading(false);
        });
    } else {
      api
        .get<PaginatedResponse<UserSummary>>('/api/v1/search/users', { q: currentQ })
        .then((res) => {
          if (mounted) setUsers(res.items);
        })
        .catch((err: unknown) => {
          if (mounted) setError(err instanceof Error ? err.message : copy.error);
        })
        .finally(() => {
          if (mounted) setIsLoading(false);
        });
    }

    return () => {
      mounted = false;
    };
  }, [searchParams, activeTab]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearchParams({ q: query.trim(), tab: activeTab });
  };

  const handleTabChange = (tab: 'posts' | 'users') => {
    setActiveTab(tab);
    if (query.trim()) {
      setSearchParams({ q: query.trim(), tab });
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Search Header Form */}
      <form onSubmit={handleSearchSubmit} className="relative">
        <label htmlFor="search-input" className="sr-only">
          {copy.app.nav.search}
        </label>
        <div className="relative">
          <input
            id="search-input"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search verified posts, topics, or contributors…"
            className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 py-3.5 pl-11 pr-4 text-sm text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-primary-500 shadow-sm"
          />
          <SearchIcon className="absolute left-3.5 top-4 w-4 h-4 text-neutral-400" aria-hidden="true" />
        </div>
      </form>

      {/* Tabs */}
      <div className="flex border-b border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 rounded-xl p-1 shadow-sm">
        <button
          type="button"
          onClick={() => handleTabChange('posts')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-semibold rounded-lg transition-colors min-h-[44px] focus:outline-none ${
            activeTab === 'posts'
              ? 'bg-neutral-100 dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100'
              : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900'
          }`}
        >
          <FileText className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Posts</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange('users')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-semibold rounded-lg transition-colors min-h-[44px] focus:outline-none ${
            activeTab === 'users'
              ? 'bg-neutral-100 dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100'
              : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900'
          }`}
        >
          <Users className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Users</span>
        </button>
      </div>

      {/* Results */}
      {isLoading ? (
        <div className="py-16 text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary-600" aria-hidden="true" />
          <p className="mt-3 text-sm text-neutral-500">{copy.loading}</p>
        </div>
      ) : error ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 p-4 text-center text-sm text-red-700 dark:text-red-300"
        >
          {error}
        </div>
      ) : searchParams.get('q') ? (
        activeTab === 'posts' ? (
          posts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 p-8 text-center text-xs text-neutral-500 bg-white dark:bg-neutral-800">
              No posts matched your search query.
            </div>
          ) : (
            <div className="space-y-4">
              {posts.map((post) => (
                <PostCard key={post.id} post={post} />
              ))}
            </div>
          )
        ) : users.length === 0 ? (
          <div className="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 p-8 text-center text-xs text-neutral-500 bg-white dark:bg-neutral-800">
            No users matched your search query.
          </div>
        ) : (
          <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 divide-y divide-neutral-100 dark:divide-neutral-700 p-2">
            {users.map((u) => (
              <div key={u.id} className="p-3 flex items-center justify-between">
                <Link to={`/u/${u.username}`} className="flex items-center gap-3">
                  <Avatar
                    username={u.username}
                    displayName={u.displayName}
                    avatarUrl={u.avatarUrl}
                    size="md"
                  />
                  <div>
                    <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                      {u.displayName}
                    </p>
                    <p className="text-xs text-neutral-400">@{u.username}</p>
                  </div>
                </Link>
                <TierBadge tier={u.tier} />
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 p-12 text-center text-xs text-neutral-400 bg-white dark:bg-neutral-800">
          Enter a keyword or author username to search across verified claims and discussions.
        </div>
      )}
    </div>
  );
};
