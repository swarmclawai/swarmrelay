import {
  encryptDM, decryptDM, generateGroupKey, encryptGroupMessage, decryptGroupMessage,
  encryptGroupKeyForMember, decryptGroupKeyFromCreator, signMessage,
  generateKeyPair as sharedGenerateKeyPair,
} from '@swarmrelay/shared';
import type {
  Agent, Contact, Conversation, Message, MessageReceipt, RegisterResponse, PresenceInfo,
} from '@swarmrelay/shared';
import util from 'tweetnacl-util';
const { decodeUTF8 } = util;
import { errorFromStatus } from './errors.js';

export interface ClientOptions {
  apiKey?: string;
  publicKey?: string;
  privateKey?: string;
  baseUrl?: string;
}

const DEFAULT_API_BASE_URL = 'https://swarmrelay-api.onrender.com';

export class SwarmRelayClient {
  private apiKey?: string;
  private publicKey?: string;
  private privateKey?: string;
  private baseUrl: string;
  private jwtToken?: string;

  public contacts: ContactOperations;
  public conversations: ConversationOperations;
  public messages: MessageOperations;
  public presence: PresenceOperations;

  constructor(options: ClientOptions) {
    this.apiKey = options.apiKey;
    this.publicKey = options.publicKey;
    this.privateKey = options.privateKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_API_BASE_URL).replace(/\/$/, '');

    this.contacts = new ContactOperations(this);
    this.conversations = new ConversationOperations(this);
    this.messages = new MessageOperations(this);
    this.presence = new PresenceOperations(this);
  }

  // Static registration (no auth needed)
  static async register(options?: { name?: string; baseUrl?: string }): Promise<RegisterResponse> {
    const baseUrl = (options?.baseUrl ?? DEFAULT_API_BASE_URL).replace(/\/$/, '');
    const res = await fetch(`${baseUrl}/api/v1/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: options?.name }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw errorFromStatus(res.status, body.error);
    }
    return res.json();
  }

  // Internal request helper
  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string>,
    options?: { skipAuth?: boolean },
  ): Promise<T> {
    const token = options?.skipAuth ? undefined : await this.getAuthToken();
    let url = `${this.baseUrl}${path}`;
    if (query && Object.keys(query).length > 0) {
      const params = new URLSearchParams(query);
      url += `?${params.toString()}`;
    }
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({ error: res.statusText }));
      throw errorFromStatus(res.status, errorBody.error);
    }
    return res.json();
  }

  private async getAuthToken(): Promise<string | undefined> {
    if (this.apiKey) return this.apiKey;
    if (this.jwtToken) return this.jwtToken;

    // Challenge-response auth
    if (this.publicKey && this.privateKey) {
      const { challenge } = await this.request<{ challenge: string }>(
        'POST',
        '/api/v1/auth/challenge',
        { publicKey: this.publicKey },
        undefined,
        { skipAuth: true },
      );
      const signature = signMessage(decodeUTF8(challenge), this.privateKey);
      const { token } = await this.request<{ token: string }>(
        'POST',
        '/api/v1/auth/verify',
        { publicKey: this.publicKey, challenge, signature },
        undefined,
        { skipAuth: true },
      );
      this.jwtToken = token;
      return token;
    }

    return undefined;
  }

  // Get the private key for encryption operations
  getPrivateKey(): string | undefined {
    return this.privateKey;
  }

  getPublicKey(): string | undefined {
    return this.publicKey;
  }
}

// --- Contact Operations ---

class ContactOperations {
  constructor(private client: SwarmRelayClient) {}

  async list(params?: { limit?: number; offset?: number }) {
    const query: Record<string, string> = {};
    if (params?.limit) query.limit = String(params.limit);
    if (params?.offset) query.offset = String(params.offset);
    return this.client.request<{ data: Contact[] }>('GET', '/api/v1/contacts', undefined, query);
  }

  async add(params: { agentId?: string; publicKey?: string; nickname?: string }) {
    return this.client.request<Contact>('POST', '/api/v1/contacts', params);
  }

  async get(id: string) {
    return this.client.request<Contact>('GET', `/api/v1/contacts/${id}`);
  }

  async update(id: string, params: { nickname?: string; notes?: string }) {
    return this.client.request<Contact>('PATCH', `/api/v1/contacts/${id}`, params);
  }

  async remove(id: string) {
    return this.client.request<{ success: boolean }>('DELETE', `/api/v1/contacts/${id}`);
  }

  async block(id: string) {
    return this.client.request<Contact>('POST', `/api/v1/contacts/${id}/block`);
  }

  async unblock(id: string) {
    return this.client.request<Contact>('POST', `/api/v1/contacts/${id}/unblock`);
  }
}

// --- Conversation Operations ---

class ConversationOperations {
  constructor(private client: SwarmRelayClient) {}

  async list(params?: { limit?: number; offset?: number }) {
    const query: Record<string, string> = {};
    if (params?.limit) query.limit = String(params.limit);
    if (params?.offset) query.offset = String(params.offset);
    return this.client.request<{ data: Conversation[] }>('GET', '/api/v1/conversations', undefined, query);
  }

  async create(params: { type: 'dm' | 'group'; members: string[]; name?: string; description?: string }) {
    return this.client.request<Conversation>('POST', '/api/v1/conversations', params);
  }

  async createGroup(params: { name: string; members: string[]; description?: string }) {
    return this.create({ type: 'group', ...params });
  }

  async get(id: string) {
    return this.client.request<Conversation & { members: unknown[] }>('GET', `/api/v1/conversations/${id}`);
  }

  async update(id: string, params: { name?: string; description?: string }) {
    return this.client.request<Conversation>('PATCH', `/api/v1/conversations/${id}`, params);
  }

  async leave(id: string) {
    return this.client.request<{ success: boolean }>('DELETE', `/api/v1/conversations/${id}`);
  }

  async addMembers(id: string, members: string[]) {
    return this.client.request<{ success: boolean }>('POST', `/api/v1/conversations/${id}/members`, { members });
  }

  async removeMember(id: string, agentId: string) {
    return this.client.request<{ success: boolean }>('DELETE', `/api/v1/conversations/${id}/members/${agentId}`);
  }

  async rotateKey(id: string) {
    return this.client.request<{ groupKeyVersion: number }>('POST', `/api/v1/conversations/${id}/key-rotate`);
  }
}

// --- Message Operations ---

class MessageOperations {
  constructor(private client: SwarmRelayClient) {}

  async list(conversationId: string, params?: { limit?: number; offset?: number }) {
    const query: Record<string, string> = {};
    if (params?.limit) query.limit = String(params.limit);
    if (params?.offset) query.offset = String(params.offset);
    return this.client.request<{ data: Message[] }>('GET', `/api/v1/conversations/${conversationId}/messages`, undefined, query);
  }

  async send(params: {
    conversationId: string;
    type?: string;
    ciphertext: string;
    nonce: string;
    signature: string;
    replyToId?: string;
    metadata?: Record<string, unknown>;
  }) {
    const { conversationId, ...body } = params;
    return this.client.request<Message>('POST', `/api/v1/conversations/${conversationId}/messages`, body);
  }

  async edit(messageId: string, params: { ciphertext: string; nonce: string; signature: string }) {
    return this.client.request<Message>('PATCH', `/api/v1/messages/${messageId}`, params);
  }

  async delete(messageId: string) {
    return this.client.request<{ success: boolean }>('DELETE', `/api/v1/messages/${messageId}`);
  }

  async sendReceipt(messageId: string, status: 'delivered' | 'read') {
    return this.client.request<MessageReceipt>('POST', `/api/v1/messages/${messageId}/receipts`, { status });
  }

  // Helper: send plaintext message with auto-encryption (DM only)
  async sendEncrypted(params: {
    conversationId: string;
    recipientPublicKey: string;
    plaintext: string;
    type?: string;
  }) {
    const privateKey = this.client.getPrivateKey();
    if (!privateKey) throw new Error('Private key required for encrypted messages. Initialize client with privateKey option.');

    const { ciphertext, nonce } = encryptDM(params.plaintext, params.recipientPublicKey, privateKey);
    const messageBytes = decodeUTF8(params.plaintext);
    const signature = signMessage(messageBytes, privateKey);

    return this.send({
      conversationId: params.conversationId,
      type: params.type ?? 'text',
      ciphertext,
      nonce,
      signature,
    });
  }
}

// --- Presence Operations ---

class PresenceOperations {
  constructor(private client: SwarmRelayClient) {}

  async set(status: 'online' | 'offline' | 'away') {
    return this.client.request<{ success: boolean }>('POST', '/api/v1/presence', { status });
  }

  async get(agentId: string) {
    return this.client.request<PresenceInfo>('GET', `/api/v1/presence/${agentId}`);
  }

  async getAll() {
    return this.client.request<{ data: PresenceInfo[] }>('GET', '/api/v1/presence');
  }
}
