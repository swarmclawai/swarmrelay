import type {
  Contact,
  Conversation,
  Message,
  MessageReceipt,
  PresenceInfo,
} from '@swarmrelay/shared';

/**
 * MessagingBackend is the abstraction between the MCP tool layer and the
 * actual SwarmRelay implementation. Both the HTTP-based SwarmRelayClient
 * (client-side, local agent) and the server-side direct-call adapter
 * (hosted MCP endpoint) implement this interface.
 *
 * The SDK's SwarmRelayClient already conforms to this shape structurally —
 * there is no runtime adapter needed for the client-side path.
 */
export interface MessagingBackend {
  contacts: ContactOps;
  conversations: ConversationOps;
  messages: MessageOps;
  presence: PresenceOps;

  /**
   * If the backend knows the caller's private key, it may return it here
   * so tools that encrypt client-side can use it directly. Server-side
   * backends that perform encryption internally should omit this method
   * so encrypted-DM tools delegate to the backend's sendEncrypted helper.
   */
  getPrivateKey?(): string | undefined;
}

export interface Pagination {
  limit?: number;
  offset?: number;
}

export interface ContactOps {
  list(params?: Pagination): Promise<{ data: Contact[] }>;
  add(params: {
    agentId?: string;
    publicKey?: string;
    nickname?: string;
  }): Promise<Contact>;
  get(id: string): Promise<Contact>;
  update(id: string, params: { nickname?: string; notes?: string }): Promise<Contact>;
  remove(id: string): Promise<{ success: boolean }>;
  block(id: string): Promise<Contact>;
  unblock(id: string): Promise<Contact>;
}

export interface ConversationOps {
  list(params?: Pagination): Promise<{ data: Conversation[] }>;
  create(params: {
    type: 'dm' | 'group';
    members: string[];
    name?: string;
    description?: string;
  }): Promise<Conversation>;
  createGroup(params: {
    name: string;
    members: string[];
    description?: string;
  }): Promise<Conversation>;
  get(id: string): Promise<Conversation & { members: unknown[] }>;
  update(id: string, params: { name?: string; description?: string }): Promise<Conversation>;
  leave(id: string): Promise<{ success: boolean }>;
  addMembers(id: string, members: string[]): Promise<{ success: boolean }>;
  removeMember(id: string, agentId: string): Promise<{ success: boolean }>;
  rotateKey(id: string): Promise<{ groupKeyVersion: number }>;
}

export interface MessageOps {
  list(conversationId: string, params?: Pagination): Promise<{ data: Message[] }>;
  send(params: {
    conversationId: string;
    type?: string;
    ciphertext: string;
    nonce: string;
    signature: string;
    replyToId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<Message>;
  sendEncrypted(params: {
    conversationId: string;
    recipientPublicKey: string;
    plaintext: string;
    type?: string;
  }): Promise<Message>;
  edit(
    messageId: string,
    params: { ciphertext: string; nonce: string; signature: string },
  ): Promise<Message>;
  delete(messageId: string): Promise<{ success: boolean }>;
  sendReceipt(messageId: string, status: 'delivered' | 'read'): Promise<MessageReceipt>;
}

export interface PresenceOps {
  set(status: 'online' | 'offline' | 'away'): Promise<{ success: boolean }>;
  get(agentId: string): Promise<PresenceInfo>;
  getAll(): Promise<{ data: PresenceInfo[] }>;
}
