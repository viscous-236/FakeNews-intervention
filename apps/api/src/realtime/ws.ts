/** Authenticated WebSocket transport for direct messages (REQ-042). */

import { createHash } from 'node:crypto';
import { type IncomingMessage, type Server } from 'node:http';
import { type Duplex } from 'node:stream';
import { parse as parseUrl } from 'node:url';
import { WebSocketServer } from 'ws';
import { config } from '../config.js';
import { getPool } from '../db/pool.js';
import { addConnection, removeConnection } from './hub.js';

interface SocketUser {
  id: string;
}

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  socket.write(
    `HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
  socket.destroy();
}

function cookieValue(request: IncomingMessage, name: string): string | null {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return null;
  for (const pair of cookieHeader.split(';')) {
    const [key, ...value] = pair.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}

async function authenticateUpgrade(request: IncomingMessage): Promise<SocketUser | null> {
  const token = cookieValue(request, config.SESSION_COOKIE_NAME);
  if (!token) return null;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const result = await getPool().query<{ id: string }>(
    `SELECT u.id
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.expires_at > now()
        AND u.status = 'active'
        AND u.deleted_at IS NULL
        AND ($2::boolean = false OR u.email_verified_at IS NOT NULL)`,
    [tokenHash, config.REQUIRE_EMAIL_VERIFICATION],
  );
  return result.rows[0] ?? null;
}

export function attachWebSocketServer(server: Server): WebSocketServer {
  const webSocketServer = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const pathname = parseUrl(request.url ?? '').pathname;
    if (pathname !== '/ws') {
      socket.destroy();
      return;
    }

    const origin = request.headers.origin;
    if (origin !== config.APP_ORIGIN) {
      rejectUpgrade(socket, 403, 'Forbidden');
      return;
    }

    void authenticateUpgrade(request)
      .then((user) => {
        if (!user) {
          rejectUpgrade(socket, 401, 'Unauthorized');
          return;
        }
        webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
          addConnection(user.id, webSocket);
          webSocket.send(JSON.stringify({ type: 'ready' }));
          webSocket.on('close', () => removeConnection(user.id, webSocket));
          webSocket.on('error', () => removeConnection(user.id, webSocket));
        });
      })
      .catch(() => rejectUpgrade(socket, 503, 'Service Unavailable'));
  });

  return webSocketServer;
}
