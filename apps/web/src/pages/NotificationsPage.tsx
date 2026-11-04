import React, { useState, useEffect, useCallback } from 'react';
import { useNotificationStream } from '../hooks/useNotificationStream';
import { Button } from '../components/ui/Button';
import { copy } from '../copy';
import { NotificationItem, PaginatedResponse } from '../types';
import { api } from '../api/client';
import {
  Bell,
  CheckCheck,
  ShieldAlert,
  AlertTriangle,
  Repeat,
  Heart,
  MessageCircle,
  UserPlus,
  Scale,
  Waves,
  Loader2,
} from 'lucide-react';

export const NotificationsPage: React.FC = () => {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isMarkingAll, setIsMarkingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await api.get<PaginatedResponse<NotificationItem>>('/api/v1/notifications');
      setNotifications(res.items);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : copy.error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchNotifications();
  }, [fetchNotifications]);

  // Hook up real-time stream (SSE)
  useNotificationStream(
    useCallback((newNotif: NotificationItem) => {
      setNotifications((prev) => [newNotif, ...prev]);
    }, [])
  );

  const handleMarkAsRead = async (id: string) => {
    try {
      await api.post(`/api/v1/notifications/${id}/read`);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
    } catch {
      // ignore
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      setIsMarkingAll(true);
      await api.post('/api/v1/notifications/read-all');
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : copy.error);
    } finally {
      setIsMarkingAll(false);
    }
  };

  const renderIcon = (type: NotificationItem['type']) => {
    switch (type) {
      case 'post_flagged':
        return <ShieldAlert className="w-4 h-4 text-amber-500" aria-hidden="true" />;
      case 'assessment_decided':
        return <Scale className="w-4 h-4 text-primary-500" aria-hidden="true" />;
      case 'wave_finalized':
        return <Waves className="w-4 h-4 text-blue-500" aria-hidden="true" />;
      case 'appeal_opened':
      case 'appeal_resolved':
        return <AlertTriangle className="w-4 h-4 text-purple-500" aria-hidden="true" />;
      case 'like':
        return <Heart className="w-4 h-4 text-red-500 fill-current" aria-hidden="true" />;
      case 'reshare':
        return <Repeat className="w-4 h-4 text-green-500" aria-hidden="true" />;
      case 'comment':
        return <MessageCircle className="w-4 h-4 text-blue-400" aria-hidden="true" />;
      case 'new_follower':
        return <UserPlus className="w-4 h-4 text-primary-400" aria-hidden="true" />;
      default:
        return <Bell className="w-4 h-4 text-neutral-400" aria-hidden="true" />;
    }
  };

  const renderNotificationText = (notif: NotificationItem) => {
    const data = notif.data as Record<string, string>;
    switch (notif.type) {
      case 'post_flagged':
        return 'Your post was automatically flagged as potentially misleading and scheduled for independent review.';
      case 'assessment_decided':
        return `A fact-checker assessment was recorded: verdict ${data.verdict || ''}.`;
      case 'appeal_resolved':
        return `Your appeal for event #${data.eventId || ''} was resolved (${data.status || ''}).`;
      case 'appeal_opened':
        return 'Your penalty appeal has been logged and the negative event is frozen pending review.';
      case 'wave_finalized':
        return `Reputation Wave #${data.waveNumber || ''} has been finalized. Review your score delta in the ledger.`;
      case 'like':
        return `@${data.actorUsername || 'Someone'} liked your post.`;
      case 'reshare':
        return `@${data.actorUsername || 'Someone'} shared your post.`;
      case 'comment':
        return `@${data.actorUsername || 'Someone'} commented on your post.`;
      case 'new_follower':
        return `@${data.actorUsername || 'Someone'} started following you.`;
      default:
        return 'New platform notification.';
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between pb-2 border-b border-neutral-200 dark:border-neutral-700">
        <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
          <Bell className="w-5 h-5 text-primary-600 dark:text-primary-400" aria-hidden="true" />
          <span>{copy.app.nav.notifications}</span>
        </h1>

        {notifications.some((n) => !n.read) && (
          <Button
            size="sm"
            variant="ghost"
            onClick={handleMarkAllAsRead}
            isLoading={isMarkingAll}
            icon={<CheckCheck className="w-4 h-4" aria-hidden="true" />}
          >
            Mark all as read
          </Button>
        )}
      </div>

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
      ) : notifications.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 p-12 text-center text-xs text-neutral-500 bg-white dark:bg-neutral-800">
          No notifications yet.
        </div>
      ) : (
        <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 divide-y divide-neutral-100 dark:divide-neutral-700 shadow-sm overflow-hidden">
          {notifications.map((notif) => (
            <div
              key={notif.id}
              onClick={() => {
                if (!notif.read) void handleMarkAsRead(notif.id);
              }}
              className={`p-4 flex items-start gap-3 transition-colors cursor-pointer ${
                notif.read
                  ? 'bg-transparent hover:bg-neutral-50 dark:hover:bg-neutral-750'
                  : 'bg-primary-50/50 dark:bg-primary-950/20 hover:bg-primary-50 dark:hover:bg-primary-950/40'
              }`}
            >
              <div className="p-2 rounded-full bg-neutral-100 dark:bg-neutral-700 shrink-0">
                {renderIcon(notif.type)}
              </div>

              <div className="flex-1 min-w-0">
                <p className={`text-xs ${notif.read ? 'text-neutral-700 dark:text-neutral-300' : 'font-semibold text-neutral-900 dark:text-neutral-100'}`}>
                  {renderNotificationText(notif)}
                </p>
                <time className="text-[11px] text-neutral-400 mt-1 block">
                  {new Date(notif.createdAt).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              </div>

              {!notif.read && (
                <span className="w-2 h-2 rounded-full bg-primary-600 shrink-0 mt-1.5" aria-hidden="true" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
