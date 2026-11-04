import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search as SearchIcon } from 'lucide-react';
import { flatten, useSearchPosts, useSearchUsers } from '../api/hooks';
import { copy } from '../copy';
import { errorMessage } from '../api/client';
import { PostCard } from '../components/posts/PostCard';
import { Button } from '../components/ui/Button';
import { Tabs } from '../components/ui/Tabs';
import { EmptyState, ErrorState, LoadMore, LoadingRows, PageHeader } from '../components/ui/Page';
import { UserList } from './ProfilePage';

type SearchTab = 'posts' | 'users';

export function SearchPage(): React.ReactElement {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const tab: SearchTab = params.get('tab') === 'users' ? 'users' : 'posts';
  const [draft, setDraft] = useState(q);
  const active = q.trim().length >= 2;

  const posts = useSearchPosts(tab === 'posts' ? q : '');
  const users = useSearchUsers(tab === 'users' ? q : '');
  const postItems = flatten(posts.data);
  const userItems = flatten(users.data);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next = draft.trim();
    if (next.length < 2) return;
    setParams({ q: next, tab });
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={copy.search.title} />
      <form onSubmit={submit} role="search" className="flex gap-2">
        <label htmlFor="search-page-input" className="sr-only">
          {copy.search.placeholder}
        </label>
        <div className="relative flex-1">
          <SearchIcon
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <input
            id="search-page-input"
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={copy.search.placeholder}
            className="h-10 w-full rounded-control border border-control bg-surface pl-9 pr-3 text-body placeholder:text-faint"
          />
        </div>
        <Button type="submit" variant="primary" disabled={draft.trim().length < 2}>
          {copy.search.title}
        </Button>
      </form>

      <div className="mt-5">
        <Tabs<SearchTab>
          label={copy.search.title}
          value={tab}
          onChange={(t) => setParams(q ? { q, tab: t } : { tab: t })}
          items={[
            { value: 'posts', label: copy.search.postsTab },
            { value: 'users', label: copy.search.usersTab },
          ]}
        />
      </div>

      {!active ? (
        <div className="pt-4">
          <EmptyState>{copy.search.prompt}</EmptyState>
        </div>
      ) : tab === 'posts' ? (
        posts.isLoading ? (
          <LoadingRows rows={3} />
        ) : posts.isError ? (
          <div className="pt-4">
            <ErrorState
              message={errorMessage(posts.error, copy.common.error)}
              onRetry={() => void posts.refetch()}
            />
          </div>
        ) : postItems.length === 0 ? (
          <div className="pt-4">
            <EmptyState>{copy.search.noPosts(q)}</EmptyState>
          </div>
        ) : (
          <>
            <div className="divide-y divide-rule">
              {postItems.map((post) => (
                <PostCard key={post.id} post={post} />
              ))}
            </div>
            <LoadMore
              hasMore={Boolean(posts.hasNextPage)}
              isLoading={posts.isFetchingNextPage}
              onLoad={() => void posts.fetchNextPage()}
              total={postItems.length}
            />
          </>
        )
      ) : users.isLoading ? (
        <LoadingRows rows={3} />
      ) : users.isError ? (
        <div className="pt-4">
          <ErrorState
            message={errorMessage(users.error, copy.common.error)}
            onRetry={() => void users.refetch()}
          />
        </div>
      ) : userItems.length === 0 ? (
        <div className="pt-4">
          <EmptyState>{copy.search.noUsers(q)}</EmptyState>
        </div>
      ) : (
        <>
          <UserList users={userItems} />
          <LoadMore
            hasMore={Boolean(users.hasNextPage)}
            isLoading={users.isFetchingNextPage}
            onLoad={() => void users.fetchNextPage()}
            total={userItems.length}
          />
        </>
      )}
    </div>
  );
}
