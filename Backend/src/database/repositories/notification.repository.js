// Stage 33 — Notifications + Push repository.
//
// Same dual-implementation pattern as guard.repository.js/couple.repository.js:
//   - InMemoryNotificationRepository: ACTIVE today (no network in this
//     sandbox -- see Database/STAGE3_TODO.md).
//   - PostgresNotificationRepository: ready for later, matches
//     ../schema/021_create_notifications.sql. NOT exercised in this
//     sandbox -- reviewed but never run against a live database, same
//     status as every other Postgres* class in this project.
//
// Three entities live here, all keyed to a real accountId:
//   - notifications           : { id, recipientId, type, category, payload,
//                                  deepLink, status('unread'|'read'),
//                                  createdAt, updatedAt, readAt }
//   - notification_preferences: one row per account -- { accountId,
//                                  mutedCategories: [...], createdAt,
//                                  updatedAt }. An account with no row yet
//                                  gets the default (nothing muted).
//   - push_tokens              : one row per (accountId, token) pair,
//                                  upserted (never duplicated) on
//                                  re-registration -- { id, accountId,
//                                  token, platform, createdAt, updatedAt }.
//
// ALL authorization/business-rule decisions (who may create a
// notification, catalog validation, "you can only read/mark your own
// notifications") live in ../../services/notification.service.js, which
// is the ONLY caller of this repository. This file owns exactly the data
// mechanics: real unread-count bookkeeping, real upsert-not-duplicate on
// device registration, real bulk markAllRead update -- same "repository =
// data-integrity only" split as every other Phase 5 repository here.

const {
  generateNotificationId,
  generatePushTokenId,
} = require('../models/notification.model');

// ---------------------------------------------------------------------
// In-memory implementation
// ---------------------------------------------------------------------

class InMemoryNotificationRepository {
  constructor() {
    this._notifications = new Map(); // id -> notification
    this._preferences = new Map(); // accountId -> { accountId, mutedCategories, createdAt, updatedAt }
    this._pushTokens = new Map(); // "accountId::token" -> push token row
  }

  // -- notifications -----------------------------------------------------

  async createNotification({ recipientId, type, category, payload, deepLink, now }) {
    const nowIso = now.toISOString();
    const notification = Object.freeze({
      id: generateNotificationId(),
      recipientId,
      type,
      category,
      payload: payload || {},
      deepLink,
      status: 'unread',
      createdAt: nowIso,
      updatedAt: nowIso,
      readAt: null,
    });
    this._notifications.set(notification.id, notification);
    return notification;
  }

  async findNotificationById(notificationId) {
    return this._notifications.get(notificationId) || null;
  }

  // Newest-first, matching the real creation order -- notifications are
  // never reordered/edited in place (only status/readAt ever change).
  async listForAccount(recipientId, { limit } = {}) {
    const all = Array.from(this._notifications.values())
      .filter((n) => n.recipientId === recipientId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    return typeof limit === 'number' ? all.slice(0, limit) : all;
  }

  async countUnread(recipientId) {
    let count = 0;
    for (const n of this._notifications.values()) {
      if (n.recipientId === recipientId && n.status === 'unread') count += 1;
    }
    return count;
  }

  async markRead(notificationId, now) {
    const existing = this._notifications.get(notificationId);
    if (!existing) return null;
    if (existing.status === 'read') return existing; // idempotent no-op
    const updated = Object.freeze({ ...existing, status: 'read', readAt: now.toISOString(), updatedAt: now.toISOString() });
    this._notifications.set(notificationId, updated);
    return updated;
  }

  // Real bulk update -- returns how many rows actually transitioned
  // unread -> read (already-read rows are left untouched, not recounted).
  async markAllRead(recipientId, now) {
    let count = 0;
    for (const [id, n] of this._notifications.entries()) {
      if (n.recipientId === recipientId && n.status === 'unread') {
        this._notifications.set(id, Object.freeze({ ...n, status: 'read', readAt: now.toISOString(), updatedAt: now.toISOString() }));
        count += 1;
      }
    }
    return count;
  }

  // -- notification_preferences ------------------------------------------

  async getPreferences(accountId) {
    return this._preferences.get(accountId) || null;
  }

  async setPreferences(accountId, mutedCategories, now) {
    const nowIso = now.toISOString();
    const existing = this._preferences.get(accountId);
    const updated = Object.freeze({
      accountId,
      mutedCategories: Array.from(new Set(mutedCategories)),
      createdAt: existing ? existing.createdAt : nowIso,
      updatedAt: nowIso,
    });
    this._preferences.set(accountId, updated);
    return updated;
  }

  // -- push_tokens ---------------------------------------------------------

  // Real upsert keyed by (accountId, token) -- registering the same token
  // again (e.g. app relaunch) updates platform/updatedAt in place rather
  // than creating a duplicate row, same "upsert, never duplicate"
  // discipline as guard.repository.js's renewGuard().
  async registerDevice({ accountId, token, platform, now }) {
    const key = `${accountId}::${token}`;
    const nowIso = now.toISOString();
    const existing = this._pushTokens.get(key);
    const updated = Object.freeze({
      id: existing ? existing.id : generatePushTokenId(),
      accountId,
      token,
      platform,
      createdAt: existing ? existing.createdAt : nowIso,
      updatedAt: nowIso,
    });
    this._pushTokens.set(key, updated);
    return updated;
  }

  async listDevicesForAccount(accountId) {
    return Array.from(this._pushTokens.values()).filter((t) => t.accountId === accountId);
  }

  // Scoped to (accountId, token) -- removing a token that does not belong
  // to this account, or does not exist, is a real no-op (returns false),
  // never an error -- same "not found is a valid outcome" shape as most
  // delete/no-op operations elsewhere in this project.
  async removeDevice(accountId, token) {
    const key = `${accountId}::${token}`;
    return this._pushTokens.delete(key);
  }
}

// ---------------------------------------------------------------------
// Postgres implementation — matches schema/021_create_notifications.sql.
// NOT exercised in this sandbox (no network -- see
// Database/STAGE3_TODO.md): reviewed but never run against a live
// database, same status as every other Postgres* repository here.
// ---------------------------------------------------------------------

function mapNotificationRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    recipientId: row.recipient_id,
    type: row.type,
    category: row.category,
    payload: row.payload || {},
    deepLink: row.deep_link,
    status: row.status,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    readAt: row.read_at instanceof Date ? row.read_at.toISOString() : row.read_at,
  };
}

function mapPreferencesRow(row) {
  if (!row) return null;
  return {
    accountId: row.account_id,
    mutedCategories: row.muted_categories || [],
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

function mapPushTokenRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    accountId: row.account_id,
    token: row.token,
    platform: row.platform,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

class PostgresNotificationRepository {
  constructor(pool) {
    this._pool = pool;
  }

  async createNotification({ recipientId, type, category, payload, deepLink, now }) {
    const { rows } = await this._pool.query(
      `INSERT INTO notifications (id, recipient_id, type, category, payload, deep_link, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'unread', $7, $7) RETURNING *`,
      [generateNotificationId(), recipientId, type, category, JSON.stringify(payload || {}), deepLink, now]
    );
    return mapNotificationRow(rows[0]);
  }

  async findNotificationById(notificationId) {
    const { rows } = await this._pool.query('SELECT * FROM notifications WHERE id = $1', [notificationId]);
    return mapNotificationRow(rows[0]);
  }

  async listForAccount(recipientId, { limit } = {}) {
    const query = typeof limit === 'number'
      ? { text: 'SELECT * FROM notifications WHERE recipient_id = $1 ORDER BY created_at DESC LIMIT $2', values: [recipientId, limit] }
      : { text: 'SELECT * FROM notifications WHERE recipient_id = $1 ORDER BY created_at DESC', values: [recipientId] };
    const { rows } = await this._pool.query(query.text, query.values);
    return rows.map(mapNotificationRow);
  }

  async countUnread(recipientId) {
    const { rows } = await this._pool.query(
      "SELECT COUNT(*)::int AS count FROM notifications WHERE recipient_id = $1 AND status = 'unread'",
      [recipientId]
    );
    return rows[0] ? rows[0].count : 0;
  }

  async markRead(notificationId, now) {
    const { rows } = await this._pool.query(
      `UPDATE notifications SET status = 'read', read_at = $2, updated_at = $2
       WHERE id = $1 AND status = 'unread' RETURNING *`,
      [notificationId, now]
    );
    if (rows[0]) return mapNotificationRow(rows[0]);
    // Either not found, or already read -- distinguish so markRead()
    // keeps the same "idempotent no-op on already-read" contract as the
    // in-memory implementation.
    return this.findNotificationById(notificationId);
  }

  async markAllRead(recipientId, now) {
    const { rowCount } = await this._pool.query(
      `UPDATE notifications SET status = 'read', read_at = $2, updated_at = $2
       WHERE recipient_id = $1 AND status = 'unread'`,
      [recipientId, now]
    );
    return rowCount;
  }

  async getPreferences(accountId) {
    const { rows } = await this._pool.query('SELECT * FROM notification_preferences WHERE account_id = $1', [accountId]);
    return mapPreferencesRow(rows[0]);
  }

  async setPreferences(accountId, mutedCategories, now) {
    const { rows } = await this._pool.query(
      `INSERT INTO notification_preferences (account_id, muted_categories, created_at, updated_at)
       VALUES ($1, $2, $3, $3)
       ON CONFLICT (account_id) DO UPDATE SET muted_categories = $2, updated_at = $3
       RETURNING *`,
      [accountId, JSON.stringify(Array.from(new Set(mutedCategories))), now]
    );
    return mapPreferencesRow(rows[0]);
  }

  async registerDevice({ accountId, token, platform, now }) {
    const { rows } = await this._pool.query(
      `INSERT INTO push_tokens (id, account_id, token, platform, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $5)
       ON CONFLICT (account_id, token) DO UPDATE SET platform = $4, updated_at = $5
       RETURNING *`,
      [generatePushTokenId(), accountId, token, platform, now]
    );
    return mapPushTokenRow(rows[0]);
  }

  async listDevicesForAccount(accountId) {
    const { rows } = await this._pool.query('SELECT * FROM push_tokens WHERE account_id = $1', [accountId]);
    return rows.map(mapPushTokenRow);
  }

  async removeDevice(accountId, token) {
    const { rowCount } = await this._pool.query('DELETE FROM push_tokens WHERE account_id = $1 AND token = $2', [accountId, token]);
    return rowCount > 0;
  }
}

module.exports = {
  InMemoryNotificationRepository,
  PostgresNotificationRepository,
};
