'use strict';

// Stage 17 — Music/DJ bus.
//
// A plain in-process EventEmitter (no network, no Redis) that
// feature-platform.js's `music` domain publishes every real queue/
// playback state change to (add/remove/reorder, play/pause/next/volume,
// DJ grant/revoke) -- so every listener currently in a room's channel
// sees the exact same state at the exact same time, the same "one
// source of truth, fanned out" shape Play/Pause/Volume/Next needs to be
// real-time for every listener, not just the caller who triggered it.
//
// This is a byte-for-byte structural copy of ../realtime/chat-bus.js
// (Stage 11) / ../realtime/notification-bus.js (Stage 33), with
// "conversation"/"recipient" replaced by "room". Same rationale as
// those two files: no WebSocket/SSE layer exists anywhere in this
// project yet (confirmed by repo-wide search -- see those files' own
// headers), so nothing consumes this yet either. Because it is a real
// EventEmitter under the hood, adding a WebSocket/SSE layer later is a
// matter of calling subscribe()/subscribeAll() from that new code --
// nothing here, or in feature-platform.js's music domain, needs to
// change.
//
// Interface:
//   publish(roomId, event)      -- fire-and-forget, never throws, even
//                                   if nobody is subscribed yet.
//   subscribe(roomId, handler)  -- handler is called only for events
//                                   published to that exact roomId.
//                                   Returns an unsubscribe() function.
//   subscribeAll(handler)       -- handler is called for every event
//                                   published to any room. Returns an
//                                   unsubscribe() function.
//
// Deliberately NOT a singleton module-level bus -- createMusicBus()
// returns a fresh instance so tests (and any future multi-tenant use)
// never leak subscribers across instances. src/index.js creates exactly
// one and hands it to createPlatform() (see feature-platform.js's
// `musicBus` constructor dependency).

const { EventEmitter } = require('node:events');

function channelFor(roomId) {
  return `room:${roomId}`;
}

const ALL_CHANNEL = '__all__';

function createMusicBus() {
  const emitter = new EventEmitter();
  // Many rooms over the lifetime of a process each register a listener
  // on their own channel -- that is a large number of distinct event
  // names, not a leak on any single one, but raise the per-channel cap
  // anyway so a busy server never prints a spurious MaxListeners warning
  // for wholly unrelated rooms.
  emitter.setMaxListeners(0);

  function publish(roomId, event) {
    // EventEmitter#emit returns false (does not throw) when an event
    // name has no listeners -- publishing to a room nobody is currently
    // subscribed to (the common case: no real-time layer connected) is
    // a normal, silent no-op, never an error.
    emitter.emit(channelFor(roomId), event);
    emitter.emit(ALL_CHANNEL, roomId, event);
  }

  function subscribe(roomId, handler) {
    const channel = channelFor(roomId);
    emitter.on(channel, handler);
    let unsubscribed = false;
    return function unsubscribe() {
      if (unsubscribed) return; // idempotent -- calling twice is a no-op
      unsubscribed = true;
      emitter.off(channel, handler);
    };
  }

  function subscribeAll(handler) {
    emitter.on(ALL_CHANNEL, handler);
    let unsubscribed = false;
    return function unsubscribe() {
      if (unsubscribed) return;
      unsubscribed = true;
      emitter.off(ALL_CHANNEL, handler);
    };
  }

  return { publish, subscribe, subscribeAll };
}

module.exports = { createMusicBus };
