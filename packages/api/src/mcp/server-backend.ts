import type { MessagingBackend } from '@swarmrelay/mcp/server';
import type { AgentContext } from '../services/types.js';
import * as contactsService from '../services/contacts.js';
import * as conversationsService from '../services/conversations.js';
import * as messagesService from '../services/messages.js';
import * as presenceService from '../services/presence.js';

/**
 * buildServerBackend adapts the packages/api services layer to the
 * MessagingBackend interface consumed by @swarmrelay/mcp tools. Each
 * backend operation is scoped to the caller's agent identity.
 *
 * This deliberately omits getPrivateKey() — the server never surfaces the
 * raw key to the tool layer. Encrypted DMs are handled inside
 * messagesService.sendEncryptedDm, which decrypts the stored key, runs
 * NaCl box, and drops the plaintext key before returning.
 */
export function buildServerBackend(ctx: AgentContext): MessagingBackend {
  return {
    contacts: {
      list: (params) => contactsService.listContacts(ctx, params) as never,
      add: (params) => contactsService.addContact(ctx, params) as never,
      get: (id) => contactsService.getContact(ctx, id) as never,
      update: (id, params) => contactsService.updateContact(ctx, id, params) as never,
      remove: (id) => contactsService.removeContact(ctx, id) as never,
      block: (id) => contactsService.blockContact(ctx, id) as never,
      unblock: (id) => contactsService.unblockContact(ctx, id) as never,
    },
    conversations: {
      list: (params) => conversationsService.listConversations(ctx, params) as never,
      create: (params) => conversationsService.createConversation(ctx, params) as never,
      createGroup: (params) =>
        conversationsService.createConversation(ctx, {
          type: 'group',
          members: params.members,
          name: params.name,
          description: params.description,
        }) as never,
      get: (id) => conversationsService.getConversation(ctx, id) as never,
      update: (id, params) => conversationsService.updateConversation(ctx, id, params) as never,
      leave: (id) => conversationsService.leaveConversation(ctx, id),
      addMembers: (id, members) =>
        conversationsService.addMembers(ctx, id, members).then(() => ({ success: true })),
      removeMember: (id, agentId) => conversationsService.removeMember(ctx, id, agentId),
      rotateKey: async (id) => {
        const result = await conversationsService.rotateGroupKey(ctx, id);
        return { groupKeyVersion: result.groupKeyVersion };
      },
    },
    messages: {
      list: (conversationId, params) =>
        messagesService.listMessages(ctx, conversationId, params) as never,
      send: (params) =>
        messagesService.sendMessage(ctx, {
          conversationId: params.conversationId,
          type: params.type ?? 'text',
          ciphertext: params.ciphertext,
          nonce: params.nonce,
          signature: params.signature,
          replyToId: params.replyToId ?? null,
          metadata: params.metadata ?? {},
        }) as never,
      sendEncrypted: (params) => messagesService.sendEncryptedDm(ctx, params) as never,
      edit: (messageId, params) => messagesService.editMessage(ctx, messageId, params) as never,
      delete: (messageId) => messagesService.deleteMessage(ctx, messageId),
      sendReceipt: (messageId, status) =>
        messagesService.sendReceipt(ctx, messageId, status) as never,
    },
    presence: {
      set: (status) => presenceService.setPresence(ctx, { status }),
      get: (agentId) => presenceService.getPresence(agentId) as never,
      getAll: () => presenceService.getAllPresence(ctx) as never,
    },
  };
}
