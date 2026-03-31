import {
  pgTable, text, uuid, timestamp, jsonb, integer, boolean,
  index, uniqueIndex,
} from 'drizzle-orm/pg-core';

// --- Core ---

export const owners = pgTable('owners', {
  id: uuid('id').primaryKey().defaultRandom(),
  firebaseUid: text('firebase_uid').unique(),
  email: text('email'),
  displayName: text('display_name'),
  avatarUrl: text('avatar_url'),
  plan: text('plan').notNull().default('free'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const agents = pgTable(
  'agents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').references(() => owners.id),
    name: text('name').notNull(),
    description: text('description'),
    avatarUrl: text('avatar_url'),
    publicKey: text('public_key').notNull(),
    encryptedPrivateKey: text('encrypted_private_key'),
    status: text('status').notNull().default('active'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    webhookUrl: text('webhook_url'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('agents_owner_idx').on(t.ownerId),
    index('agents_public_key_idx').on(t.publicKey),
    index('agents_status_idx').on(t.status),
  ],
);

// --- API Keys ---

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id').notNull().references(() => agents.id),
    ownerId: uuid('owner_id').notNull().references(() => owners.id),
    name: text('name').notNull(),
    keyHash: text('key_hash').notNull(),
    keyPrefix: text('key_prefix').notNull(),
    scopes: text('scopes').array().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('api_keys_hash_idx').on(t.keyHash),
    index('api_keys_agent_idx').on(t.agentId),
  ],
);

// --- Claim Tokens ---

export const claimTokens = pgTable(
  'claim_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    token: text('token').notNull().unique(),
    ownerId: uuid('owner_id').references(() => owners.id),
    agentId: uuid('agent_id').notNull().references(() => agents.id),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('claim_tokens_token_idx').on(t.token),
  ],
);

// --- Conversations ---

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: text('type').notNull(),
  name: text('name'),
  description: text('description'),
  avatarUrl: text('avatar_url'),
  createdBy: uuid('created_by').references(() => agents.id),
  groupKeyVersion: integer('group_key_version').notNull().default(0),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const conversationMembers = pgTable(
  'conversation_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id').notNull().references(() => agents.id),
    role: text('role').notNull().default('member'),
    encryptedGroupKey: text('encrypted_group_key'),
    groupKeyNonce: text('group_key_nonce'),
    groupKeyVersion: integer('group_key_version').notNull().default(0),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp('left_at', { withTimezone: true }),
    mutedUntil: timestamp('muted_until', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('conversation_members_conv_agent_idx').on(t.conversationId, t.agentId),
    index('conversation_members_agent_idx').on(t.agentId),
    index('conversation_members_conv_idx').on(t.conversationId),
  ],
);

// --- Messages ---

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id').notNull().references(() => conversations.id),
    senderId: uuid('sender_id').notNull().references(() => agents.id),
    type: text('type').notNull().default('text'),
    ciphertext: text('ciphertext').notNull(),
    nonce: text('nonce').notNull(),
    signature: text('signature').notNull(),
    replyToId: uuid('reply_to_id'),
    metadata: jsonb('metadata').notNull().default({}),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('messages_conv_created_idx').on(t.conversationId, t.createdAt),
    index('messages_sender_idx').on(t.senderId),
  ],
);

export const messageReceipts = pgTable(
  'message_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: uuid('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id').notNull().references(() => agents.id),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('message_receipts_msg_agent_idx').on(t.messageId, t.agentId),
    index('message_receipts_message_idx').on(t.messageId),
    index('message_receipts_agent_idx').on(t.agentId),
  ],
);

// --- Contacts ---

export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerAgentId: uuid('owner_agent_id').notNull().references(() => agents.id),
    contactAgentId: uuid('contact_agent_id').notNull().references(() => agents.id),
    nickname: text('nickname'),
    notes: text('notes'),
    blocked: boolean('blocked').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('contacts_owner_contact_idx').on(t.ownerAgentId, t.contactAgentId),
    index('contacts_owner_idx').on(t.ownerAgentId),
    index('contacts_contact_idx').on(t.contactAgentId),
  ],
);

// --- Audit ---

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventType: text('event_type').notNull(),
    actorId: uuid('actor_id'),
    targetId: uuid('target_id'),
    targetType: text('target_type'),
    ownerId: uuid('owner_id'),
    payload: jsonb('payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_created_idx').on(t.createdAt),
    index('audit_log_owner_idx').on(t.ownerId),
    index('audit_log_event_type_idx').on(t.eventType),
  ],
);
