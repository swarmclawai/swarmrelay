import type {
  AgentStatus, ConversationType, MemberRole, MessageType,
  PresenceStatus, ApiKeyScope, ReceiptStatus, WsEventType,
} from './constants.js';

// --- Core ---

export interface Owner {
  id: string;
  firebaseUid: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  plan: string;
  createdAt: string;
  updatedAt: string;
}

export interface Agent {
  id: string;
  ownerId: string | null;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  publicKey: string;
  encryptedPrivateKey: string | null;
  status: AgentStatus;
  lastSeenAt: string | null;
  webhookUrl: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKey {
  id: string;
  agentId: string;
  ownerId: string;
  name: string;
  keyPrefix: string;
  scopes: ApiKeyScope[];
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface ClaimToken {
  id: string;
  token: string;
  ownerId: string | null;
  agentId: string;
  claimedAt: string | null;
  expiresAt: string;
  createdAt: string;
}

// --- Conversations ---

export interface Conversation {
  id: string;
  type: ConversationType;
  name: string | null;
  description: string | null;
  avatarUrl: string | null;
  createdBy: string | null;
  groupKeyVersion: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMember {
  id: string;
  conversationId: string;
  agentId: string;
  role: MemberRole;
  encryptedGroupKey: string | null;
  groupKeyNonce: string | null;
  groupKeyVersion: number;
  joinedAt: string;
  leftAt: string | null;
  mutedUntil: string | null;
}

// --- Messages ---

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  type: MessageType;
  ciphertext: string;
  nonce: string;
  signature: string;
  replyToId: string | null;
  metadata: Record<string, unknown>;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
}

export interface MessageReceipt {
  id: string;
  messageId: string;
  agentId: string;
  deliveredAt: string | null;
  readAt: string | null;
}

// --- Contacts ---

export interface Contact {
  id: string;
  ownerAgentId: string;
  contactAgentId: string;
  nickname: string | null;
  notes: string | null;
  blocked: boolean;
  createdAt: string;
}

// --- Audit ---

export interface AuditLogEntry {
  id: string;
  eventType: string;
  actorId: string | null;
  targetId: string | null;
  targetType: string | null;
  ownerId: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

// --- Auth Context ---

export interface AgentAuthPayload {
  ownerId: string;
  agentId: string;
  scopes: ApiKeyScope[];
  keyId: string;
}

export interface DashboardAuthPayload {
  ownerId: string;
  firebaseUid: string;
  email: string | null;
}

// --- Presence ---

export interface PresenceInfo {
  agentId: string;
  status: PresenceStatus;
  lastSeen: string;
}

export interface TypingEvent {
  conversationId: string;
  agentId: string;
  typing: boolean;
}

// --- Registration ---

export interface RegisterResponse {
  apiKey: string;
  agentId: string;
  ownerId: string;
  publicKey: string;
  privateKey?: string;
  claimToken: string;
  claimUrl: string;
}

export interface ChallengeResponse {
  challenge: string;
  expiresAt: string;
}

export interface VerifyResponse {
  token: string;
  agentId: string;
  expiresAt: string;
}

// --- Pagination ---

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

// --- WebSocket ---

export interface WebSocketMessage {
  event: WsEventType;
  data: Record<string, unknown>;
}

// --- A2A Protocol ---

export interface A2ATask {
  id: string;
  correlationId: string;
  conversationId: string;
  fromAgent: string;
  toAgent: string;
  status: 'submitted' | 'working' | 'completed' | 'failed' | 'cancelled';
  result: Record<string, unknown> | null;
  errorMessage: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface A2AAgentCard {
  id: string;
  publicKey: string;
  agentCard: Record<string, unknown>;
  apiEndpoint: string;
  isTrusted: boolean;
  discoveredAt: string;
  lastSeen: string;
}

export interface A2ASendMessageResponse {
  messageId: string;
  conversationId: string;
  taskId: string | null;
  status: 'delivered' | 'queued';
  encryptedAt: string;
}

export interface A2AGetStatusResponse {
  taskId: string;
  correlationId: string;
  conversationId: string;
  status: 'submitted' | 'working' | 'completed' | 'failed' | 'cancelled';
  messageCount: number;
  latestMessage?: {
    id: string;
    timestamp: string;
  };
  updatedAt: string;
}

export interface A2AJsonRpcResponse {
  jsonrpc: '2.0';
  id?: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}
