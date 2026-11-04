import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { ArrowLeft, Send } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  flatten,
  keys,
  useConversations,
  useMarkThreadRead,
  useSendMessage,
  useThread,
} from '../api/hooks';
import { useWebSocket, type WsEvent } from '../hooks/useWebSocket';
import { copy } from '../copy';
import { errorMessage } from '../api/client';
import { formatRelative, formatTime } from '../lib/format';
import type { MessageItem, Page } from '../types';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { CountBadge } from '../components/ui/Pill';
import { EmptyState, ErrorState, LoadMore, LoadingRows, PageHeader } from '../components/ui/Page';

export function MessagesPage(): React.ReactElement {
  const { username } = useParams<{ username?: string }>();
  const { me } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const conversations = useConversations();
  const convItems = flatten(conversations.data);
  const peer = convItems.find((c) => c.user.username === username)?.user;

  const onEvent = useCallback(
    (evt: WsEvent) => {
      if (evt.type === 'message') {
        const m = evt.message;
        // Find which thread this belongs to via the conversation list.
        const conv = convItems.find((c) => c.user.id === m.senderId);
        if (conv) {
          qc.setQueryData<InfiniteData<Page<MessageItem>>>(
            keys.thread(conv.user.username),
            (old) =>
              old
                ? {
                    ...old,
                    pages: old.pages.map((p, i) =>
                      i === 0 ? { ...p, items: [m, ...p.items] } : p,
                    ),
                  }
                : old,
          );
        }
        void qc.invalidateQueries({ queryKey: keys.conversations });
        if (!conv) void qc.invalidateQueries({ queryKey: ['thread'] });
      } else if (evt.type === 'messages_read') {
        void qc.invalidateQueries({ queryKey: ['thread'] });
      }
    },
    [convItems, qc],
  );
  const socket = useWebSocket(onEvent);

  return (
    <div>
      <PageHeader
        title={copy.messages.title}
        subtitle={
          <span className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={`inline-block h-2 w-2 rounded-full ${socket === 'open' ? 'bg-positive' : 'bg-control'}`}
            />
            {socket === 'open' ? copy.messages.connected : copy.messages.reconnecting}
          </span>
        }
      />
      <div className="grid min-h-[60vh] gap-6 md:grid-cols-[300px_minmax(0,1fr)]">
        <section
          aria-label={copy.messages.title}
          className={`${username ? 'hidden md:block' : ''}`}
        >
          {conversations.isLoading ? (
            <LoadingRows rows={3} />
          ) : conversations.isError ? (
            <ErrorState
              message={errorMessage(conversations.error, copy.common.error)}
              onRetry={() => void conversations.refetch()}
            />
          ) : convItems.length === 0 ? (
            <EmptyState>{copy.messages.empty}</EmptyState>
          ) : (
            <>
              <ul className="divide-y divide-rule">
                {convItems.map((c) => {
                  const active = c.user.username === username;
                  return (
                    <li key={c.user.id}>
                      <Link
                        to={`/messages/${c.user.username}`}
                        aria-current={active ? 'page' : undefined}
                        className={`-mx-2 flex items-center gap-3 rounded-control px-2 py-3 ${active ? 'bg-active' : 'hover:bg-raised/60'}`}
                      >
                        <Avatar
                          avatarUrl={c.user.avatarUrl}
                          displayName={c.user.displayName}
                          username={c.user.username}
                          size="sm"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <p
                              className={`truncate text-body ${c.unreadCount ? 'font-semibold text-ink' : 'text-ink'}`}
                            >
                              {c.user.displayName}
                            </p>
                            <time
                              dateTime={c.lastMessage.createdAt}
                              className="shrink-0 text-small text-muted"
                            >
                              {formatRelative(c.lastMessage.createdAt)}
                            </time>
                          </div>
                          <p
                            className={`truncate text-small ${c.unreadCount ? 'text-ink' : 'text-muted'}`}
                          >
                            {c.lastMessage.senderId === me?.id ? 'You: ' : ''}
                            {c.lastMessage.body}
                          </p>
                        </div>
                        <CountBadge
                          count={c.unreadCount}
                          label={copy.messages.unread(c.unreadCount)}
                        />
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <LoadMore
                hasMore={Boolean(conversations.hasNextPage)}
                isLoading={conversations.isFetchingNextPage}
                onLoad={() => void conversations.fetchNextPage()}
              />
            </>
          )}
        </section>

        <section
          aria-label={username ? `@${username}` : copy.messages.selectConversation}
          className={`${username ? '' : 'hidden md:flex'} flex min-h-[60vh] flex-col rounded-card border border-border`}
        >
          {username ? (
            <Thread
              username={username}
              peer={peer}
              meId={me?.id ?? ''}
              onBack={() => navigate('/messages')}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-center text-body text-muted">
              {copy.messages.selectConversation}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Thread({
  username,
  peer,
  meId,
  onBack,
}: {
  username: string;
  peer: { displayName: string; avatarUrl: string | null; username: string } | undefined;
  meId: string;
  onBack: () => void;
}): React.ReactElement {
  const thread = useThread(username);
  const send = useSendMessage(username);
  const markRead = useMarkThreadRead();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const messages = [...flatten(thread.data)].reverse(); // API is newest first; show oldest at top
  const lastId = messages[messages.length - 1]?.id;
  const hasUnreadFromPeer = messages.some((m) => m.senderId !== meId && !m.readAt);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [lastId]);

  const markReadRef = useRef(markRead.mutate);
  markReadRef.current = markRead.mutate;
  useEffect(() => {
    if (hasUnreadFromPeer) markReadRef.current(username);
  }, [hasUnreadFromPeer, username]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || body.length > 1000) return;
    setError(null);
    send.mutate(body, {
      onSuccess: () => setText(''),
      onError: (err) => setError(errorMessage(err, copy.common.error)),
    });
  }

  return (
    <>
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="grid h-8 w-8 place-items-center rounded-control text-muted hover:bg-raised md:hidden"
          aria-label={copy.messages.backToList}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <Avatar
          avatarUrl={peer?.avatarUrl ?? null}
          displayName={peer?.displayName ?? username}
          username={username}
          size="sm"
        />
        <div className="min-w-0">
          <Link
            to={`/u/${username}`}
            className="block truncate text-body font-medium text-ink hover:underline"
          >
            {peer?.displayName ?? username}
          </Link>
          <p className="truncate text-small text-muted">@{username}</p>
        </div>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {thread.hasNextPage ? (
          <div className="flex justify-center">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void thread.fetchNextPage()}
              isLoading={thread.isFetchingNextPage}
            >
              {copy.common.loadMore}
            </Button>
          </div>
        ) : null}
        {thread.isLoading ? (
          <LoadingRows rows={2} />
        ) : thread.isError ? (
          <ErrorState
            message={errorMessage(thread.error, copy.common.error)}
            onRetry={() => void thread.refetch()}
          />
        ) : messages.length === 0 ? (
          <p className="py-8 text-center text-body text-muted">{copy.messages.noMessages}</p>
        ) : (
          messages.map((m) => {
            const mine = m.senderId === meId;
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[75%] rounded-card px-3 py-2 ${mine ? 'bg-primary text-primary-ink' : 'bg-raised text-ink'}`}
                >
                  <p className="whitespace-pre-wrap break-words text-body">{m.body}</p>
                  <p
                    className={`mt-1 text-right text-[11px] ${mine ? 'text-white/70' : 'text-muted'}`}
                  >
                    <time dateTime={m.createdAt}>{formatTime(m.createdAt)}</time>
                    {mine && m.readAt ? ` · ${copy.messages.read}` : ''}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottom} />
      </div>

      <form onSubmit={submit} className="border-t border-border p-3">
        {error ? <p className="mb-2 text-small text-negative">{error}</p> : null}
        <div className="flex items-end gap-2">
          <label htmlFor="message-input" className="sr-only">
            {copy.messages.placeholder}
          </label>
          <textarea
            id="message-input"
            rows={1}
            maxLength={1000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={copy.messages.placeholder}
            className="block max-h-32 min-h-[36px] flex-1 resize-y rounded-control border border-control bg-surface px-3 py-2 text-body placeholder:text-faint"
          />
          <Button
            type="submit"
            variant="primary"
            icon={<Send />}
            disabled={!text.trim()}
            isLoading={send.isPending}
          >
            {copy.messages.send}
          </Button>
        </div>
        <p className="mt-2 text-small text-muted">{copy.messages.policyNote}</p>
      </form>
    </>
  );
}
