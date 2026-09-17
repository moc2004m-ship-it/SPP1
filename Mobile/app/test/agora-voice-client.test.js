'use strict';
// Loads the ACTUAL rtc/agora-voice-client.js via node:vm (same technique
// as app.auth.test.js) with a fake `AgoraRTC` global standing in for the
// real Agora Web SDK -- there is no browser and no network in this
// sandbox to load the real CDN script (see ../../index.html). This tests
// this module's own join/leave/reconnect/mute logic and its "never fake
// a connection" behavior; it does NOT verify real audio flows through a
// real Agora server -- that is BLOCKED and recorded honestly in
// AGORA_VOICE_REPORT.md.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const CLIENT_JS = fs.readFileSync(path.join(__dirname, '../rtc/agora-voice-client.js'), 'utf8');

function fakeAgoraRtc() {
  const events = {};
  const publishedTracks = [];
  let leftCalled = false;
  const track = { stopped: false, closed: false, enabled: true, stop() { this.stopped = true; }, close() { this.closed = true; }, async setEnabled(v) { this.enabled = v; } };
  const client = {
    role: null,
    joinedWith: null,
    on(event, cb) { events[event] = cb; },
    async setClientRole(role) { this.role = role; },
    async join(appId, channel, token, uid) { this.joinedWith = { appId, channel, token, uid }; },
    async publish(tracks) { publishedTracks.push(...tracks); },
    async leave() { leftCalled = true; },
  };
  const AgoraRTC = {
    _client: client,
    _track: track,
    _events: events,
    _publishedTracks: publishedTracks,
    get _leftCalled() { return leftCalled; },
    createClient() { return client; },
    async createMicrophoneAudioTrack() { return track; },
  };
  return AgoraRTC;
}

function loadClient({ AgoraRTC } = {}) {
  const sandbox = { AgoraRTC, console };
  vm.createContext(sandbox);
  vm.runInContext(CLIENT_JS, sandbox, { filename: 'agora-voice-client.js' });
  return sandbox;
}

test('throws when constructed without fetchRtcToken', () => {
  const sandbox = loadClient({ AgoraRTC: fakeAgoraRtc() });
  assert.throws(() => vm.runInContext('createAgoraVoiceClient({})', sandbox), /requires fetchRtcToken/);
});

test('join() throws a real error (does not fake a connection) when the Agora SDK is not loaded', async () => {
  const sandbox = loadClient({ AgoraRTC: undefined });
  sandbox.fetchRtcToken = async () => ({ appId: 'a', channel: 'c', uid: 'u', role: 'host', token: 't' });
  const client = vm.runInContext('createAgoraVoiceClient({ fetchRtcToken })', sandbox);
  await assert.rejects(() => client.join('room_1'), /Agora Web SDK is not loaded/);
});

test('join() throws when the backend does not return a real token (no fake success)', async () => {
  const AgoraRTC = fakeAgoraRtc();
  const sandbox = loadClient({ AgoraRTC });
  sandbox.fetchRtcToken = async () => ({ ok: false });
  const client = vm.runInContext('createAgoraVoiceClient({ fetchRtcToken })', sandbox);
  await assert.rejects(() => client.join('room_1'), /refusing to fake a voice connection/);
});

test('join() as host: sets role, joins with the exact server-issued values, and publishes a real mic track', async () => {
  const AgoraRTC = fakeAgoraRtc();
  const sandbox = loadClient({ AgoraRTC });
  sandbox.fetchRtcToken = async (roomId) => ({ appId: 'app_1', channel: roomId, uid: 'acc_1', role: 'host', token: 'tok_abc', ttlSeconds: 3600, expiresAt: '2026-01-01T00:00:00.000Z' });
  const client = vm.runInContext('createAgoraVoiceClient({ fetchRtcToken })', sandbox);

  const info = await client.join('room_42');

  assert.equal(AgoraRTC._client.role, 'host');
  assert.deepEqual(AgoraRTC._client.joinedWith, { appId: 'app_1', channel: 'room_42', token: 'tok_abc', uid: 'acc_1' });
  assert.equal(AgoraRTC._publishedTracks.length, 1);
  assert.equal(info.role, 'host');
  assert.equal(client.isJoined(), true);
  assert.equal(client.getRole(), 'host');
  assert.equal(client.getRoomId(), 'room_42');
});

test('join() as audience: subscribes only, never publishes a local mic track', async () => {
  const AgoraRTC = fakeAgoraRtc();
  const sandbox = loadClient({ AgoraRTC });
  sandbox.fetchRtcToken = async (roomId) => ({ appId: 'app_1', channel: roomId, uid: 'acc_2', role: 'audience', token: 'tok_xyz' });
  const client = vm.runInContext('createAgoraVoiceClient({ fetchRtcToken })', sandbox);

  await client.join('room_42');

  assert.equal(AgoraRTC._client.role, 'audience');
  assert.equal(AgoraRTC._publishedTracks.length, 0);
  assert.equal(client.getRole(), 'audience');
});

test('leave() stops the mic track and leaves the real client, resetting state', async () => {
  const AgoraRTC = fakeAgoraRtc();
  const sandbox = loadClient({ AgoraRTC });
  sandbox.fetchRtcToken = async (roomId) => ({ appId: 'app_1', channel: roomId, uid: 'acc_1', role: 'host', token: 'tok_abc' });
  const client = vm.runInContext('createAgoraVoiceClient({ fetchRtcToken })', sandbox);
  await client.join('room_1');

  await client.leave();

  assert.equal(AgoraRTC._track.stopped, true);
  assert.equal(AgoraRTC._track.closed, true);
  assert.equal(AgoraRTC._leftCalled, true);
  assert.equal(client.isJoined(), false);
  assert.equal(client.getRoomId(), null);
});

test('reconnect() re-fetches a token and rejoins the same room', async () => {
  const AgoraRTC = fakeAgoraRtc();
  const sandbox = loadClient({ AgoraRTC });
  let fetchCount = 0;
  sandbox.fetchRtcToken = async (roomId) => { fetchCount += 1; return { appId: 'app_1', channel: roomId, uid: 'acc_1', role: 'host', token: `tok_${fetchCount}` }; };
  const client = vm.runInContext('createAgoraVoiceClient({ fetchRtcToken })', sandbox);
  await client.join('room_9');

  const info = await client.reconnect();

  assert.equal(fetchCount, 2);
  assert.equal(AgoraRTC._client.joinedWith.token, 'tok_2');
  assert.equal(info.role, 'host');
  assert.equal(client.getRoomId(), 'room_9');
});

test('reconnect() throws when nothing has been joined yet', async () => {
  const sandbox = loadClient({ AgoraRTC: fakeAgoraRtc() });
  sandbox.fetchRtcToken = async () => ({});
  const client = vm.runInContext('createAgoraVoiceClient({ fetchRtcToken })', sandbox);
  await assert.rejects(() => client.reconnect(), /nothing to reconnect/);
});

test('setMuted() toggles the real local track and throws for an audience member with no track', async () => {
  const AgoraRTC = fakeAgoraRtc();
  const sandbox = loadClient({ AgoraRTC });
  sandbox.fetchRtcToken = async (roomId) => ({ appId: 'app_1', channel: roomId, uid: 'acc_1', role: 'host', token: 'tok_abc' });
  const client = vm.runInContext('createAgoraVoiceClient({ fetchRtcToken })', sandbox);
  await client.join('room_1');

  await client.setMuted(true);
  assert.equal(AgoraRTC._track.enabled, false);
  await client.setMuted(false);
  assert.equal(AgoraRTC._track.enabled, true);

  await client.leave();
  await assert.rejects(() => client.setMuted(true), /no local microphone track/);
});

test('join() surfaces real remote user events instead of inventing fake participants', async () => {
  const AgoraRTC = fakeAgoraRtc();
  const sandbox = loadClient({ AgoraRTC });
  sandbox.fetchRtcToken = async (roomId) => ({ appId: 'app_1', channel: roomId, uid: 'acc_2', role: 'audience', token: 'tok_xyz' });
  const publishedEvents = [];
  sandbox.onRemoteUserPublished = (user, mediaType) => publishedEvents.push({ user, mediaType });
  const client = vm.runInContext('createAgoraVoiceClient({ fetchRtcToken, onRemoteUserPublished })', sandbox);
  await client.join('room_1');

  AgoraRTC._client.subscribe = async () => {};
  await AgoraRTC._events['user-published']({ uid: 'acc_remote_9' }, 'audio');

  assert.equal(publishedEvents.length, 1);
  assert.equal(publishedEvents[0].user.uid, 'acc_remote_9');
});
