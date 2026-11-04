import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { copy } from '../copy';
import { api } from '../api/client';
import {
  User,
  Shield,
  Smartphone,
  Ban,
  Download,
  AlertOctagon,
  Upload,
  CheckCircle2,
} from 'lucide-react';

interface SessionItem {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  userAgent: string;
  ip: string;
  isCurrent: boolean;
}

interface BlockItem {
  id: string;
  blockedUser: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
  };
  createdAt: string;
}

export const SettingsPage: React.FC = () => {
  const { me, refreshMe, logout } = useAuth();

  // Profile form state
  const [displayName, setDisplayName] = useState(me?.displayName || '');
  const [bio, setBio] = useState(me?.bio || '');
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Password form state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Sessions state
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);

  // Blocks state
  const [blocks, setBlocks] = useState<BlockItem[]>([]);

  // Account deletion state
  const [deletePassword, setDeletePassword] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Load sessions and blocks
  useEffect(() => {
    let mounted = true;
    setIsLoadingSessions(true);

    api
      .get<{ sessions: SessionItem[] }>('/api/v1/auth/sessions')
      .then((res: { sessions: SessionItem[] }) => {
        if (mounted) setSessions(res.sessions || []);
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setIsLoadingSessions(false);
      });

    api
      .get<{ blocks: BlockItem[] }>('/api/v1/users/me/blocks')
      .then((res: { blocks: BlockItem[] }) => {
        if (mounted) setBlocks(res.blocks || []);
      })
      .catch(() => {});

    return () => {
      mounted = false;
    };
  }, []);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError(null);
    setProfileSuccess(false);

    try {
      setIsUpdatingProfile(true);
      await api.patch('/api/v1/users/me', {
        displayName: displayName.trim(),
        bio: bio.trim(),
      });
      await refreshMe();
      setProfileSuccess(true);
    } catch (err: unknown) {
      setProfileError(err instanceof Error ? err.message : copy.error);
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.upload<{ url: string }>('/api/v1/media/upload', formData);

      await api.patch('/api/v1/users/me', {
        avatarUrl: res.url,
      });
      await refreshMe();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to update avatar photo.');
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(false);

    if (newPassword.length < 10) {
      setPasswordError('New password must be at least 10 characters long.');
      return;
    }

    try {
      setIsChangingPassword(true);
      await api.post('/api/v1/auth/change-password', {
        currentPassword,
        newPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setPasswordSuccess(true);
    } catch (err: unknown) {
      setPasswordError(err instanceof Error ? err.message : copy.error);
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    try {
      await api.delete(`/api/v1/auth/sessions/${sessionId}`);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to revoke session.');
    }
  };

  const handleUnblock = async (username: string) => {
    try {
      await api.delete(`/api/v1/users/${username}/block`);
      setBlocks((prev) => prev.filter((b) => b.blockedUser.username !== username));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to unblock.');
    }
  };

  const handleExportData = async () => {
    try {
      const data = await api.get('/api/v1/users/me/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fakenews-intervention-export-${me?.username || 'user'}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Export failed.');
    }
  };

  const handleDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setDeleteError(null);
    if (!window.confirm('Are you ABSOLUTELY certain you wish to delete your account? This action cannot be undone.')) {
      return;
    }

    try {
      setIsDeletingAccount(true);
      await api.post('/api/v1/users/me/delete', { password: deletePassword });
      await logout();
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : copy.error);
    } finally {
      setIsDeletingAccount(false);
    }
  };

  if (!me) return null;

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
        {copy.settings.title}
      </h1>

      {/* Profile Section */}
      <section className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-6 shadow-sm space-y-6">
        <div className="flex items-center gap-2 pb-3 border-b border-neutral-100 dark:border-neutral-700">
          <User className="w-5 h-5 text-primary-600 dark:text-primary-400" aria-hidden="true" />
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            {copy.settings.profileSection}
          </h2>
        </div>

        {profileSuccess && (
          <div className="rounded-lg bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-900/60 p-3 text-xs text-green-700 dark:text-green-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Profile information updated successfully.</span>
          </div>
        )}

        {profileError && (
          <div className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 p-3 text-xs text-red-700 dark:text-red-300">
            {profileError}
          </div>
        )}

        {/* Avatar Upload */}
        <div className="flex items-center gap-4">
          <Avatar
            username={me.username}
            displayName={me.displayName}
            avatarUrl={me.avatarUrl}
            size="lg"
          />
          <div>
            <input
              type="file"
              ref={fileInputRef}
              accept="image/png,image/jpeg,image/webp"
              onChange={handleAvatarUpload}
              className="hidden"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              icon={<Upload className="w-4 h-4" aria-hidden="true" />}
            >
              Change Profile Photo
            </Button>
            <p className="mt-1 text-[11px] text-neutral-500">
              WebP, PNG or JPEG. Re-encoded to WebP (REQ-022).
            </p>
          </div>
        </div>

        <form onSubmit={handleUpdateProfile} className="space-y-4">
          <Input
            id="settings-displayName"
            label={copy.auth.displayNameLabel}
            type="text"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />

          <div>
            <label
              htmlFor="settings-bio"
              className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1"
            >
              {copy.settings.bioLabel}
            </label>
            <textarea
              id="settings-bio"
              rows={3}
              maxLength={200}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <Button
            type="submit"
            variant="primary"
            isLoading={isUpdatingProfile}
          >
            {copy.settings.updateProfileBtn}
          </Button>
        </form>
      </section>

      {/* Security & Password Section */}
      <section className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-6 shadow-sm space-y-6">
        <div className="flex items-center gap-2 pb-3 border-b border-neutral-100 dark:border-neutral-700">
          <Shield className="w-5 h-5 text-primary-600 dark:text-primary-400" aria-hidden="true" />
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            {copy.settings.securitySection}
          </h2>
        </div>

        {passwordSuccess && (
          <div className="rounded-lg bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-900/60 p-3 text-xs text-green-700 dark:text-green-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Password updated successfully. Other active sessions were invalidated.</span>
          </div>
        )}

        {passwordError && (
          <div className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 p-3 text-xs text-red-700 dark:text-red-300">
            {passwordError}
          </div>
        )}

        <form onSubmit={handleChangePassword} className="space-y-4">
          <Input
            id="settings-currentPassword"
            label={copy.auth.currentPasswordLabel}
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />

          <Input
            id="settings-newPassword"
            label={copy.auth.newPasswordLabel}
            type="password"
            autoComplete="new-password"
            required
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            helperText="Minimum 10 characters (SEC-023)"
          />

          <Button
            type="submit"
            variant="primary"
            isLoading={isChangingPassword}
          >
            {copy.settings.changePasswordBtn}
          </Button>
        </form>
      </section>

      {/* Active Sessions Section */}
      <section className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-neutral-100 dark:border-neutral-700">
          <Smartphone className="w-5 h-5 text-primary-600 dark:text-primary-400" aria-hidden="true" />
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            {copy.settings.sessionsSection}
          </h2>
        </div>

        {isLoadingSessions ? (
          <p className="text-xs text-neutral-500">{copy.loading}</p>
        ) : (
          <div className="divide-y divide-neutral-100 dark:divide-neutral-700">
            {sessions.map((sess) => (
              <div key={sess.id} className="py-3 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                    {sess.userAgent.slice(0, 50)}…
                  </p>
                  <p className="text-[11px] text-neutral-500">
                    IP: {sess.ip} • Last seen {new Date(sess.lastSeenAt).toLocaleDateString()}
                  </p>
                </div>
                {sess.isCurrent ? (
                  <span className="text-xs bg-primary-100 text-primary-700 dark:bg-primary-950 dark:text-primary-300 px-2 py-0.5 rounded-full font-medium">
                    {copy.settings.currentSessionBadge}
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleRevokeSession(sess.id)}
                  >
                    {copy.settings.revokeSession}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Blocked Accounts Section */}
      <section className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-neutral-100 dark:border-neutral-700">
          <Ban className="w-5 h-5 text-primary-600 dark:text-primary-400" aria-hidden="true" />
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            {copy.settings.blocksSection}
          </h2>
        </div>

        {blocks.length === 0 ? (
          <p className="text-xs text-neutral-500">{copy.settings.noBlocks}</p>
        ) : (
          <div className="divide-y divide-neutral-100 dark:divide-neutral-700">
            {blocks.map((b) => (
              <div key={b.id} className="py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Avatar
                    username={b.blockedUser.username}
                    displayName={b.blockedUser.displayName}
                    avatarUrl={b.blockedUser.avatarUrl}
                    size="sm"
                  />
                  <div>
                    <p className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                      {b.blockedUser.displayName}
                    </p>
                    <p className="text-[11px] text-neutral-500">
                      @{b.blockedUser.username}
                    </p>
                  </div>
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleUnblock(b.blockedUser.username)}
                >
                  {copy.settings.unblockBtn}
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* GDPR Data Export Section */}
      <section className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-6 shadow-sm space-y-3">
        <div className="flex items-center gap-2 pb-3 border-b border-neutral-100 dark:border-neutral-700">
          <Download className="w-5 h-5 text-primary-600 dark:text-primary-400" aria-hidden="true" />
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            {copy.settings.exportSection}
          </h2>
        </div>

        <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">
          {copy.settings.exportDescription}
        </p>

        <Button
          type="button"
          variant="outline"
          onClick={handleExportData}
          icon={<Download className="w-4 h-4" aria-hidden="true" />}
        >
          {copy.settings.downloadExportBtn}
        </Button>
      </section>

      {/* Danger Zone: Account Deletion */}
      <section className="bg-red-50/50 dark:bg-red-950/20 rounded-xl border border-red-200 dark:border-red-900/60 p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-red-200 dark:border-red-900/40 text-red-700 dark:text-red-400">
          <AlertOctagon className="w-5 h-5 shrink-0" aria-hidden="true" />
          <h2 className="text-base font-semibold">
            {copy.settings.dangerZone}
          </h2>
        </div>

        <p className="text-xs text-red-700 dark:text-red-300 leading-relaxed">
          {copy.settings.deleteDescription}
        </p>

        {deleteError && (
          <div className="rounded-lg bg-red-100 dark:bg-red-950/60 p-2 text-xs text-red-800 dark:text-red-200">
            {deleteError}
          </div>
        )}

        <form onSubmit={handleDeleteAccount} className="space-y-3 max-w-sm">
          <Input
            id="delete-confirm-password"
            label={copy.settings.deleteConfirmPassword}
            type="password"
            required
            value={deletePassword}
            onChange={(e) => setDeletePassword(e.target.value)}
          />

          <Button
            type="submit"
            variant="danger"
            isLoading={isDeletingAccount}
          >
            {copy.settings.deleteAccountBtn}
          </Button>
        </form>
      </section>
    </div>
  );
};
