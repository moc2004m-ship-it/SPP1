'use strict';
// Dependency-free tests for ../src/rtc/agora-room-access.js — same
// pattern as platform.auth.guards.test.js (no express, no store I/O).

const test = require('node:test');
const assert = require('node:assert/strict');
const { determineRtcRole, assertCanJoinRoomVoice } = require('../src/rtc/agora-room-access');

test('determineRtcRole gives the room owner the host role', () => {
  const room = { id: 'room_1', ownerId: 'owner_1', visibility: 'public' };
  assert.equal(determineRtcRole(room, 'owner_1'), 'host');
});

test('determineRtcRole gives anyone else the audience role', () => {
  const room = { id: 'room_1', ownerId: 'owner_1', visibility: 'public' };
  assert.equal(determineRtcRole(room, 'someone_else'), 'audience');
});

test('assertCanJoinRoomVoice 404s when the room does not exist', () => {
  assert.throws(() => assertCanJoinRoomVoice(null, 'acc_1'), (err) => err.status === 404 && /room not found/.test(err.message));
});

test('assertCanJoinRoomVoice allows any authenticated account into a public room and returns their role', () => {
  const room = { id: 'room_1', ownerId: 'owner_1', visibility: 'public' };
  assert.equal(assertCanJoinRoomVoice(room, 'owner_1'), 'host');
  assert.equal(assertCanJoinRoomVoice(room, 'someone_else'), 'audience');
});

test('assertCanJoinRoomVoice treats an unset visibility the same as public (matches rooms.create default)', () => {
  const room = { id: 'room_1', ownerId: 'owner_1' };
  assert.equal(assertCanJoinRoomVoice(room, 'someone_else'), 'audience');
});

test('assertCanJoinRoomVoice blocks a non-owner from a private room (no membership model exists yet)', () => {
  const room = { id: 'room_1', ownerId: 'owner_1', visibility: 'private' };
  assert.throws(() => assertCanJoinRoomVoice(room, 'intruder'), (err) => err.status === 403 && /private/.test(err.message));
});

test('assertCanJoinRoomVoice still allows the owner into their own private room', () => {
  const room = { id: 'room_1', ownerId: 'owner_1', visibility: 'private' };
  assert.equal(assertCanJoinRoomVoice(room, 'owner_1'), 'host');
});
