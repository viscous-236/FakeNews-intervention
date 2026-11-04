import { useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';

export interface WsMessageEvent {
  type: string;
  data: Record<string, unknown>;
}

export function useWebSocket(onEvent: (event: WsMessageEvent) => void) {
  const { me } = useAuth();
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!me) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    const socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      // Authenticated via session cookie
    };

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as WsMessageEvent;
        onEvent(payload);
      } catch (err) {
        console.error('Failed to parse websocket payload:', err);
      }
    };

    socket.onerror = () => {
      // Handled silently
    };

    socketRef.current = socket;

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [me, onEvent]);
}
