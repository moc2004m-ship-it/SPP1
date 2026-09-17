'use strict';

// Phase 4 -- pure, dependency-free query/filter helpers backing the new
// GET endpoints for the six previously write-only domains (Battles/Games/
// Gifts/Family/Settings/Moderation+Support). Kept separate from
// platform.routes.js (which needs express) so the actual filtering logic
// can be unit-tested without npm/network access -- same pattern already
// used by platform.guards.js / platform.auth.guards.test.js.
//
// Every function here is a plain array -> array transform over records
// already fetched from platform.store.list(stage); none of them touch the
// store, express, or the network themselves.

// Stage 18 -- myBattles() used to filter raw stage-18 feature_records
// here. Battles moved off that generic store onto their own dedicated
// repository/service (see ../services/battle.service.js#listMine), which
// does its own host-or-opponent filtering at the query level, so this
// helper is removed. Confirmed unreferenced anywhere else in this
// codebase (`grep -rn "myBattles"` -- only this file and its own test,
// both updated together) before deletion.

// Games (stage 19): scoped by the new startedBy field (see
// feature-platform.js) -- the only session-identifying field a game has.
function myGames(records, accountId) {
  return records.filter((r) => r.startedBy === accountId);
}

// Gifts (stage 26) / Gift Wall: room-scoped, not user-scoped -- a gift
// wall is visible to anyone viewing the room, same visibility level as
// GET /api/rooms itself (no per-user restriction exists on room data
// elsewhere in this router).
function giftsForRoom(records, roomId) {
  return records.filter((r) => r.roomId === roomId);
}

// Settings (stage 34): settings.set() is append-only (every write is a
// new record, there is no update-in-place). Reading "current settings"
// means reducing to the most recent record per key. Records must be
// passed in ascending insertion order (which is what
// FeatureStore/repository.list() already returns) so that later entries
// correctly overwrite earlier ones for the same key.
function latestSettingsByKey(records) {
  const latest = new Map();
  for (const r of records) latest.set(r.key, r);
  return Array.from(latest.values());
}

// Moderation reports and support tickets are both stored in stage 35 with
// no shared discriminator field, so the read side must distinguish them
// structurally: a report always has targetId (who was reported), a ticket
// always has messages (its reply thread) -- these are the two fields that
// are unique to each shape given how feature-platform.js constructs them.
function myReports(records, accountId) {
  return records.filter((r) => r.reporterId === accountId && Object.prototype.hasOwnProperty.call(r, 'targetId'));
}

function myTickets(records, accountId) {
  return records.filter((r) => r.reporterId === accountId && Object.prototype.hasOwnProperty.call(r, 'messages'));
}

module.exports = { myGames, giftsForRoom, latestSettingsByKey, myReports, myTickets };
