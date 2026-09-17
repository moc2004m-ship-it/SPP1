// Stage 11 — Private Chat repository.
//
// Same dual-implementation pattern as every other Phase 5 domain
// (guard.repository.js, gift-wall.repository.js, ...):
//   - InMemoryChatRepository: ACTIVE today (no network in this sandbox --
//     see Database/STAGE3_TODO.md).
//   - PostgresChatRepository: ready for later, matches
//     ../schema/023_create_private_chat.sql. NOT exercised in this
//     sandbox -- reviewed but never run against a live database, same
//     status as every other Postgres* class in this project.
//
// Three entities live here:
//   - conversations : one 1:1 conversation per unordered pair of users --
//     participantIds is ALWAYS stored sorted so getOrCreateConversation
//     is idempotent regardless of call order (same idempotency
//     discipline as gift-wall.repository.js's getOrCreateActiveSession).
//   - messages       : append-only (soft-delete only, never a real
//     delete -- same "no real delete ever" philosophy as every other
//     domain in this project).
//   - presence       : real heartbeat-derived online/offline, no fake
//     revival -- same discipline as feature-platform.js's
//     RECONNECT_GRACE_MS.
//
// ALL authorization/business-rule decisions (block/privacy enforcement,
// self-chat rejection, sender-only delete, self-report rejection, status
// derivation from real presence) live in ../../services/chat.service.js,
// which is the ONLY caller of this repository. This file owns exactly
// the data-mechanics: idempotent conversation creation, ordered message
// listing, idempotent soft-delete, and heartbeat-window-derived presence.

const { generateConversationId, generateMessageId } = require('../models/chat.model');

const DEFAULT_ONLINE_WINDOW_MS = 60 * 1000;

function sortedPair(userA, userB) {
  return [userA, userB].sort();
}

function pairKey(userA, userB) {
  return sortedPair(userA, userB).join('::');
}

function notFound(message) {
  return Object.assign(new Error(message), { status: 404 });
}

// ---------------------------------------------------------------------
// In-memory implementation
// ---------------------------------------------------------------------

class InMemoryChatRepository {
  constructor() {
    this._conversations = new Map(); // conversationId -> conversation
    this._conversationByPair = new Map(); // "a::b" -> conversationId
    this._messages = new Map(); // messageId -> message
    this._messagesByConversation = new Map(); // conversationId -> [messageId] (insertion order)
    this._presence = new Map(); // accountId -> presence record
  }

  // --- conversations ---------------------------------------------------

  // Idempotent from the caller's point of view regardless of argument
  // order -- getOrCreateConversation(a, b) and getOrCreateConversation(b, a)
  // always resolve to the same conversation, because the lookup key is
  // always the sorted pair.
  async getOrCreateConversation(userA, userB) {
    const key = pairKey(userA, userB);
    const existingId = this._conversationByPair.get(key);
    if (existingId) return this._conversations.get(existingId);

    const [a, b] = sortedPair(userA, userB);
    const nowIso = new Date().toISOString();
    const conversation = Object.freeze({
      id: generateConversationId(),
      participantIds: [a, b],
      createdAt: nowIso,
      lastMessageAt: nowIso,
    });
    this._conversations.set(conversation.id, conversation);
    this._conversationByPair.set(key, conversation.id);
    this._messagesByConversation.set(conversation.id, []);
    return conversation;
  }

  async getConversationById(conversationId) {
    return this._conversations.get(conversationId) || null;
  }

  // Newest-activity-first -- same ordering discipline as
  // gift-wall.repository.js's sortContributionsDesc.
  async listConversationsForAccount(accountId) {
    return Array.from(this._conversations.values())
      .filter((c) => c.participantIds.includes(accountId))
      .sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : a.lastMessageAt > b.lastMessageAt ? -1 : 0));
  }

  // --- messages ----------------------------------------------------------

  async addMessage({ conversationId, senderId, type, body, stickerId, imageUrl, replyToMessageId, status, now }) {
    if (!this._conversations.has(conversationId)) {
      throw notFound('conversation not found');
    }
    const nowIso = (now || new Date()).toISOString();
    const message = Object.freeze({
      id: generateMessageId(),
      conversationId,
      senderId,
      type,
      body: body ?? null,
      stickerId: stickerId ?? null,
      imageUrl: imageUrl ?? null,
      replyToMessageId: replyToMessageId ?? null,
      status,
      createdAt: nowIso,
      readAt: null,
      deleted: false,
      deletedBy: null,
      reports: [],
    });
    this._messages.set(message.id, message);
    this._messagesByConversation.get(conversationId).push(message.id);

    const conversation = this._conversations.get(conversationId);
    this._conversations.set(conversationId, Object.freeze({ ...conversation, lastMessageAt: nowIso }));

    return message;
  }

  async findMessageById(messageId) {
    return this._messages.get(messageId) || null;
  }

  // Chronological (oldest first) -- how a chat thread is actually read.
  // `limit`, when given, returns the most recent `limit` messages while
  // still returning them in chronological order.
  async listMessages(conversationId, { limit } = {}) {
    const ids = this._messagesByConversation.get(conversationId) || [];
    const all = ids.map((id) => this._messages.get(id));
    if (!Number.isInteger(limit) || limit <= 0) return all;
    return all.slice(Math.max(0, all.length - limit));
  }

  // Marks every message in the conversation authored by someone OTHER
  // than readerId, and not already read, as read. Returns the number of
  // messages actually transitioned -- idempotent, a second call with
  // nothing new to mark returns 0.
  async markConversationRead({ conversationId, readerId, now }) {
    const ids = this._messagesByConversation.get(conversationId) || [];
    const nowIso = (now || new Date()).toISOString();
    let count = 0;
    for (const id of ids) {
      const message = this._messages.get(id);
      if (message.senderId !== readerId && message.status !== 'read') {
        this._messages.set(id, Object.freeze({ ...message, status: 'read', readAt: nowIso }));
        count += 1;
      }
    }
    return count;
  }

  // Idempotent -- soft-deleting an already-deleted message is a no-op,
  // not an error, same discipline as gift-wall.repository.js's
  // closeSession(). Never a real delete: body/stickerId/imageUrl are
  // zeroed out, the row (and its id/timestamps/sender/reports) stays.
  async softDeleteMessage(messageId, deletedBy, now) {
    const message = this._messages.get(messageId);
    if (!message) throw notFound('message not found');
    if (message.deleted) return message;
    const updated = Object.freeze({
      ...message,
      body: null,
      stickerId: null,
      imageUrl: null,
      deleted: true,
      deletedBy,
      deletedAt: (now || new Date()).toISOString(),
    });
    this._messages.set(messageId, updated);
    return updated;
  }

  async reportMessage(messageId, reporterId, reason, now) {
    const message = this._messages.get(messageId);
    if (!message) throw notFound('message not found');
    const report = { reporterId, reason: reason || null, createdAt: (now || new Date()).toISOString() };
    const updated = Object.freeze({ ...message, reports: [...message.reports, report] });
    this._messages.set(messageId, updated);
    return updated;
  }

  async countUnreadForConversation(conversationId, accountId) {
    const ids = this._messagesByConversation.get(conversationId) || [];
    let count = 0;
    for (const id of ids) {
      const message = this._messages.get(id);
      if (message.senderId !== accountId && message.status !== 'read') count += 1;
    }
    return count;
  }

  // --- presence ----------------------------------------------------------

  async heartbeat(accountId, now) {
    const nowIso = (now || new Date()).toISOString();
    const record = Object.freeze({ accountId, status: 'online', lastSeenAt: nowIso, updatedAt: nowIso });
    this._presence.set(accountId, record);
    return record;
  }

  // Explicit offline -- does NOT touch lastSeenAt (the last real
  // heartbeat timestamp is preserved as the true "last seen" moment; no
  // fake revival, no fake extension either).
  async goOffline(accountId, now) {
    const existing = this._presence.get(accountId);
    const nowIso = (now || new Date()).toISOString();
    const record = Object.freeze({
      accountId,
      status: 'offline',
      lastSeenAt: existing ? existing.lastSeenAt : null,
      updatedAt: nowIso,
    });
    this._presence.set(accountId, record);
    return record;
  }

  // Derives the real, current status: an explicit 'offline' record
  // always stays offline; an 'online' record whose last heartbeat has
  // aged past onlineWindowMs is derived as offline WITHOUT ever being
  // written back as such (no mutation on read) -- same "derive, don't
  // store" discipline guard.service.js uses for active/expired.
  async getPresence(accountId, { now, onlineWindowMs = DEFAULT_ONLINE_WINDOW_MS } = {}) {
    const record = this._presence.get(accountId);
    if (!record) return { accountId, status: 'offline', lastSeenAt: null };
    if (record.status === 'offline') return { accountId, status: 'offline', lastSeenAt: record.lastSeenAt };
    const nowMs = (now || new Date()).getTime();
    const lastSeenMs = Date.parse(record.lastSeenAt);
    const stillOnline = nowMs - lastSeenMs <= onlineWindowMs;
    return { accountId, status: stillOnline ? 'online' : 'offline', lastSeenAt: record.lastSeenAt };
  }
}

// ---------------------------------------------------------------------
// Postgres implementation — matches schema/023_create_private_chat.sql.
// NOT exercised in this sandbox (no network -- see
// Database/STAGE3_TODO.md): reviewed but never run against a live
// database, same status as every other Postgres* repository here.
// ---------------------------------------------------------------------

function mapConversationRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    participantIds: [row.participant_a, row.participant_b],
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    lastMessageAt: row.last_message_at instanceof Date ? row.last_message_at.toISOString() : row.last_message_at,
  };
}

function mapMessageRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    type: row.type,
    body: row.body,
    stickerId: row.sticker_id,
    imageUrl: row.image_url,
    replyToMessageId: row.reply_to_message_id,
    status: row.status,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    readAt: row.read_at instanceof Date ? row.read_at.toISOString() : row.read_at,
    deleted: row.deleted,
    deletedBy: row.deleted_by,
    reports: row.reports || [],
  };
}

function mapPresenceRow(row) {
  if (!row) return null;
  return {
    accountId: row.account_id,
    status: row.status,
    lastSeenAt: row.last_seen_at instanceof Date ? row.last_seen_at.toISOString() : row.last_seen_at,
  };
}

class PostgresChatRepository {
  constructor(pool) {
    this._pool = pool;
  }

  // Relies on the unique index on (participant_a, participant_b) as the
  // real race-safety guarantee under concurrent requests, same
  // INSERT ... ON CONFLICT DO NOTHING + re-select pattern as
  // gift-wall.repository.js's getOrCreateActiveSession.
  async getOrCreateConversation(userA, userB) {
    const [a, b] = sortedPair(userA, userB);
    const id = generateConversationId();
    await this._pool.query(
      `INSERT INTO chat_conversations (id, participant_a, participant_b)
       VALUES ($1, $2, $3)
       ON CONFLICT (participant_a, participant_b) DO NOTHING`,
      [id, a, b]
    );
    const { rows } = await this._pool.query(
      'SELECT * FROM chat_conversations WHERE participant_a = $1 AND participant_b = $2',
      [a, b]
    );
    return mapConversationRow(rows[0]);
  }

  async getConversationById(conversationId) {
    const { rows } = await this._pool.query('SELECT * FROM chat_conversations WHERE id = $1', [conversationId]);
    return mapConversationRow(rows[0]);
  }

  async listConversationsForAccount(accountId) {
    const { rows } = await this._pool.query(
      `SELECT * FROM chat_conversations WHERE participant_a = $1 OR participant_b = $1
       ORDER BY last_message_at DESC`,
      [accountId]
    );
    return rows.map(mapConversationRow);
  }

  async addMessage({ conversationId, senderId, type, body, stickerId, imageUrl, replyToMessageId, status, now }) {
    const client = await this._pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: convRows } = await client.query(
        'SELECT id FROM chat_conversations WHERE id = $1 FOR UPDATE',
        [conversationId]
      );
      if (!convRows.length) throw notFound('conversation not found');
      const id = generateMessageId();
      const { rows } = await client.query(
        `INSERT INTO chat_messages
           (id, conversation_id, sender_id, type, body, sticker_id, image_url, reply_to_message_id, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, now()))
         RETURNING *`,
        [id, conversationId, senderId, type, body ?? null, stickerId ?? null, imageUrl ?? null, replyToMessageId ?? null, status, now || null]
      );
      await client.query(
        'UPDATE chat_conversations SET last_message_at = $2 WHERE id = $1',
        [conversationId, rows[0].created_at]
      );
      await client.query('COMMIT');
      return mapMessageRow(rows[0]);
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch {}
      throw e;
    } finally {
      client.release();
    }
  }

  async findMessageById(messageId) {
    const { rows } = await this._pool.query('SELECT * FROM chat_messages WHERE id = $1', [messageId]);
    return mapMessageRow(rows[0]);
  }

  async listMessages(conversationId, { limit } = {}) {
    if (Number.isInteger(limit) && limit > 0) {
      const { rows } = await this._pool.query(
        `SELECT * FROM (
           SELECT * FROM chat_messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT $2
         ) recent ORDER BY created_at ASC`,
        [conversationId, limit]
      );
      return rows.map(mapMessageRow);
    }
    const { rows } = await this._pool.query(
      'SELECT * FROM chat_messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [conversationId]
    );
    return rows.map(mapMessageRow);
  }

  async markConversationRead({ conversationId, readerId, now }) {
    const { rows } = await this._pool.query(
      `UPDATE chat_messages SET status = 'read', read_at = COALESCE($3, now())
       WHERE conversation_id = $1 AND sender_id <> $2 AND status <> 'read'
       RETURNING id`,
      [conversationId, readerId, now || null]
    );
    return rows.length;
  }

  async softDeleteMessage(messageId, deletedBy, now) {
    const { rows } = await this._pool.query(
      `UPDATE chat_messages
       SET body = NULL, sticker_id = NULL, image_url = NULL, deleted = true, deleted_by = $2, deleted_at = COALESCE($3, now())
       WHERE id = $1 AND deleted = false
       RETURNING *`,
      [messageId, deletedBy, now || null]
    );
    if (rows.length) return mapMessageRow(rows[0]);
    // Already deleted (or never existed) -- distinguish the two, same
    // idempotent-close pattern as gift-wall.repository.js's closeSession.
    const existing = await this.findMessageById(messageId);
    if (!existing) throw notFound('message not found');
    return existing;
  }

  async reportMessage(messageId, reporterId, reason, now) {
    const { rows } = await this._pool.query(
      `UPDATE chat_messages
       SET reports = reports || jsonb_build_array(jsonb_build_object(
             'reporterId', $2::text, 'reason', $3::text, 'createdAt', to_char(COALESCE($4::timestamptz, now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           ))
       WHERE id = $1
       RETURNING *`,
      [messageId, reporterId, reason || null, now || null]
    );
    if (!rows.length) throw notFound('message not found');
    return mapMessageRow(rows[0]);
  }

  async countUnreadForConversation(conversationId, accountId) {
    const { rows } = await this._pool.query(
      `SELECT COUNT(*)::int AS count FROM chat_messages
       WHERE conversation_id = $1 AND sender_id <> $2 AND status <> 'read'`,
      [conversationId, accountId]
    );
    return rows[0].count;
  }

  async heartbeat(accountId, now) {
    const { rows } = await this._pool.query(
      `INSERT INTO chat_presence (account_id, status, last_seen_at, updated_at)
       VALUES ($1, 'online', COALESCE($2, now()), now())
       ON CONFLICT (account_id) DO UPDATE
         SET status = 'online', last_seen_at = COALESCE($2, now()), updated_at = now()
       RETURNING *`,
      [accountId, now || null]
    );
    return mapPresenceRow(rows[0]);
  }

  async goOffline(accountId, now) {
    const { rows } = await this._pool.query(
      `INSERT INTO chat_presence (account_id, status, last_seen_at, updated_at)
       VALUES ($1, 'offline', NULL, COALESCE($2, now()))
       ON CONFLICT (account_id) DO UPDATE
         SET status = 'offline', updated_at = COALESCE($2, now())
       RETURNING *`,
      [accountId, now || null]
    );
    return mapPresenceRow(rows[0]);
  }

  async getPresence(accountId, { now, onlineWindowMs = DEFAULT_ONLINE_WINDOW_MS } = {}) {
    const { rows } = await this._pool.query('SELECT * FROM chat_presence WHERE account_id = $1', [accountId]);
    const record = mapPresenceRow(rows[0]);
    if (!record) return { accountId, status: 'offline', lastSeenAt: null };
    if (record.status === 'offline') return record;
    const nowMs = (now || new Date()).getTime();
    const lastSeenMs = Date.parse(record.lastSeenAt);
    const stillOnline = nowMs - lastSeenMs <= onlineWindowMs;
    return { accountId, status: stillOnline ? 'online' : 'offline', lastSeenAt: record.lastSeenAt };
  }
}

module.exports = { InMemoryChatRepository, PostgresChatRepository };
