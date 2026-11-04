/**
 * Live notifications over SSE (REQ-041). The browser reconnects EventSource
 * with its own backoff; while the stream is down we fall back to polling
 * GET /notifications/unread-count every 30 s (plan Section 1.1).
 */

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { keys } from '../api/hooks';
import type { NotificationItem } from '../types';

export type StreamState = 'connecting' | 'live' | 'polling';

export function useNotificationStream(
  onNotification?: (notif: NotificationItem) => void,
): StreamState {
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const [state, setState] = useState<StreamState>('connecting');
  const handlerRef = useRef(onNotification);
  handlerRef.current = onNotification;

  useEffect(() => {
    if (!me) return;
    const sse = new EventSource('/api/v1/notifications/stream', { withCredentials: true });

    sse.onopen = () => setState('live');
    sse.onerror = () => setState('polling');
    sse.addEventListener('notification', (event) => {
      try {
        const parsed = JSON.parse((event as MessageEvent).data) as NotificationItem;
        handlerRef.current?.(parsed);
        void queryClient.invalidateQueries({ queryKey: keys.unreadCount });
        void queryClient.invalidateQueries({ queryKey: keys.notifications });
        if (
          parsed.type === 'wave_finalized' ||
          parsed.type === 'assessment_decided' ||
          parsed.type === 'appeal_resolved'
        ) {
          void queryClient.invalidateQueries({ queryKey: keys.score });
          void queryClient.invalidateQueries({ queryKey: keys.events });
        }
        if (parsed.type === 'message') {
          void queryClient.invalidateQueries({ queryKey: keys.conversations });
        }
      } catch {
        // Malformed frame: ignore and keep the stream open.
      }
    });

    return () => {
      sse.close();
      setState('connecting');
    };
  }, [me, queryClient]);

  return state;
}
