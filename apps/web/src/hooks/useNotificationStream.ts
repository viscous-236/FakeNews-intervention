import { useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { NotificationItem } from '../types';

export function useNotificationStream(onNotification: (notif: NotificationItem) => void) {
  const { me } = useAuth();
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!me) return;

    const sse = new EventSource('/api/v1/notifications/stream', {
      withCredentials: true,
    });

    sse.addEventListener('notification', (event) => {
      try {
        const parsed = JSON.parse(event.data) as NotificationItem;
        onNotification(parsed);
      } catch (err) {
        console.error('Failed to parse SSE notification:', err);
      }
    });

    sse.onerror = (_err) => {
      // Browser automatically attempts reconnect with backoff
    };

    eventSourceRef.current = sse;

    return () => {
      sse.close();
      eventSourceRef.current = null;
    };
  }, [me, onNotification]);
}
