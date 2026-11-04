/**
 * Data layer: TanStack Query hooks for every endpoint the UI uses.
 * Query keys are centralized in `keys` so mutations can invalidate precisely.
 * Optimistic updates are limited to likes (plan Section 1.1).
 */

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { api } from './client';
import type {
  AdminAppealItem,
  AdminLedgerRow,
  AdminOverview,
  AdminPostDetail,
  AdminUserDetail,
  AdminUserItem,
  AppealItem,
  AppealStatus,
  AssessmentVerdict,
  AuditLogItem,
  Comment,
  ConversationItem,
  DetectorAnalytics,
  DetectorStatus,
  EventItem,
  LedgerRow,
  Me,
  MessageItem,
  NotificationItem,
  Page,
  Post,
  ReportReason,
  ReviewQueueItem,
  ScoreResponse,
  SessionItem,
  SpreadRow,
  UserProfile,
  UserStatus,
  UserSummary,
  VerifyResult,
  WaveAnalyticsRow,
  WaveItem,
} from '../types';

export const keys = {
  me: ['auth', 'me'] as const,
  feed: (tab: 'global' | 'following') => ['feed', tab] as const,
  post: (id: string) => ['post', id] as const,
  comments: (postId: string) => ['comments', postId] as const,
  profile: (username: string) => ['profile', username] as const,
  userPosts: (username: string) => ['userPosts', username] as const,
  connections: (username: string, dir: 'followers' | 'following') =>
    ['connections', username, dir] as const,
  suggestions: ['suggestions'] as const,
  search: (tab: 'posts' | 'users', q: string) => ['search', tab, q] as const,
  notifications: ['notifications'] as const,
  unreadCount: ['notifications', 'unread'] as const,
  conversations: ['conversations'] as const,
  thread: (username: string) => ['thread', username] as const,
  score: ['score'] as const,
  scoreHistory: ['score', 'history'] as const,
  waveExplanation: (n: number) => ['score', 'history', n] as const,
  events: ['events'] as const,
  appeals: ['appeals'] as const,
  sessions: ['sessions'] as const,
  blocks: ['blocks'] as const,
  admin: {
    overview: ['admin', 'overview'] as const,
    detector: ['admin', 'detector'] as const,
    queue: ['admin', 'queue'] as const,
    post: (id: string) => ['admin', 'post', id] as const,
    appeals: (status: AppealStatus | 'all') => ['admin', 'appeals', status] as const,
    waves: ['admin', 'waves'] as const,
    ledger: (waveId: string) => ['admin', 'ledger', waveId] as const,
    users: (q: string, status: UserStatus | '') => ['admin', 'users', q, status] as const,
    user: (id: string) => ['admin', 'user', id] as const,
    audit: (filters: Record<string, string>) => ['admin', 'audit', filters] as const,
    analytics: (kind: string) => ['admin', 'analytics', kind] as const,
  },
};

// ---------------------------------------------------------------------------
// Generic cursor page helper
// ---------------------------------------------------------------------------

export type PagedResult<T> = UseInfiniteQueryResult<InfiniteData<Page<T>>, Error>;

function usePaged<T>(
  queryKey: readonly unknown[],
  path: string,
  params: Record<string, unknown> = {},
  enabled = true,
): PagedResult<T> {
  return useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) =>
      api.get<Page<T>>(path, { ...params, cursor: pageParam || undefined }),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });
}

export function flatten<T>(data: InfiniteData<Page<T>> | undefined): T[] {
  return data?.pages.flatMap((p) => p.items) ?? [];
}

// ---------------------------------------------------------------------------
// Feed and posts
// ---------------------------------------------------------------------------

export function useFeed(tab: 'global' | 'following', enabled = true) {
  return usePaged<Post>(keys.feed(tab), `/api/v1/feed/${tab}`, {}, enabled);
}

export function usePost(id: string | undefined) {
  return useQuery({
    queryKey: keys.post(id ?? ''),
    queryFn: () => api.get<Post>(`/api/v1/posts/${id}`),
    enabled: Boolean(id),
  });
}

export function useComments(postId: string | undefined) {
  return usePaged<Comment>(
    keys.comments(postId ?? ''),
    `/api/v1/posts/${postId}/comments`,
    {},
    Boolean(postId),
  );
}

export function useUserPosts(username: string | undefined) {
  return usePaged<Post>(
    keys.userPosts(username ?? ''),
    `/api/v1/users/${username}/posts`,
    {},
    Boolean(username),
  );
}

export function useSearchPosts(q: string) {
  return usePaged<Post>(
    keys.search('posts', q),
    '/api/v1/search/posts',
    { q },
    q.trim().length >= 2,
  );
}

export function useSearchUsers(q: string) {
  return usePaged<UserSummary>(
    keys.search('users', q),
    '/api/v1/search/users',
    { q },
    q.trim().length >= 2,
  );
}

/** Replace a post everywhere it is cached (feeds, profile, search, detail). */
export function usePostCacheUpdater() {
  const qc = useQueryClient();
  return (updated: Post) => {
    qc.setQueryData<Post>(keys.post(updated.id), (old) => (old ? { ...old, ...updated } : updated));
    qc.setQueriesData<InfiniteData<Page<Post>>>(
      { predicate: (q) => ['feed', 'userPosts', 'search'].includes(String(q.queryKey[0])) },
      (old) =>
        old
          ? {
              ...old,
              pages: old.pages.map((p) => ({
                ...p,
                items: p.items.map((item) => {
                  if (item.id === updated.id) return { ...item, ...updated };
                  if (item.reshareOf?.id === updated.id)
                    return { ...item, reshareOf: { ...item.reshareOf, ...updated } };
                  return item;
                }),
              })),
            }
          : old,
    );
  };
}

export function usePostCacheRemover() {
  const qc = useQueryClient();
  return (postId: string) => {
    qc.removeQueries({ queryKey: keys.post(postId) });
    qc.setQueriesData<InfiniteData<Page<Post>>>(
      { predicate: (q) => ['feed', 'userPosts', 'search'].includes(String(q.queryKey[0])) },
      (old) =>
        old
          ? {
              ...old,
              pages: old.pages.map((p) => ({
                ...p,
                items: p.items.filter((i) => i.id !== postId),
              })),
            }
          : old,
    );
  };
}

export function useCreatePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { body: string; sourceUrl?: string; mediaIds?: string[] }) =>
      api.post<Post>('/api/v1/posts', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['feed'] });
      void qc.invalidateQueries({ queryKey: ['userPosts'] });
    },
  });
}

export function useEditPost() {
  const update = usePostCacheUpdater();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string; body?: string; sourceUrl?: string | null }) =>
      api.patch<Post>(`/api/v1/posts/${id}`, input),
    onSuccess: update,
  });
}

export function useDeletePost() {
  const remove = usePostCacheRemover();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/v1/posts/${id}`),
    onSuccess: (_d, id) => {
      remove(id);
      void qc.invalidateQueries({ queryKey: keys.events });
      void qc.invalidateQueries({ queryKey: keys.score });
    },
  });
}

/** Like toggle with optimistic update (the one place optimism is allowed). */
export function useToggleLike() {
  const update = usePostCacheUpdater();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ post }: { post: Post }) =>
      post.viewer.liked
        ? api.delete<void>(`/api/v1/posts/${post.id}/like`)
        : api.post<void>(`/api/v1/posts/${post.id}/like`),
    onMutate: ({ post }) => {
      const optimistic: Post = {
        ...post,
        viewer: { ...post.viewer, liked: !post.viewer.liked },
        counts: {
          ...post.counts,
          likes: Math.max(0, post.counts.likes + (post.viewer.liked ? -1 : 1)),
        },
      };
      update(optimistic);
      return { previous: post };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) update(ctx.previous);
    },
    onSettled: (_d, _e, { post }) => {
      void qc.invalidateQueries({ queryKey: keys.post(post.id) });
      void qc.invalidateQueries({ queryKey: keys.events });
      void qc.invalidateQueries({ queryKey: keys.score });
    },
  });
}

export function useReshare() {
  const qc = useQueryClient();
  const update = usePostCacheUpdater();
  return useMutation({
    mutationFn: ({
      post,
      comment,
      acknowledgedWarning,
    }: {
      post: Post;
      comment?: string;
      acknowledgedWarning?: boolean;
    }) =>
      api.post<Post>(`/api/v1/posts/${post.id}/reshare`, {
        ...(comment ? { comment } : {}),
        ...(acknowledgedWarning ? { acknowledgedWarning: true } : {}),
      }),
    onSuccess: (_reshare, { post }) => {
      update({
        ...post,
        viewer: { ...post.viewer, reshared: true },
        counts: { ...post.counts, reshares: post.counts.reshares + 1 },
      });
      void qc.invalidateQueries({ queryKey: ['feed'] });
      void qc.invalidateQueries({ queryKey: keys.events });
      void qc.invalidateQueries({ queryKey: keys.score });
    },
  });
}

export function useRetractReshare() {
  const qc = useQueryClient();
  const update = usePostCacheUpdater();
  return useMutation({
    mutationFn: ({ post }: { post: Post }) => api.delete<void>(`/api/v1/posts/${post.id}/reshare`),
    onSuccess: (_d, { post }) => {
      update({
        ...post,
        viewer: { ...post.viewer, reshared: false },
        counts: { ...post.counts, reshares: Math.max(0, post.counts.reshares - 1) },
      });
      void qc.invalidateQueries({ queryKey: ['feed'] });
      void qc.invalidateQueries({ queryKey: keys.events });
      void qc.invalidateQueries({ queryKey: keys.score });
    },
  });
}

export function useReportPost() {
  return useMutation({
    mutationFn: ({
      postId,
      reason,
      details,
    }: {
      postId: string;
      reason: ReportReason;
      details?: string;
    }) =>
      api.post<{ id: string }>(`/api/v1/posts/${postId}/report`, {
        reason,
        ...(details ? { details } : {}),
      }),
  });
}

export function useCreateComment(postId: string) {
  const qc = useQueryClient();
  const update = usePostCacheUpdater();
  return useMutation({
    mutationFn: (body: string) => api.post<Comment>(`/api/v1/posts/${postId}/comments`, { body }),
    onSuccess: (comment) => {
      qc.setQueryData<InfiniteData<Page<Comment>>>(keys.comments(postId), (old) =>
        old
          ? {
              ...old,
              pages: old.pages.map((p, i) =>
                i === old.pages.length - 1 ? { ...p, items: [...p.items, comment] } : p,
              ),
            }
          : old,
      );
      const post = qc.getQueryData<Post>(keys.post(postId));
      if (post) update({ ...post, counts: { ...post.counts, comments: post.counts.comments + 1 } });
    },
  });
}

export function useDeleteComment(postId: string) {
  const qc = useQueryClient();
  const update = usePostCacheUpdater();
  return useMutation({
    mutationFn: (commentId: string) => api.delete<void>(`/api/v1/comments/${commentId}`),
    onSuccess: (_d, commentId) => {
      qc.setQueryData<InfiniteData<Page<Comment>>>(keys.comments(postId), (old) =>
        old
          ? {
              ...old,
              pages: old.pages.map((p) => ({
                ...p,
                items: p.items.filter((c) => c.id !== commentId),
              })),
            }
          : old,
      );
      const post = qc.getQueryData<Post>(keys.post(postId));
      if (post)
        update({
          ...post,
          counts: { ...post.counts, comments: Math.max(0, post.counts.comments - 1) },
        });
    },
  });
}

export function useUploadMedia() {
  return useMutation({
    mutationFn: ({ file, kind }: { file: File; kind: 'avatar' | 'post_image' }) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('kind', kind);
      return api.upload<{ id: string; url: string; width: number; height: number }>(
        '/api/v1/media',
        fd,
      );
    },
  });
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export function useProfile(username: string | undefined) {
  return useQuery({
    queryKey: keys.profile(username ?? ''),
    queryFn: () => api.get<UserProfile>(`/api/v1/users/${username}`),
    enabled: Boolean(username),
  });
}

export function useConnections(
  username: string | undefined,
  dir: 'followers' | 'following',
  enabled = true,
) {
  return usePaged<UserSummary>(
    keys.connections(username ?? '', dir),
    `/api/v1/users/${username}/${dir}`,
    {},
    Boolean(username) && enabled,
  );
}

export function useSuggestions(enabled: boolean) {
  return useQuery({
    queryKey: keys.suggestions,
    queryFn: () => api.get<{ items: UserSummary[] }>('/api/v1/users/suggestions'),
    enabled,
  });
}

export function useFollow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ username, follow }: { username: string; follow: boolean }) =>
      follow
        ? api.post<void>(`/api/v1/users/${username}/follow`)
        : api.delete<void>(`/api/v1/users/${username}/follow`),
    onSuccess: (_d, { username, follow }) => {
      qc.setQueryData<UserProfile>(keys.profile(username), (old) =>
        old
          ? {
              ...old,
              viewer: { ...old.viewer, following: follow },
              counts: {
                ...old.counts,
                followers: Math.max(0, old.counts.followers + (follow ? 1 : -1)),
              },
            }
          : old,
      );
      void qc.invalidateQueries({ queryKey: keys.suggestions });
      void qc.invalidateQueries({ queryKey: keys.feed('following') });
      void qc.invalidateQueries({ queryKey: ['connections'] });
    },
  });
}

export function useBlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ username, block }: { username: string; block: boolean }) =>
      block
        ? api.post<void>(`/api/v1/users/${username}/block`)
        : api.delete<void>(`/api/v1/users/${username}/block`),
    onSuccess: (_d, { username, block }) => {
      qc.setQueryData<UserProfile>(keys.profile(username), (old) =>
        old ? { ...old, viewer: { following: false, blocked: block } } : old,
      );
      void qc.invalidateQueries({ queryKey: keys.blocks });
      void qc.invalidateQueries({ queryKey: ['feed'] });
    },
  });
}

export function useBlocks(enabled = true) {
  return usePaged<UserSummary>(keys.blocks, '/api/v1/users/me/blocks', {}, enabled);
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export function useNotifications(enabled = true) {
  return usePaged<NotificationItem>(keys.notifications, '/api/v1/notifications', {}, enabled);
}

export function useUnreadCount(enabled: boolean, refetchInterval?: number | false) {
  return useQuery({
    queryKey: keys.unreadCount,
    queryFn: () => api.get<{ count: number }>('/api/v1/notifications/unread-count'),
    enabled,
    refetchInterval,
  });
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids?: string[]) =>
      api.post<void>('/api/v1/notifications/read', ids ? { ids } : {}),
    onSuccess: (_d, ids) => {
      const now = new Date().toISOString();
      qc.setQueryData<InfiniteData<Page<NotificationItem>>>(keys.notifications, (old) =>
        old
          ? {
              ...old,
              pages: old.pages.map((p) => ({
                ...p,
                items: p.items.map((n) =>
                  !ids || ids.includes(n.id) ? { ...n, readAt: n.readAt ?? now } : n,
                ),
              })),
            }
          : old,
      );
      void qc.invalidateQueries({ queryKey: keys.unreadCount });
    },
  });
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export function useConversations(enabled = true) {
  return usePaged<ConversationItem>(
    keys.conversations,
    '/api/v1/messages/conversations',
    {},
    enabled,
  );
}

export function useThread(username: string | undefined) {
  return usePaged<MessageItem>(
    keys.thread(username ?? ''),
    `/api/v1/messages/with/${username}`,
    {},
    Boolean(username),
  );
}

export function useSendMessage(username: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      api.post<MessageItem>(`/api/v1/messages/with/${username}`, { body }),
    onSuccess: (message) => {
      qc.setQueryData<InfiniteData<Page<MessageItem>>>(keys.thread(username), (old) =>
        old
          ? {
              ...old,
              pages: old.pages.map((p, i) =>
                i === 0 ? { ...p, items: [message, ...p.items] } : p,
              ),
            }
          : old,
      );
      void qc.invalidateQueries({ queryKey: keys.conversations });
    },
  });
}

export function useMarkThreadRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (username: string) => api.post<void>(`/api/v1/messages/with/${username}/read`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.conversations });
    },
  });
}

// ---------------------------------------------------------------------------
// Score, events, appeals
// ---------------------------------------------------------------------------

export function useScore(enabled = true) {
  return useQuery({
    queryKey: keys.score,
    queryFn: () => api.get<ScoreResponse>('/api/v1/me/score'),
    enabled,
  });
}

export function useScoreHistory(enabled = true) {
  return usePaged<LedgerRow>(keys.scoreHistory, '/api/v1/me/score/history', {}, enabled);
}

export function useWaveExplanation(waveNumber: number | null) {
  return useQuery({
    queryKey: keys.waveExplanation(waveNumber ?? 0),
    queryFn: () =>
      api.get<{ row: LedgerRow; events: EventItem[] }>(`/api/v1/me/score/history/${waveNumber}`),
    enabled: waveNumber !== null,
  });
}

export function useEvents(enabled = true) {
  return usePaged<EventItem>(keys.events, '/api/v1/me/events', {}, enabled);
}

export function useAppeals(enabled = true) {
  return usePaged<AppealItem>(keys.appeals, '/api/v1/me/appeals', {}, enabled);
}

export function useOpenAppeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, reason }: { eventId: string; reason: string }) =>
      api.post<{ id: string; status: 'open' }>(`/api/v1/events/${eventId}/appeal`, { reason }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.events });
      void qc.invalidateQueries({ queryKey: keys.appeals });
      void qc.invalidateQueries({ queryKey: keys.score });
    },
  });
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { displayName?: string; bio?: string; avatarMediaId?: string | null }) =>
      api.patch<{ user: Me }>('/api/v1/users/me', input),
    onSuccess: (data) => {
      qc.setQueryData(keys.me, data);
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) =>
      api.post<void>('/api/v1/auth/change-password', input),
  });
}

export function useSessions(enabled = true) {
  return useQuery({
    queryKey: keys.sessions,
    queryFn: () => api.get<SessionItem[]>('/api/v1/auth/sessions'),
    enabled,
  });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/v1/auth/sessions/${id}`),
    onSuccess: (_d, id) => {
      qc.setQueryData<SessionItem[]>(keys.sessions, (old) => old?.filter((s) => s.id !== id));
    },
  });
}

export function useDeleteAccount() {
  return useMutation({
    mutationFn: (password: string) => api.delete<void>('/api/v1/users/me', { password }),
  });
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export function useAdminOverview() {
  return useQuery({
    queryKey: keys.admin.overview,
    queryFn: () => api.get<AdminOverview>('/api/v1/admin/analytics/overview'),
  });
}

export function useDetectorStatus() {
  return useQuery({
    queryKey: keys.admin.detector,
    queryFn: () => api.get<DetectorStatus>('/api/v1/admin/detector/status'),
    staleTime: 60_000,
  });
}

export function useAdminQueue() {
  return usePaged<ReviewQueueItem>(keys.admin.queue, '/api/v1/admin/queue');
}

export function useAdminPost(id: string | undefined) {
  return useQuery({
    queryKey: keys.admin.post(id ?? ''),
    queryFn: () => api.get<AdminPostDetail>(`/api/v1/admin/posts/${id}`),
    enabled: Boolean(id),
  });
}

export function useAssessPost(postId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { verdict: AssessmentVerdict; rationale: string }) =>
      api.post<{ assessment: { id: string }; eventsCreated: { kind: string; count: number }[] }>(
        `/api/v1/admin/posts/${postId}/assessments`,
        input,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.admin.post(postId) });
      void qc.invalidateQueries({ queryKey: keys.admin.queue });
      void qc.invalidateQueries({ queryKey: keys.admin.overview });
      void qc.invalidateQueries({ queryKey: keys.post(postId) });
    },
  });
}

export function useAdminPostAction(postId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      action:
        | { kind: 'release' }
        | { kind: 'delete'; reason: string }
        | { kind: 'redetect' }
        | { kind: 'requeue'; detectionId: string },
    ): Promise<void> => {
      switch (action.kind) {
        case 'release':
          await api.post<void>(`/api/v1/admin/posts/${postId}/release`);
          return;
        case 'delete':
          await api.delete<void>(`/api/v1/admin/posts/${postId}`, { reason: action.reason });
          return;
        case 'redetect':
          await api.post<{ detectionId: string }>(`/api/v1/admin/posts/${postId}/redetect`);
          return;
        case 'requeue':
          await api.post<void>(`/api/v1/admin/detections/${action.detectionId}/requeue`);
          return;
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.admin.post(postId) });
      void qc.invalidateQueries({ queryKey: keys.admin.queue });
      void qc.invalidateQueries({ queryKey: keys.admin.overview });
    },
  });
}

export function useAdminAppeals(status: AppealStatus | 'all') {
  return usePaged<AdminAppealItem>(
    keys.admin.appeals(status),
    '/api/v1/admin/appeals',
    status === 'all' ? {} : { status },
  );
}

export function useResolveAppeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      appealId,
      ...input
    }:
      | { appealId: string; decision: 'upheld'; note: string }
      | {
          appealId: string;
          decision: 'overturned';
          note: string;
          newVerdict: 'real' | 'unverifiable';
          rationale: string;
        }) =>
      api.post<{ id: string; status: AppealStatus }>(
        `/api/v1/admin/appeals/${appealId}/resolve`,
        input,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'appeals'] });
      void qc.invalidateQueries({ queryKey: keys.admin.overview });
      void qc.invalidateQueries({ queryKey: keys.admin.waves });
    },
  });
}

export function useAdminWaves() {
  return usePaged<WaveItem>(keys.admin.waves, '/api/v1/admin/waves');
}

export function useAdminLedger(waveId: string | null) {
  return usePaged<AdminLedgerRow>(
    keys.admin.ledger(waveId ?? ''),
    `/api/v1/admin/waves/${waveId}/ledger`,
    {},
    Boolean(waveId),
  );
}

export function useFinalizeWave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (waveId: string) =>
      api.post<{
        alreadyFinalized: boolean;
        wave: { number: number };
        usersScored: number;
        eventsCounted: number;
      }>(`/api/v1/admin/waves/${waveId}/finalize`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin'] });
      void qc.invalidateQueries({ queryKey: keys.score });
      void qc.invalidateQueries({ queryKey: keys.events });
    },
  });
}

export function useVerifyScores() {
  return useMutation({
    mutationFn: () => api.post<VerifyResult>('/api/v1/admin/verify-scores'),
  });
}

export function useAdminUsers(q: string, status: UserStatus | '') {
  return usePaged<AdminUserItem>(keys.admin.users(q, status), '/api/v1/admin/users', {
    ...(q ? { q } : {}),
    ...(status ? { status } : {}),
  });
}

export function useAdminUser(id: string | null) {
  return useQuery({
    queryKey: keys.admin.user(id ?? ''),
    queryFn: () => api.get<AdminUserDetail>(`/api/v1/admin/users/${id}`),
    enabled: Boolean(id),
  });
}

export function useSuspendUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, suspend, reason }: { id: string; suspend: boolean; reason: string }) =>
      api.post<void>(`/api/v1/admin/users/${id}/${suspend ? 'suspend' : 'unsuspend'}`, { reason }),
    onSuccess: (_d, { id }) => {
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      void qc.invalidateQueries({ queryKey: keys.admin.user(id) });
    },
  });
}

export function useAdminAudit(filters: Record<string, string>) {
  return usePaged<AuditLogItem>(keys.admin.audit(filters), '/api/v1/admin/audit', filters);
}

export function useAdminAnalytics<T>(
  kind: 'detector' | 'waves' | 'spread',
  options?: Partial<UseQueryOptions<T>>,
) {
  return useQuery<T>({
    queryKey: keys.admin.analytics(kind),
    queryFn: () => api.get<T>(`/api/v1/admin/analytics/${kind}`),
    ...options,
  });
}

export type { DetectorAnalytics, WaveAnalyticsRow, SpreadRow };
