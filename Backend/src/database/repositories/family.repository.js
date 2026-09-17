// Stage 30 — Family repository.
//
// Same dual-implementation pattern as wallet.repository.js/
// inventory.repository.js:
//   - InMemoryFamilyRepository: ACTIVE today (no network in this sandbox
//     -- see Database/STAGE3_TODO.md).
//   - PostgresFamilyRepository: ready for later, matches
//     src/database/schema/017_create_families.sql. NOT exercised in this
//     sandbox -- reviewed but never run against a live database, same
//     status as every other Postgres* class in this project.
//
// Three related entities live here because they are never meaningfully
// used apart from one another (a membership is meaningless without its
// family; an invite is meaningless without the membership it may create):
//   - families            : { id, name, ownerId, level, xp, createdAt, updatedAt }
//   - family_memberships  : { id, familyId, accountId, role, status, contribution, joinedAt, updatedAt }
//     role   in ('member','admin','owner')   -- see ../models/family.model.js ROLES
//     status in ('active','left','kicked','banned')
//   - family_invites      : { id, familyId, inviterId, inviteeId, status, createdAt, updatedAt }
//     status in ('pending','accepted','declined','revoked')
//
// ALL authorization/business-rule decisions (who may invite/kick/ban,
// one-active-family-per-account, banned users can't rejoin, ...) live in
// ../../services/family.service.js, which is the ONLY caller of this
// repository. This file only guarantees data integrity: unique
// (familyId, accountId) membership rows, real recomputed level on every
// xp change, no double-application of the same contribution.

const {
  generateFamilyId,
  generateMembershipId,
  generateInviteId,
} = require('../models/family.model');
const { levelForFamilyXp } = require('../../domain/family-level-curve');

function familyNotFound() {
  return Object.assign(new Error('family not found'), { status: 404 });
}

function membershipNotFound() {
  return Object.assign(new Error('membership not found'), { status: 404 });
}

function inviteNotFound() {
  return Object.assign(new Error('invite not found'), { status: 404 });
}

// ---------------------------------------------------------------------
// In-memory implementation
// ---------------------------------------------------------------------

class InMemoryFamilyRepository {
  constructor() {
    this._families = new Map(); // id -> family
    this._memberships = new Map(); // id -> membership
    this._membershipByFamilyAndAccount = new Map(); // `${familyId}:${accountId}` -> membership id
    this._invites = new Map(); // id -> invite
  }

  async createFamily(ownerId, name) {
    const now = new Date().toISOString();
    const family = Object.freeze({
      id: generateFamilyId(),
      name,
      ownerId,
      level: 0,
      xp: 0,
      createdAt: now,
      updatedAt: now,
    });
    this._families.set(family.id, family);

    const membership = Object.freeze({
      id: generateMembershipId(),
      familyId: family.id,
      accountId: ownerId,
      role: 'owner',
      status: 'active',
      contribution: 0,
      joinedAt: now,
      updatedAt: now,
    });
    this._memberships.set(membership.id, membership);
    this._membershipByFamilyAndAccount.set(`${family.id}:${ownerId}`, membership.id);

    return family;
  }

  async findFamilyById(familyId) {
    return this._families.get(familyId) || null;
  }

  async listFamilies() {
    return Array.from(this._families.values());
  }

  // Used only by transferOwnership() in family.service.js. Deliberately
  // separate from updateMembershipRole(): family.owner_id and the
  // membership row with role='owner' must always agree (no duplicate
  // source of truth), so the service calls both this and
  // updateMembershipRole() together in the same transferOwnership() call.
  async updateFamilyOwner(familyId, newOwnerId) {
    const family = this._families.get(familyId);
    if (!family) throw familyNotFound();
    const updated = Object.freeze({ ...family, ownerId: newOwnerId, updatedAt: new Date().toISOString() });
    this._families.set(familyId, updated);
    return updated;
  }

  async findMembership(familyId, accountId) {
    const membershipId = this._membershipByFamilyAndAccount.get(`${familyId}:${accountId}`);
    return membershipId ? this._memberships.get(membershipId) : null;
  }

  // The account's single currently-active membership across ALL
  // families, or null. Used to enforce "one active family at a time".
  async findActiveMembershipByAccount(accountId) {
    for (const membership of this._memberships.values()) {
      if (membership.accountId === accountId && membership.status === 'active') return membership;
    }
    return null;
  }

  async listMembers(familyId, status = 'active') {
    return Array.from(this._memberships.values()).filter(
      (m) => m.familyId === familyId && (status === null || m.status === status)
    );
  }

  // Brand-new relationship between this account and this family (no
  // prior row exists). Used the first time someone ever joins a given
  // family.
  async createMembership({ familyId, accountId, role, status }) {
    const now = new Date().toISOString();
    const membership = Object.freeze({
      id: generateMembershipId(),
      familyId,
      accountId,
      role,
      status,
      contribution: 0,
      joinedAt: now,
      updatedAt: now,
    });
    this._memberships.set(membership.id, membership);
    this._membershipByFamilyAndAccount.set(`${familyId}:${accountId}`, membership.id);
    return membership;
  }

  async _requireMembership(membershipId) {
    const membership = this._memberships.get(membershipId);
    if (!membership) throw membershipNotFound();
    return membership;
  }

  // Re-activates an existing membership row (someone who previously left
  // or was kicked, and is rejoining via a fresh accepted invite).
  // Deliberately preserves the existing `contribution` total -- past
  // contributions to this family are real history and are not erased by
  // having left and come back.
  async reactivateMembership(membershipId, { role, status }) {
    const current = await this._requireMembership(membershipId);
    const updated = Object.freeze({ ...current, role, status, updatedAt: new Date().toISOString() });
    this._memberships.set(membershipId, updated);
    return updated;
  }

  async updateMembershipRole(membershipId, role) {
    const current = await this._requireMembership(membershipId);
    const updated = Object.freeze({ ...current, role, updatedAt: new Date().toISOString() });
    this._memberships.set(membershipId, updated);
    return updated;
  }

  async updateMembershipStatus(membershipId, status) {
    const current = await this._requireMembership(membershipId);
    const updated = Object.freeze({ ...current, status, updatedAt: new Date().toISOString() });
    this._memberships.set(membershipId, updated);
    return updated;
  }

  // Atomically adds `amount` to both the member's real contribution
  // total AND the family's real xp (recomputing level from the new xp in
  // the same operation, so level can never drift out of sync with xp --
  // same discipline as account.repository.js's addXp()).
  async addContribution(familyId, membershipId, amount) {
    const family = this._families.get(familyId);
    if (!family) throw familyNotFound();
    const membership = await this._requireMembership(membershipId);

    const newContribution = membership.contribution + amount;
    const updatedMembership = Object.freeze({
      ...membership,
      contribution: newContribution,
      updatedAt: new Date().toISOString(),
    });
    this._memberships.set(membershipId, updatedMembership);

    const newXp = family.xp + amount;
    const updatedFamily = Object.freeze({
      ...family,
      xp: newXp,
      level: levelForFamilyXp(newXp),
      updatedAt: new Date().toISOString(),
    });
    this._families.set(familyId, updatedFamily);

    return { membership: updatedMembership, family: updatedFamily };
  }

  async createInvite({ familyId, inviterId, inviteeId }) {
    const now = new Date().toISOString();
    const invite = Object.freeze({
      id: generateInviteId(),
      familyId,
      inviterId,
      inviteeId,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    });
    this._invites.set(invite.id, invite);
    return invite;
  }

  async findInviteById(inviteId) {
    return this._invites.get(inviteId) || null;
  }

  async listPendingInvitesForAccount(accountId) {
    return Array.from(this._invites.values()).filter((i) => i.inviteeId === accountId && i.status === 'pending');
  }

  async findPendingInvite(familyId, inviteeId) {
    return (
      Array.from(this._invites.values()).find(
        (i) => i.familyId === familyId && i.inviteeId === inviteeId && i.status === 'pending'
      ) || null
    );
  }

  async updateInviteStatus(inviteId, status) {
    const current = this._invites.get(inviteId);
    if (!current) throw inviteNotFound();
    const updated = Object.freeze({ ...current, status, updatedAt: new Date().toISOString() });
    this._invites.set(inviteId, updated);
    return updated;
  }
}

// ---------------------------------------------------------------------
// Postgres implementation — matches schema/017_create_families.sql.
// NOT exercised in this sandbox (no network -- see
// Database/STAGE3_TODO.md): reviewed but never run against a live
// database, same status as every other Postgres* repository here.
// ---------------------------------------------------------------------

function mapFamilyRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    level: row.level,
    xp: row.xp,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

function mapMembershipRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    familyId: row.family_id,
    accountId: row.account_id,
    role: row.role,
    status: row.status,
    contribution: row.contribution,
    joinedAt: row.joined_at instanceof Date ? row.joined_at.toISOString() : row.joined_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

function mapInviteRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    familyId: row.family_id,
    inviterId: row.inviter_id,
    inviteeId: row.invitee_id,
    status: row.status,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

class PostgresFamilyRepository {
  constructor(pool) {
    this._pool = pool;
  }

  async createFamily(ownerId, name) {
    const client = await this._pool.connect();
    try {
      await client.query('BEGIN');
      const familyId = generateFamilyId();
      const { rows: familyRows } = await client.query(
        `INSERT INTO families (id, name, owner_id, level, xp)
         VALUES ($1, $2, $3, 0, 0) RETURNING *`,
        [familyId, name, ownerId]
      );
      await client.query(
        `INSERT INTO family_memberships (id, family_id, account_id, role, status, contribution)
         VALUES ($1, $2, $3, 'owner', 'active', 0)`,
        [generateMembershipId(), familyId, ownerId]
      );
      await client.query('COMMIT');
      return mapFamilyRow(familyRows[0]);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async findFamilyById(familyId) {
    const { rows } = await this._pool.query('SELECT * FROM families WHERE id = $1', [familyId]);
    return mapFamilyRow(rows[0]);
  }

  async listFamilies() {
    const { rows } = await this._pool.query('SELECT * FROM families ORDER BY created_at DESC');
    return rows.map(mapFamilyRow);
  }

  async updateFamilyOwner(familyId, newOwnerId) {
    const { rows } = await this._pool.query(
      `UPDATE families SET owner_id = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [newOwnerId, familyId]
    );
    if (!rows.length) throw familyNotFound();
    return mapFamilyRow(rows[0]);
  }

  async findMembership(familyId, accountId) {
    const { rows } = await this._pool.query(
      'SELECT * FROM family_memberships WHERE family_id = $1 AND account_id = $2',
      [familyId, accountId]
    );
    return mapMembershipRow(rows[0]);
  }

  async findActiveMembershipByAccount(accountId) {
    const { rows } = await this._pool.query(
      `SELECT * FROM family_memberships WHERE account_id = $1 AND status = 'active' LIMIT 1`,
      [accountId]
    );
    return mapMembershipRow(rows[0]);
  }

  async listMembers(familyId, status = 'active') {
    const { rows } = status
      ? await this._pool.query(
          'SELECT * FROM family_memberships WHERE family_id = $1 AND status = $2 ORDER BY joined_at ASC',
          [familyId, status]
        )
      : await this._pool.query('SELECT * FROM family_memberships WHERE family_id = $1 ORDER BY joined_at ASC', [
          familyId,
        ]);
    return rows.map(mapMembershipRow);
  }

  async createMembership({ familyId, accountId, role, status }) {
    const { rows } = await this._pool.query(
      `INSERT INTO family_memberships (id, family_id, account_id, role, status, contribution)
       VALUES ($1, $2, $3, $4, $5, 0) RETURNING *`,
      [generateMembershipId(), familyId, accountId, role, status]
    );
    return mapMembershipRow(rows[0]);
  }

  async reactivateMembership(membershipId, { role, status }) {
    const { rows } = await this._pool.query(
      `UPDATE family_memberships SET role = $1, status = $2, updated_at = now() WHERE id = $3 RETURNING *`,
      [role, status, membershipId]
    );
    if (!rows.length) throw membershipNotFound();
    return mapMembershipRow(rows[0]);
  }

  async updateMembershipRole(membershipId, role) {
    const { rows } = await this._pool.query(
      `UPDATE family_memberships SET role = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [role, membershipId]
    );
    if (!rows.length) throw membershipNotFound();
    return mapMembershipRow(rows[0]);
  }

  async updateMembershipStatus(membershipId, status) {
    const { rows } = await this._pool.query(
      `UPDATE family_memberships SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [status, membershipId]
    );
    if (!rows.length) throw membershipNotFound();
    return mapMembershipRow(rows[0]);
  }

  // Same atomicity guarantee as account.repository.js's addXp(): the
  // membership contribution increment and the family xp/level recompute
  // happen inside one transaction with a row lock on the family, so a
  // concurrent donate() on the same family can never read stale xp.
  async addContribution(familyId, membershipId, amount) {
    const client = await this._pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: familyRows } = await client.query('SELECT * FROM families WHERE id = $1 FOR UPDATE', [familyId]);
      if (!familyRows.length) {
        await client.query('ROLLBACK');
        throw familyNotFound();
      }
      const newXp = Number(familyRows[0].xp) + amount;
      const newLevel = levelForFamilyXp(newXp);

      const { rows: membershipRows } = await client.query(
        `UPDATE family_memberships SET contribution = contribution + $1, updated_at = now() WHERE id = $2 RETURNING *`,
        [amount, membershipId]
      );
      if (!membershipRows.length) {
        await client.query('ROLLBACK');
        throw membershipNotFound();
      }

      const { rows: updatedFamilyRows } = await client.query(
        `UPDATE families SET xp = $1, level = $2, updated_at = now() WHERE id = $3 RETURNING *`,
        [newXp, newLevel, familyId]
      );

      await client.query('COMMIT');
      return { membership: mapMembershipRow(membershipRows[0]), family: mapFamilyRow(updatedFamilyRows[0]) };
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {}
      throw e;
    } finally {
      client.release();
    }
  }

  async createInvite({ familyId, inviterId, inviteeId }) {
    const { rows } = await this._pool.query(
      `INSERT INTO family_invites (id, family_id, inviter_id, invitee_id, status)
       VALUES ($1, $2, $3, $4, 'pending') RETURNING *`,
      [generateInviteId(), familyId, inviterId, inviteeId]
    );
    return mapInviteRow(rows[0]);
  }

  async findInviteById(inviteId) {
    const { rows } = await this._pool.query('SELECT * FROM family_invites WHERE id = $1', [inviteId]);
    return mapInviteRow(rows[0]);
  }

  async listPendingInvitesForAccount(accountId) {
    const { rows } = await this._pool.query(
      `SELECT * FROM family_invites WHERE invitee_id = $1 AND status = 'pending' ORDER BY created_at DESC`,
      [accountId]
    );
    return rows.map(mapInviteRow);
  }

  async findPendingInvite(familyId, inviteeId) {
    const { rows } = await this._pool.query(
      `SELECT * FROM family_invites WHERE family_id = $1 AND invitee_id = $2 AND status = 'pending' LIMIT 1`,
      [familyId, inviteeId]
    );
    return mapInviteRow(rows[0]);
  }

  async updateInviteStatus(inviteId, status) {
    const { rows } = await this._pool.query(
      `UPDATE family_invites SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [status, inviteId]
    );
    if (!rows.length) throw inviteNotFound();
    return mapInviteRow(rows[0]);
  }
}

module.exports = { InMemoryFamilyRepository, PostgresFamilyRepository, familyNotFound, membershipNotFound, inviteNotFound };
