import React, { useState, useEffect } from 'react';
import { Avatar } from '../../components/ui/Avatar';
import { TierBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { copy } from '../../copy';
import { UserSummary, UserStatus, PaginatedResponse } from '../../types';
import { api } from '../../api/client';
import { Users, Search, Loader2 } from 'lucide-react';

interface AdminUserItem extends UserSummary {
  email: string;
  status: UserStatus;
  createdAt: string;
}

export const AdminUsersPage: React.FC = () => {
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = async (q?: string) => {
    try {
      setIsLoading(true);
      const res = await api.get<PaginatedResponse<AdminUserItem>>('/api/v1/admin/users', q ? { q } : undefined);
      setUsers(res.items);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : copy.error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchUsers();
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    void fetchUsers(search.trim());
  };

  const handleSuspendToggle = async (user: AdminUserItem) => {
    const isSuspended = user.status === 'suspended';
    const reason = window.prompt(copy.admin.users.suspendReasonPrompt, isSuspended ? 'Account unsuspended' : 'Terms violation');
    if (!reason) return;

    try {
      const endpoint = isSuspended
        ? `/api/v1/admin/users/${user.id}/unsuspend`
        : `/api/v1/admin/users/${user.id}/suspend`;
      await api.post(endpoint, { reason });
      setUsers((prev) =>
        prev.map((u) =>
          u.id === user.id ? { ...u, status: isSuspended ? 'active' : 'suspended' } : u
        )
      );
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : copy.error);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
            <Users className="w-5 h-5 text-primary-600" aria-hidden="true" />
            <span>{copy.admin.users.title}</span>
          </h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            Audit contributor accounts, review reputation standing, or execute audited suspensions.
          </p>
        </div>

        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            type="search"
            placeholder={copy.admin.users.searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-1.5 text-xs text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <Button size="sm" variant="outline" type="submit" icon={<Search className="w-3.5 h-3.5" aria-hidden="true" />}>
            Search
          </Button>
        </form>
      </div>

      {isLoading ? (
        <div className="py-16 text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary-600" aria-hidden="true" />
          <p className="mt-3 text-sm text-neutral-500">{copy.loading}</p>
        </div>
      ) : error ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 p-6 text-center text-sm text-red-700 dark:text-red-300"
        >
          {error}
        </div>
      ) : (
        <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 shadow-sm overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-neutral-50 dark:bg-neutral-850 border-b border-neutral-200 dark:border-neutral-700 text-neutral-500 uppercase font-semibold">
              <tr>
                <th className="py-3 px-4">User</th>
                <th className="py-3 px-3">Email</th>
                <th className="py-3 px-3">Tier</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-3">Joined</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-700">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-750">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <Avatar
                        username={u.username}
                        displayName={u.displayName}
                        avatarUrl={u.avatarUrl}
                        size="sm"
                      />
                      <div>
                        <span className="font-semibold block text-neutral-900 dark:text-neutral-100">
                          {u.displayName}
                        </span>
                        <span className="text-neutral-400">@{u.username}</span>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-3 text-neutral-500">{u.email}</td>
                  <td className="py-3 px-3">
                    <TierBadge tier={u.tier} />
                  </td>
                  <td className="py-3 px-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                        u.status === 'suspended'
                          ? 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300'
                          : 'bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-300'
                      }`}
                    >
                      {u.status}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-neutral-400">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <Button
                      size="sm"
                      variant={u.status === 'suspended' ? 'outline' : 'danger'}
                      onClick={() => handleSuspendToggle(u)}
                    >
                      {u.status === 'suspended'
                        ? copy.admin.users.unsuspendBtn
                        : copy.admin.users.suspendBtn}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
