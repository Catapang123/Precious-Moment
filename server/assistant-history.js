/**
 * Private PRECIOUS conversation history.
 *
 * Every function takes the signed-in user id from the server session. There is
 * deliberately no function that accepts a user id from the request body, and no
 * admin override: a conversation belongs to exactly one account.
 */
import crypto from 'node:crypto';

const MAX_TITLE = 80;
const MAX_PREVIEW = 120;
const MAX_MESSAGE = 4000;
const MAX_AI_HISTORY = 6;

export function historyUnavailable(error) {
  const message = String(error?.message || '').toLowerCase();
  return (
    /pm_assistant_(conversations|messages)/.test(message) &&
    /(does not exist|could not find the table|relation)/.test(message)
  );
}

function titleFromMessage(message) {
  const text = String(message || '').replace(/\s+/g, ' ').trim();
  if (!text) return 'New conversation';
  return text.length > MAX_TITLE ? `${text.slice(0, MAX_TITLE - 1)}…` : text;
}

function publicConversation(conversation) {
  return {
    id: conversation.id,
    title: conversation.title,
    created_at: conversation.created_at,
    updated_at: conversation.updated_at,
  };
}

function publicMessage(message) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    created_at: message.created_at,
  };
}

function byOldest(first, second) {
  return (
    String(first.created_at || '').localeCompare(String(second.created_at || '')) ||
    String(first.id || '').localeCompare(String(second.id || ''))
  );
}

export async function listConversations(store, userId) {
  const [conversations, messages] = await Promise.all([
    store.listWhere('assistant_conversations', { user_id: userId }),
    store.listWhere('assistant_messages', { user_id: userId }),
  ]);
  const messagesByConversation = new Map();
  for (const message of messages) {
    if (message.user_id !== userId) continue;
    const rows = messagesByConversation.get(message.conversation_id) || [];
    rows.push(message);
    messagesByConversation.set(message.conversation_id, rows);
  }

  return conversations
    .filter((conversation) => conversation.user_id === userId)
    .map((conversation) => {
      const rows = (messagesByConversation.get(conversation.id) || []).sort(byOldest);
      const last = rows[rows.length - 1];
      return {
        ...publicConversation(conversation),
        preview: last ? String(last.content).slice(0, MAX_PREVIEW) : '',
        message_count: rows.length,
      };
    })
    .sort(
      (first, second) =>
        String(second.updated_at || '').localeCompare(String(first.updated_at || '')) ||
        String(second.id).localeCompare(String(first.id))
    );
}

/** Returns null for a missing or foreign conversation, so callers can use 404. */
export async function getConversationRecord(store, userId, conversationId) {
  const id = String(conversationId || '').trim();
  if (!id) return null;
  const conversation = await store.get('assistant_conversations', id);
  if (!conversation || conversation.user_id !== userId) return null;
  const messages = await store.listWhere('assistant_messages', {
    conversation_id: id,
    user_id: userId,
  });
  return {
    conversation,
    messages: messages.filter((message) => message.user_id === userId).sort(byOldest),
  };
}

/** Returns null for a missing or foreign conversation, so callers can use 404. */
export async function getConversation(store, userId, conversationId) {
  const record = await getConversationRecord(store, userId, conversationId);
  if (!record) return null;
  return {
    conversation: publicConversation(record.conversation),
    messages: record.messages.map(publicMessage),
  };
}

export async function createConversation(store, userId, firstMessage) {
  const now = new Date().toISOString();
  return store.insert('assistant_conversations', {
    id: crypto.randomUUID(),
    user_id: userId,
    title: titleFromMessage(firstMessage),
    created_at: now,
    updated_at: now,
  });
}

export async function appendMessage(store, conversation, userId, role, content) {
  if (conversation.user_id !== userId) throw new Error('Conversation ownership mismatch.');
  const message = {
    id: crypto.randomUUID(),
    conversation_id: conversation.id,
    user_id: userId,
    role,
    content: String(content || '').slice(0, MAX_MESSAGE),
    created_at: new Date().toISOString(),
  };
  const saved = await store.insert('assistant_messages', message);
  await store.update('assistant_conversations', conversation.id, {
    updated_at: message.created_at,
  });
  conversation.updated_at = message.created_at;
  return saved;
}

/** The model gets only the recent turns from this one owned conversation. */
export function aiHistory(record) {
  return (record?.messages || [])
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-MAX_AI_HISTORY)
    .map((message) => ({ role: message.role, content: message.content }));
}
