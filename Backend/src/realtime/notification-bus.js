'use strict';

// Stage 33 — Notification bus.
//
// A plain in-process EventEmitter (no network, no Redis) that
// notification.service.js publishes every created notification to.
// Nothing consumes it yet in this stage (no WebSocket/SSE layer exists in
// this project) -- this is infrastructure for a later real-time push-to-UI
// layer, exactly like a message queue you wire up before you have a
// consumer. Because it is a real EventEmitter under the hood, adding a
// WebSocket/SSE layer later is a matter of calling subscribe()/subscribeAll()
// from that new code -- nothing here needs to change.
//
// Interface:
//   publish(recipientId, event)      -- fire-and-forget, never throws, even
//                                        if nobody is subscribed yet.
//   subscribe(recipientId, handler)  -- handler is called only for events
//                                        published to that exact
//                                        recipientId. Returns an
//                                        unsubscribe() function.
//   subscribeAll(handler)            -- handler is called for every event
//                                        published to any recipient.
//                                        Returns an unsubscribe() function.
//
// Deliberately NOT a singleton module-level bus -- createNotificationBus()
// returns a fresh instance so tests (and any future multi-tenant use) never
// leak subscribers across instances. src/index.js creates exactly one and
// hands it to notification.service.js.

const { EventEmitter } = require('node:events');

function channelFor(recipientId) {
  return `recipient:${recipientId}`;
}

const ALL_CHANNEL = '__all__';

function createNotificationBus() {
  const emitter = new EventEmitter();
  // Many recipients over the lifetime of a process each register a
  // listener on their own channel -- that is a large number of distinct
  // event names, not a leak on any single one, but raise the per-channel
  // cap anyway so a busy server never prints a spurious MaxListeners
  // warning for wholly unrelated recipients.
  emitter.setMaxListeners(0);

  function publish(recipientId, event) {
    // EventEmitter#emit returns false (does not throw) when an event name
    // has no listeners -- publishing to a recipient who is not currently
    // subscribed (the common case: no real-time layer connected) is a
    // normal, silent no-op, never an error.
    emitter.emit(channelFor(recipientId), event);
    emitter.emit(ALL_CHANNEL, recipientId, event);
  }

  function subscribe(recipientId, handler) {
    const channel = channelFor(recipientId);
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

module.exports = { createNotificationBus };
