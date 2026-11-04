import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Avatar } from '../components/ui/Avatar';
import { TierBadge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { PostCard } from '../components/posts/PostCard';
import { copy } from '../copy';
import { UserProfile, Post, UserSummary, PaginatedResponse } from '../types';
import { api } from '../api/client';
import {
  Calendar,
  UserCheck,
  UserPlus,
  Ban,
  Mail,
  Loader2,
  FileText,
  Users,
} from 'lucide-react';

export const ProfilePage: React.FC = () => {
  const { username } = useParams<{ username: string }>();
  const { me } = useAuth();
  const navigate = useNavigate();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [activeTab, setActiveTab] = useState<'posts' | 'followers' | 'following'>('posts');
  const [posts, setPosts] = useState<Post[]>([]);
  const [followers, setFollowers] = useState<UserSummary[]>([]);
  const [following, setFollowing] = useState<UserSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFollowingAction, setIsFollowingAction] = useState(false);
  const [isBlockingAction, setIsBlockingAction] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSelf = me?.username.toLowerCase() === username?.toLowerCase();

  useEffect(() => {
    let mounted = true;
    if (!username) return;

    setIsLoading(true);
    setError(null);

    api
      .get<{ user: UserProfile }>(`/api/v1/users/${username}`)
      .then((res) => {
        if (!mounted) return;
        setProfile(res.user);
        // Load user's posts
        return api.get<PaginatedResponse<Post>>(`/api/v1/users/${username}/posts`);
      })
      .then((postsRes) => {
        if (!mounted || !postsRes) return;
        setPosts(postsRes.items);
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
  }, [username]);

  // Load followers / following when tab changes
  useEffect(() => {
    let mounted = true;
    if (!username || !profile) return;

    if (activeTab === 'followers') {
      api
        .get<PaginatedResponse<UserSummary>>(`/api/v1/users/${username}/followers`)
        .then((res) => {
          if (mounted) setFollowers(res.items);
        })
        .catch(() => {});
    } else if (activeTab === 'following') {
      api
        .get<PaginatedResponse<UserSummary>>(`/api/v1/users/${username}/following`)
        .then((res) => {
          if (mounted) setFollowing(res.items);
        })
        .catch(() => {});
    }

    return () => {
      mounted = false;
    };
  }, [activeTab, username, profile]);

  const handleFollowToggle = async () => {
    if (!profile || isFollowingAction || !me) return;
    try {
      setIsFollowingAction(true);
      if (profile.viewer.following) {
        await api.delete(`/api/v1/users/${profile.username}/follow`);
        setProfile({
          ...profile,
          viewer: { ...profile.viewer, following: false },
          counts: { ...profile.counts, followers: Math.max(0, profile.counts.followers - 1) },
        });
      } else {
        await api.post(`/api/v1/users/${profile.username}/follow`);
        setProfile({
          ...profile,
          viewer: { ...profile.viewer, following: true },
          counts: { ...profile.counts, followers: profile.counts.followers + 1 },
        });
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : copy.error);
    } finally {
      setIsFollowingAction(false);
    }
  };

  const handleBlockToggle = async () => {
    if (!profile || isBlockingAction || !me) return;
    const confirmMsg = profile.viewer.blocked
      ? `Unblock @${profile.username}?`
      : `Block @${profile.username}? They will not be able to follow, message, or interact with you.`;
    if (!window.confirm(confirmMsg)) return;

    try {
      setIsBlockingAction(true);
      if (profile.viewer.blocked) {
        await api.delete(`/api/v1/users/${profile.username}/block`);
        setProfile({
          ...profile,
          viewer: { ...profile.viewer, blocked: false },
        });
      } else {
        await api.post(`/api/v1/users/${profile.username}/block`);
        setProfile({
          ...profile,
          viewer: { ...profile.viewer, blocked: true, following: false },
        });
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : copy.error);
    } finally {
      setIsBlockingAction(false);
    }
  };

  if (isLoading) {
    return (
      <div className="py-20 text-center">
        <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary-600" aria-hidden="true" />
        <p className="mt-3 text-sm text-neutral-500">{copy.loading}</p>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 p-6 text-center text-sm text-red-700 dark:text-red-300"
      >
        {error || 'User not found.'}
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Profile Card */}
      <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex items-center sm:items-start gap-4">
            <Avatar
              username={profile.username}
              displayName={profile.displayName}
              avatarUrl={profile.avatarUrl}
              size="lg"
            />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">
                  {profile.displayName}
                </h1>
                <TierBadge tier={profile.tier} />
              </div>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                @{profile.username}
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            {isSelf ? (
              <Link to="/settings">
                <Button variant="outline" size="sm">
                  {copy.app.nav.settings}
                </Button>
              </Link>
            ) : me ? (
              <>
                <Button
                  variant={profile.viewer.following ? 'outline' : 'primary'}
                  size="sm"
                  onClick={handleFollowToggle}
                  isLoading={isFollowingAction}
                  icon={
                    profile.viewer.following ? (
                      <UserCheck className="w-4 h-4" aria-hidden="true" />
                    ) : (
                      <UserPlus className="w-4 h-4" aria-hidden="true" />
                    )
                  }
                >
                  {profile.viewer.following ? 'Following' : 'Follow'}
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate(`/messages/${profile.username}`)}
                  icon={<Mail className="w-4 h-4" aria-hidden="true" />}
                  aria-label="Direct message"
                >
                  Message
                </Button>

                <Button
                  variant={profile.viewer.blocked ? 'danger' : 'ghost'}
                  size="sm"
                  onClick={handleBlockToggle}
                  isLoading={isBlockingAction}
                  icon={<Ban className="w-4 h-4" aria-hidden="true" />}
                  aria-label={profile.viewer.blocked ? 'Unblock user' : 'Block user'}
                >
                  {profile.viewer.blocked ? 'Blocked' : 'Block'}
                </Button>
              </>
            ) : (
              <Link to="/login">
                <Button variant="primary" size="sm">
                  Follow
                </Button>
              </Link>
            )}
          </div>
        </div>

        {/* Bio */}
        {profile.bio && (
          <p className="mt-4 text-sm text-neutral-700 dark:text-neutral-300 whitespace-pre-line leading-relaxed">
            {profile.bio}
          </p>
        )}

        {/* Metadata stats */}
        <div className="mt-4 pt-4 border-t border-neutral-100 dark:border-neutral-700 flex flex-wrap items-center gap-6 text-xs text-neutral-500">
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
            <span>
              Joined{' '}
              {new Date(profile.createdAt).toLocaleDateString(undefined, {
                month: 'short',
                year: 'numeric',
              })}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setActiveTab('following')}
            className="hover:underline focus:outline-none"
          >
            <strong className="font-semibold text-neutral-900 dark:text-neutral-100">
              {profile.counts.following}
            </strong>{' '}
            Following
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('followers')}
            className="hover:underline focus:outline-none"
          >
            <strong className="font-semibold text-neutral-900 dark:text-neutral-100">
              {profile.counts.followers}
            </strong>{' '}
            Followers
          </button>

          <span>
            <strong className="font-semibold text-neutral-900 dark:text-neutral-100">
              {profile.counts.posts}
            </strong>{' '}
            Posts
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 rounded-xl p-1 shadow-sm">
        <button
          type="button"
          onClick={() => setActiveTab('posts')}
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
          onClick={() => setActiveTab('followers')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-semibold rounded-lg transition-colors min-h-[44px] focus:outline-none ${
            activeTab === 'followers'
              ? 'bg-neutral-100 dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100'
              : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900'
          }`}
        >
          <Users className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Followers ({profile.counts.followers})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('following')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-semibold rounded-lg transition-colors min-h-[44px] focus:outline-none ${
            activeTab === 'following'
              ? 'bg-neutral-100 dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100'
              : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900'
          }`}
        >
          <Users className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Following ({profile.counts.following})</span>
        </button>
      </div>

      {/* Tab Panels */}
      {activeTab === 'posts' && (
        <div className="space-y-4">
          {posts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 p-8 text-center bg-white dark:bg-neutral-800 text-xs text-neutral-500">
              No posts published yet.
            </div>
          ) : (
            posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                onPostUpdated={(updated) =>
                  setPosts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
                }
                onPostDeleted={(postId) =>
                  setPosts((prev) => prev.filter((p) => p.id !== postId))
                }
              />
            ))
          )}
        </div>
      )}

      {activeTab === 'followers' && (
        <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-4 divide-y divide-neutral-100 dark:divide-neutral-700">
          {followers.length === 0 ? (
            <p className="py-6 text-center text-xs text-neutral-500">
              No followers yet.
            </p>
          ) : (
            followers.map((u) => (
              <div key={u.id} className="py-3 flex items-center justify-between">
                <Link to={`/u/${u.username}`} className="flex items-center gap-2.5">
                  <Avatar
                    username={u.username}
                    displayName={u.displayName}
                    avatarUrl={u.avatarUrl}
                    size="sm"
                  />
                  <div>
                    <p className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                      {u.displayName}
                    </p>
                    <p className="text-[11px] text-neutral-400">@{u.username}</p>
                  </div>
                </Link>
                <TierBadge tier={u.tier} />
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'following' && (
        <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-4 divide-y divide-neutral-100 dark:divide-neutral-700">
          {following.length === 0 ? (
            <p className="py-6 text-center text-xs text-neutral-500">
              Not following anyone yet.
            </p>
          ) : (
            following.map((u) => (
              <div key={u.id} className="py-3 flex items-center justify-between">
                <Link to={`/u/${u.username}`} className="flex items-center gap-2.5">
                  <Avatar
                    username={u.username}
                    displayName={u.displayName}
                    avatarUrl={u.avatarUrl}
                    size="sm"
                  />
                  <div>
                    <p className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                      {u.displayName}
                    </p>
                    <p className="text-[11px] text-neutral-400">@{u.username}</p>
                  </div>
                </Link>
                <TierBadge tier={u.tier} />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
