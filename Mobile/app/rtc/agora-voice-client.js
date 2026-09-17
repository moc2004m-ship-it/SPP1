// Real Agora Web SDK voice-room client.
//
// This "Mobile" app is a browser-based client (see ../index.html /
// ../app.js — plain HTML/JS, no React Native/Flutter project exists in
// this repo), so the real Agora SDK integration here is the official
// Agora Web SDK (window.AgoraRTC), expected to be loaded on the page —
// see ../index.html, which loads it from Agora's own CDN. This file
// never reimplements RTC/voice itself and never fabricates a connection,
// a participant, or an audio state: every method below either drives the
// real AgoraRTC client or throws, so a missing SDK / missing backend
// token surfaces as a real, visible error instead of a fake success.
//
// fetchRtcToken(roomId) must resolve to exactly what
// POST /platform/api/rtc/token returns (see
// Backend/src/routes/agora.routes.js): { appId, channel, uid, role,
// token, ttlSeconds, expiresAt }. This module does not know or care how
// that request is authenticated -- see app.js for the real Bearer-token
// api() helper it is expected to be built from.
//
// Host/audience is decided by the BACKEND (room ownership -- see
// Backend/src/rtc/agora-room-access.js) and only ever read from the
// token response's `role` field here; this client never lets the local
// user pick their own role.

function createAgoraVoiceClient({ fetchRtcToken, onRemoteUserPublished, onRemoteUserLeft, onConnectionStateChange } = {}) {
  if (typeof fetchRtcToken !== 'function') {
    throw new Error('createAgoraVoiceClient requires fetchRtcToken(roomId)');
  }

  let client = null;
  let localAudioTrack = null;
  let currentRoomId = null;
  let currentRole = null;
  let joined = false;

  function requireSdk() {
    if (typeof AgoraRTC === 'undefined' || !AgoraRTC || typeof AgoraRTC.createClient !== 'function') {
      throw new Error('Agora Web SDK is not loaded (window.AgoraRTC is missing) -- refusing to fake a voice connection');
    }
    return AgoraRTC;
  }

  async function join(roomId) {
    if (!roomId) throw new Error('roomId is required');
    const sdk = requireSdk();
    if (joined) await leave();

    const session = await fetchRtcToken(roomId);
    if (!session || !session.token || !session.appId || !session.channel || !session.role) {
      throw new Error('backend did not return a real Agora token/role; refusing to fake a voice connection');
    }

    client = sdk.createClient({ mode: 'live', codec: 'vp8' });
    if (onConnectionStateChange) client.on('connection-state-change', onConnectionStateChange);
    // Real remote participants only -- these events fire from Agora's own
    // signaling, never invented client-side.
    if (onRemoteUserPublished) {
      client.on('user-published', async (user, mediaType) => {
        await client.subscribe(user, mediaType);
        onRemoteUserPublished(user, mediaType);
      });
    }
    if (onRemoteUserLeft) client.on('user-left', onRemoteUserLeft);

    await client.setClientRole(session.role === 'host' ? 'host' : 'audience');
    await client.join(session.appId, session.channel, session.token, session.uid);

    // Only a host (server-decided -- see Backend/src/rtc/agora-room-access.js)
    // publishes a real microphone track. Audience members subscribe only;
    // this is the seat/mic-permission boundary this build can enforce
    // today -- per-seat mic grants beyond host/audience are a follow-up
    // once a real seat-request approval flow exists (see stage 14,
    // rooms.seat(), which already records seat REQUESTS but not yet
    // approvals).
    if (session.role === 'host') {
      localAudioTrack = await sdk.createMicrophoneAudioTrack();
      await client.publish([localAudioTrack]);
    }

    currentRoomId = roomId;
    currentRole = session.role;
    joined = true;
    return { role: session.role, uid: session.uid, channel: session.channel };
  }

  async function leave() {
    if (localAudioTrack) {
      try { localAudioTrack.stop(); } catch (e) { /* already stopped */ }
      try { localAudioTrack.close(); } catch (e) { /* already closed */ }
      localAudioTrack = null;
    }
    if (client) {
      await client.leave();
      client = null;
    }
    joined = false;
    currentRoomId = null;
    currentRole = null;
  }

  // Re-fetches a fresh token (tokens are short-lived by design -- see
  // AGORA_RTC_TOKEN_TTL_SECONDS in Backend/src/rtc/agora-config.js) and
  // rejoins the same room. Used both for an explicit "reconnect" action
  // and for automatic recovery on connection-state-change === 'DISCONNECTED'
  // (wired by the caller via onConnectionStateChange, kept outside this
  // module so retry/backoff policy stays a UI concern, not baked in here).
  async function reconnect() {
    if (!currentRoomId) throw new Error('nothing to reconnect -- join() has not been called yet');
    const roomId = currentRoomId;
    await leave();
    return join(roomId);
  }

  async function setMuted(muted) {
    if (!localAudioTrack) throw new Error('no local microphone track to mute/unmute (only a host/mic-seat holder has one)');
    await localAudioTrack.setEnabled(!muted);
    return muted;
  }

  function isJoined() { return joined; }
  function getRole() { return currentRole; }
  function getRoomId() { return currentRoomId; }

  return { join, leave, reconnect, setMuted, isJoined, getRole, getRoomId };
}
