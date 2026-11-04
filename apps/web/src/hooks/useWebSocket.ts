/**
 * Direct-message socket (REQ-042). Authenticated by the session cookie on
 * upgrade; reconnects with exponential backoff from 1 s to 30 s.
 */

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import type { MessageItem } from '../types';

export type WsEvent =
  | { type: 'ready' }
  | { type: 'message'; message: MessageItem }
  | { type: 'messages_read'; readerId: string; messageIds: string[] };

export type SocketState = 'connecting' | 'open' | 'reconnecting';

export function useWebSocket(onEvent: (event: WsEvent) => void): SocketState {
  const { me } = useAuth();
  const [state, setState] = useState<SocketState>('connecting');
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!me) return;
    let socket: WebSocket | null = null;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
      socket.onopen = () => {
        attempt = 0;
        setState('open');
      };
      socket.onmessage = (event) => {
        try {
          handlerRef.current(JSON.parse(event.data) as WsEvent);
        } catch {
          // ignore malformed frames
        }
      };
      socket.onclose = () => {
        if (closed) return;
        setState('reconnecting');
        const delay = Math.min(30_000, 1000 * 2 ** attempt);
        attempt += 1;
        timer = setTimeout(connect, delay);
      };
      socket.onerror = () => {
        socket?.close();
      };
    }

    connect();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      socket?.close();
    };
  }, [me]);

  return state;
}
