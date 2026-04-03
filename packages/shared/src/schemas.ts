import { z } from 'zod';
import {
  CONVERSATION_TYPES, MEMBER_ROLES, MESSAGE_TYPES, PRESENCE_STATUSES,
  API_KEY_SCOPES, RECEIPT_STATUSES, A2A_TASK_STATUSES,
} from './constants.js';

// --- Pagination ---

export const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

// --- Registration & Auth ---

export const RegisterSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  publicKey: z.string().optional(),
});

export const ChallengeSchema = z.object({
  publicKey: z.string().min(1),
});

export const VerifySchema = z.object({
  publicKey: z.string().min(1),
  challenge: z.string().min(1),
  signature: z.string().min(1),
});

export const ClaimSchema = z.object({
  claimToken: z.string().min(1).max(20),
});

// --- Agents ---

export const AgentCreateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(2000).optional(),
  avatarUrl: z.string().url().optional(),
  webhookUrl: z.string().url().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const AgentUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(2000).optional(),
  avatarUrl: z.string().url().optional(),
  webhookUrl: z.string().url().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// --- API Keys ---

export const ApiKeyCreateSchema = z.object({
  name: z.string().min(1).max(100),
  agentId: z.string().uuid(),
  scopes: z.array(z.enum(API_KEY_SCOPES)).min(1),
  expiresAt: z.string().datetime().optional(),
});

// --- Contacts ---

export const ContactCreateSchema = z.object({
  agentId: z.string().uuid().optional(),
  publicKey: z.string().optional(),
  nickname: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
}).refine((d) => d.agentId || d.publicKey, { message: 'Either agentId or publicKey is required' });

export const ContactUpdateSchema = z.object({
  nickname: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
});

// --- Conversations ---

export const ConversationCreateSchema = z.object({
  type: z.enum(CONVERSATION_TYPES),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(2000).optional(),
  members: z.array(z.string().uuid()).min(1),
});

export const ConversationUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(2000).optional(),
});

export const ConversationListSchema = PaginationSchema.extend({
  after: z.string().datetime().optional(),
});

// --- Messages ---

export const MessageSendSchema = z.object({
  type: z.enum(MESSAGE_TYPES).default('text'),
  ciphertext: z.string().min(1),
  nonce: z.string().min(1),
  signature: z.string().min(1),
  replyToId: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const MessageEditSchema = z.object({
  ciphertext: z.string().min(1),
  nonce: z.string().min(1),
  signature: z.string().min(1),
});

export const MessageListSchema = PaginationSchema.extend({
  before: z.string().datetime().optional(),
  after: z.string().datetime().optional(),
});

// --- Receipts ---

export const ReceiptCreateSchema = z.object({
  status: z.enum(RECEIPT_STATUSES),
});

// --- Presence ---

export const PresenceUpdateSchema = z.object({
  status: z.enum(PRESENCE_STATUSES),
});

// --- Typing ---

export const TypingSchema = z.object({
  conversationId: z.string().uuid(),
  typing: z.boolean(),
});

// --- Directory ---

export const DirectorySearchSchema = z.object({
  q: z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

// --- Add Members ---

export const AddMembersSchema = z.object({
  members: z.array(z.string().uuid()).min(1),
});

// --- A2A Protocol ---

export const A2AJsonRpcSchema = z.object({
  jsonrpc: z.literal('2.0').default('2.0'),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.enum(['sendMessage', 'getStatus', 'cancelTask', 'getResult', 'discoverAgent']),
  params: z.record(z.unknown()),
});

export const A2ASendMessageParamsSchema = z.object({
  fromAgent: z.string().min(1),
  toAgent: z.string().min(1),
  message: z.unknown(),
  taskId: z.string().optional(),
  correlationId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const A2AGetStatusParamsSchema = z.object({
  taskId: z.string().optional(),
  correlationId: z.string().optional(),
}).refine((d) => d.taskId || d.correlationId, { message: 'Either taskId or correlationId is required' });

export const A2ACancelTaskParamsSchema = z.object({
  taskId: z.string().min(1),
  reason: z.string().optional(),
});

export const A2ADiscoverAgentParamsSchema = z.object({
  agentId: z.string().optional(),
  agentUrl: z.string().url().optional(),
  publicKey: z.string().optional(),
}).refine((d) => d.agentId || d.agentUrl || d.publicKey, { message: 'At least one identifier required' });

// --- Inferred Types ---

export type Register = z.infer<typeof RegisterSchema>;
export type Challenge = z.infer<typeof ChallengeSchema>;
export type Verify = z.infer<typeof VerifySchema>;
export type Claim = z.infer<typeof ClaimSchema>;
export type AgentCreate = z.infer<typeof AgentCreateSchema>;
export type AgentUpdate = z.infer<typeof AgentUpdateSchema>;
export type ApiKeyCreate = z.infer<typeof ApiKeyCreateSchema>;
export type ContactCreate = z.infer<typeof ContactCreateSchema>;
export type ContactUpdate = z.infer<typeof ContactUpdateSchema>;
export type ConversationCreate = z.infer<typeof ConversationCreateSchema>;
export type ConversationUpdate = z.infer<typeof ConversationUpdateSchema>;
export type MessageSend = z.infer<typeof MessageSendSchema>;
export type MessageEdit = z.infer<typeof MessageEditSchema>;
export type ReceiptCreate = z.infer<typeof ReceiptCreateSchema>;
export type PresenceUpdate = z.infer<typeof PresenceUpdateSchema>;
export type Typing = z.infer<typeof TypingSchema>;
export type DirectorySearch = z.infer<typeof DirectorySearchSchema>;
export type AddMembers = z.infer<typeof AddMembersSchema>;
export type A2AJsonRpc = z.infer<typeof A2AJsonRpcSchema>;
export type A2ASendMessageParams = z.infer<typeof A2ASendMessageParamsSchema>;
export type A2AGetStatusParams = z.infer<typeof A2AGetStatusParamsSchema>;
export type A2ACancelTaskParams = z.infer<typeof A2ACancelTaskParamsSchema>;
export type A2ADiscoverAgentParams = z.infer<typeof A2ADiscoverAgentParamsSchema>;
