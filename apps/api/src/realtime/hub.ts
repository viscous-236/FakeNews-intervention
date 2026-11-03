/** In-process direct-message socket fan-out. */

import WebSocket from 'ws';

const connections = new Map<string, Set<WebSocket>>();

export function addConnection(userId: string, socket: WebSocket): void {
  const userConnections = connections.get(userId) ?? new Set<WebSocket>();
  userConnections.add(socket);
  connections.set(userId, userConnections);
}

export function removeConnection(userId: string, socket: WebSocket): void {
  const userConnections = connections.get(userId);
  if (!userConnections) return;
  userConnections.delete(socket);
  if (userConnections.size === 0) connections.delete(userId);
}

export function sendToUser(userId: string, payload: unknown): void {
  const encoded = JSON.stringify(payload);
  for (const socket of connections.get(userId) ?? []) {
    if (socket.readyState === WebSocket.OPEN) socket.send(encoded);
  }
}

export function closeAllConnections(): void {
  for (const userConnections of connections.values()) {
    for (const socket of userConnections) socket.close(1001, 'Server shutting down');
  }
  connections.clear();
}
