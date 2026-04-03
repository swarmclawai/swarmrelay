// --- Agent Status ---

export const AGENT_STATUSES = ['active', 'suspended', 'deleted'] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

// --- Conversation ---

export const CONVERSATION_TYPES = ['dm', 'group'] as const;
export type ConversationType = (typeof CONVERSATION_TYPES)[number];

export const MEMBER_ROLES = ['admin', 'member'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

// --- Messages ---

export const MESSAGE_TYPES = ['text', 'file', 'task_request', 'task_response', 'system', 'structured'] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

// --- Presence ---

export const PRESENCE_STATUSES = ['online', 'offline', 'away'] as const;
export type PresenceStatus = (typeof PRESENCE_STATUSES)[number];

// --- API Key Scopes ---

export const API_KEY_SCOPES = [
  'messages.read', 'messages.write',
  'contacts.read', 'contacts.write',
  'groups.read', 'groups.write',
  'presence.write',
] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

// --- Auth ---

export const API_KEY_PREFIX = 'rl_live_';
export const CLAIM_TOKEN_PREFIX = 'SIG';
export const CLAIM_TOKEN_EXPIRY_DAYS = 30;
export const JWT_EXPIRY_HOURS = 24;
export const CHALLENGE_TTL_SECONDS = 300;

// --- Rate Limits ---

export const RATE_LIMIT_DEFAULT = 120;
export const RATE_LIMIT_MESSAGES = 60;
export const RATE_LIMIT_REGISTER = 10;

// --- Real-Time ---

export const HEARTBEAT_INTERVAL_MS = 30_000;
export const HEARTBEAT_TIMEOUT_MS = 90_000;
export const PRESENCE_TTL_SECONDS = 120;
export const TYPING_EXPIRE_SECONDS = 5;

// --- WebSocket Events ---

export const WS_EVENTS = {
  MESSAGE_NEW: 'message.new',
  MESSAGE_EDITED: 'message.edited',
  MESSAGE_DELETED: 'message.deleted',
  RECEIPT_DELIVERED: 'receipt.delivered',
  RECEIPT_READ: 'receipt.read',
  PRESENCE_UPDATE: 'presence.update',
  TYPING_START: 'typing.start',
  TYPING_STOP: 'typing.stop',
  GROUP_MEMBER_JOINED: 'group.member_joined',
  GROUP_MEMBER_LEFT: 'group.member_left',
  GROUP_KEY_ROTATED: 'group.key_rotated',
  CONVERSATION_CREATED: 'conversation.created',
} as const;
export type WsEventType = (typeof WS_EVENTS)[keyof typeof WS_EVENTS];

// --- Receipt Status ---

export const RECEIPT_STATUSES = ['delivered', 'read'] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

// --- A2A Protocol ---

export const A2A_TASK_STATUSES = ['submitted', 'working', 'completed', 'failed', 'cancelled'] as const;
export type A2ATaskStatus = (typeof A2A_TASK_STATUSES)[number];

export const A2A_METHODS = ['sendMessage', 'getStatus', 'cancelTask', 'getResult', 'discoverAgent'] as const;
export type A2AMethod = (typeof A2A_METHODS)[number];

export const A2A_PROTOCOL_VERSION = '0.3.0';
export const A2A_AGENT_CARD_CACHE_TTL = 86_400; // 24 hours
export const A2A_TASK_STATUS_CACHE_TTL = 604_800; // 7 days
