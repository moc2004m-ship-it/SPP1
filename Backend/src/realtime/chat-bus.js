'use strict';

// Stage 11 — Chat bus.
//
// A plain in-process EventEmitter (no network, no Redis) that
// chat.service.js publishes every new message/read-receipt/presence
// change to. Nothing consumes it yet in this stage (no WebSocket/SSE
// layer exists in this project) -- this is infrastructure for a later
// real-time push-to-UI layer, exactly like ../realtime/notification-bus.js
// (Stage 33), which this file is a byte-for-byte structural copy of, with
// "recipient" replaced by "conversation". Because it is a real
// EventEmitter under the hood, adding a WebSocket/SSE layer later is a
// matter of calling subscribe()/subscribeAll() from that new code --
// nothing here needs to change.
//
// Interface:
//   publish(conversationId, event)      -- fire-and-forget, never throws,
//                                           even if nobody is subscribed
//                                           yet.
//   subscribe(conversationId, handler)  -- handler is called only for
//                                           events published to that
//                                           exact conversationId. Returns
//                                           an unsubscribe() function.
//   subscribeAll(handler)               -- handler is called for every
//                                           event published to any
//                                           conversation. Returns an
//                                           unsubscribe() function.
//
// Deliberately NOT a singleton module-level bus -- createChatBus()
// returns a fresh instance so tests (and any future multi-tenant use)
// never leak subscribers across instances. src/index.js creates exactly
// one and hands it to chat.service.js.

const { EventEmitter } = require('node:events');

function channelFor(conversationId) {
  return `conversation:${conversationId}`;
}

const ALL_CHANNEL = '__all__';

function createChatBus() {
  const emitter = new EventEmitter();
  // Many conversations over the lifetime of a process each register a
  // listener on their own channel -- that is a large number of distinct
  // event names, not a leak on any single one, but raise the per-channel
  // cap anyway so a busy server never prints a spurious MaxListeners
  // warning for wholly unrelated conversations.
  emitter.setMaxListeners(0);

  function publish(conversationId, event) {
    // EventEmitter#emit returns false (does not throw) when an event name
    // has no listeners -- publishing to a conversation nobody is
    // currently subscribed to (the common case: no real-time layer
    // connected) is a normal, silent no-op, never an error.
    emitter.emit(channelFor(conversationId), event);
    emitter.emit(ALL_CHANNEL, conversationId, event);
  }

  function subscribe(conversationId, handler) {
    const channel = channelFor(conversationId);
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

module.exports = { createChatBus };
