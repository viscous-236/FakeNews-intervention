import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useWebSocket, WsMessageEvent } from '../hooks/useWebSocket';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { copy } from '../copy';
import { ConversationItem, MessageItem, PaginatedResponse } from '../types';
import { api } from '../api/client';
import { Mail, Send, ArrowLeft, Loader2 } from 'lucide-react';

export const MessagesPage: React.FC = () => {
  const { username: routeUsername } = useParams<{ username?: string }>();
  const navigate = useNavigate();
  const { me } = useAuth();

  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [activeUsername, setActiveUsername] = useState<string | null>(routeUsername || null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [newMessageText, setNewMessageText] = useState('');
  const [isLoadingConvs, setIsLoadingConvs] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (routeUsername) {
      setActiveUsername(routeUsername);
    }
  }, [routeUsername]);

  // Load conversations
  const fetchConversations = useCallback(async () => {
    try {
      const res = await api.get<{ items: ConversationItem[] }>('/api/v1/messages/conversations');
      setConversations(res.items || []);
    } catch {
      // ignore
    } finally {
      setIsLoadingConvs(false);
    }
  }, []);

  useEffect(() => {
    void fetchConversations();
  }, [fetchConversations]);

  // Load thread messages when active conversation changes
  useEffect(() => {
    let mounted = true;
    if (!activeUsername) return;

    setIsLoadingMessages(true);
    setError(null);

    api
      .get<PaginatedResponse<MessageItem>>(`/api/v1/messages/with/${activeUsername}`)
      .then((res) => {
        if (!mounted) return;
        setMessages((res.items || []).slice().reverse()); // Chronological
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
      })
      .catch((err: unknown) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : copy.error);
      })
      .finally(() => {
        if (mounted) setIsLoadingMessages(false);
      });

    return () => {
      mounted = false;
    };
  }, [activeUsername]);

  // Listen to incoming WebSocket events
  useWebSocket(
    useCallback(
      (evt: WsMessageEvent) => {
        if (evt.type === 'message') {
          const incoming = evt.data.message as MessageItem | undefined;
          const senderUsername = (evt.data.sender as { username?: string })?.username;
          if (incoming && senderUsername === activeUsername) {
            setMessages((prev) => [...prev, incoming]);
            setTimeout(() => {
              messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            }, 100);
          }
          // Refresh conversation list to show updated snippets & unread counts
          void fetchConversations();
        }
      },
      [activeUsername, fetchConversations]
    )
  );

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeUsername || !newMessageText.trim() || isSending) return;

    try {
      setIsSending(true);
      const res = await api.post<MessageItem | { message: MessageItem }>(
        `/api/v1/messages/with/${activeUsername}`,
        {
          body: newMessageText.trim(),
        },
      );
      const msg = res && 'message' in res && res.message ? res.message : (res as MessageItem);
      setMessages((prev) => [...prev, msg]);
      setNewMessageText('');
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
      void fetchConversations();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : copy.error);
    } finally {
      setIsSending(false);
    }
  };

  const activePeer = conversations.find((c) => c.peer.username === activeUsername)?.peer;

  return (
    <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 shadow-sm overflow-hidden h-[75vh] flex">
      {/* Left Column: Conversations List */}
      <div
        className={`w-full md:w-80 border-r border-neutral-200 dark:border-neutral-700 flex flex-col ${
          activeUsername ? 'hidden md:flex' : 'flex'
        }`}
      >
        <div className="p-4 border-b border-neutral-200 dark:border-neutral-700 font-bold text-sm text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
          <Mail className="w-4 h-4 text-primary-600" aria-hidden="true" />
          <span>{copy.app.nav.messages}</span>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-neutral-100 dark:divide-neutral-700">
          {isLoadingConvs ? (
            <div className="py-12 text-center">
              <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary-600" aria-hidden="true" />
            </div>
          ) : conversations.length === 0 ? (
            <p className="p-6 text-center text-xs text-neutral-400">
              No active conversations yet. Visit an author's profile to start a direct discussion.
            </p>
          ) : (
            conversations.map((conv) => (
              <button
                key={conv.id}
                type="button"
                onClick={() => {
                  setActiveUsername(conv.peer.username);
                  navigate(`/messages/${conv.peer.username}`);
                }}
                className={`w-full text-left p-3.5 flex items-center gap-3 transition-colors ${
                  activeUsername === conv.peer.username
                    ? 'bg-neutral-100 dark:bg-neutral-700'
                    : 'hover:bg-neutral-50 dark:hover:bg-neutral-750'
                }`}
              >
                <Avatar
                  username={conv.peer.username}
                  displayName={conv.peer.displayName}
                  avatarUrl={conv.peer.avatarUrl}
                  size="md"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-neutral-900 dark:text-neutral-100 truncate">
                      {conv.peer.displayName}
                    </p>
                    {conv.unreadCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-primary-600 text-white text-[10px] font-bold">
                        {conv.unreadCount}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-neutral-400 truncate mt-0.5">
                    {conv.lastMessage?.body || `@${conv.peer.username}`}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right Column: Chat thread */}
      <div
        className={`flex-1 flex flex-col ${
          !activeUsername ? 'hidden md:flex' : 'flex'
        }`}
      >
        {activeUsername ? (
          <>
            {/* Header */}
            <div className="p-3.5 border-b border-neutral-200 dark:border-neutral-700 flex items-center gap-3 bg-neutral-50/50 dark:bg-neutral-850">
              <button
                type="button"
                onClick={() => {
                  setActiveUsername(null);
                  navigate('/messages');
                }}
                className="md:hidden p-1 text-neutral-500 rounded focus:outline-none"
                aria-label="Back to conversations"
              >
                <ArrowLeft className="w-5 h-5" aria-hidden="true" />
              </button>

              <div className="flex items-center gap-2.5">
                <Avatar
                  username={activePeer?.username || activeUsername}
                  displayName={activePeer?.displayName || activeUsername}
                  avatarUrl={activePeer?.avatarUrl || null}
                  size="sm"
                />
                <div>
                  <p className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                    {activePeer?.displayName || activeUsername}
                  </p>
                  <p className="text-[10px] text-neutral-400">@{activeUsername}</p>
                </div>
              </div>
            </div>

            {/* Messages Scroll Area */}
            <div className="flex-1 p-4 overflow-y-auto space-y-3">
              {isLoadingMessages ? (
                <div className="py-12 text-center">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary-600" aria-hidden="true" />
                </div>
              ) : error ? (
                <div className="p-3 rounded-lg bg-red-50 text-red-700 text-xs text-center">
                  {error}
                </div>
              ) : messages.length === 0 ? (
                <p className="text-center text-xs text-neutral-400 py-12">
                  Say hello! Direct messages never affect reputation scores (DEC-006).
                </p>
              ) : (
                messages.map((m) => {
                  const isMine = m.senderId === me?.id;
                  return (
                    <div
                      key={m.id}
                      className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed ${
                          isMine
                            ? 'bg-primary-600 text-white rounded-br-xs'
                            : 'bg-neutral-100 dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 rounded-bl-xs'
                        }`}
                      >
                        <p className="whitespace-pre-line">{m.body}</p>
                        <time
                          className={`block text-[10px] mt-1 text-right ${
                            isMine ? 'text-primary-200' : 'text-neutral-400'
                          }`}
                        >
                          {new Date(m.createdAt).toLocaleTimeString(undefined, {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </time>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Bar */}
            <form
              onSubmit={handleSendMessage}
              className="p-3 border-t border-neutral-200 dark:border-neutral-700 flex items-center gap-2"
            >
              <input
                type="text"
                placeholder="Type a direct message…"
                maxLength={500}
                value={newMessageText}
                onChange={(e) => setNewMessageText(e.target.value)}
                className="flex-1 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3.5 py-2 text-xs text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <Button
                type="submit"
                size="sm"
                variant="primary"
                disabled={!newMessageText.trim() || isSending}
                isLoading={isSending}
                icon={<Send className="w-3.5 h-3.5" aria-hidden="true" />}
              >
                Send
              </Button>
            </form>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-neutral-400 text-xs">
            <Mail className="w-12 h-12 text-neutral-300 dark:text-neutral-600 mb-3" aria-hidden="true" />
            <p>Select a conversation from the left to read and send messages.</p>
          </div>
        )}
      </div>
    </div>
  );
};
