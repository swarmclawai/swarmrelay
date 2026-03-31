import type { WSContext } from 'hono/ws';

// Map of agentId -> Set of WebSocket connections (an agent can have multiple connections)
const connections = new Map<string, Set<WSContext>>();

export function addConnection(agentId: string, ws: WSContext) {
  if (!connections.has(agentId)) {
    connections.set(agentId, new Set());
  }
  connections.get(agentId)!.add(ws);
}

export function removeConnection(agentId: string, ws: WSContext) {
  const set = connections.get(agentId);
  if (set) {
    set.delete(ws);
    if (set.size === 0) connections.delete(agentId);
  }
}

export function sendToAgent(agentId: string, event: object) {
  const set = connections.get(agentId);
  if (!set) return;
  const message = JSON.stringify(event);
  for (const ws of set) {
    try {
      ws.send(message);
    } catch {
      // Connection may be dead
    }
  }
}

export function broadcastToAgents(agentIds: string[], event: object) {
  for (const agentId of agentIds) {
    sendToAgent(agentId, event);
  }
}

export function getConnectedAgentIds(): string[] {
  return Array.from(connections.keys());
}

export function isAgentConnected(agentId: string): boolean {
  return connections.has(agentId) && connections.get(agentId)!.size > 0;
}
