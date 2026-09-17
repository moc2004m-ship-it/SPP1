'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createNotificationBus } = require('../src/realtime/notification-bus');

test('publish delivers only to a subscriber with the matching recipientId', () => {
  const bus = createNotificationBus();
  const receivedA = [];
  const receivedB = [];
  bus.subscribe('usr_a', (event) => receivedA.push(event));
  bus.subscribe('usr_b', (event) => receivedB.push(event));

  bus.publish('usr_a', { hello: 'a' });

  assert.deepEqual(receivedA, [{ hello: 'a' }]);
  assert.deepEqual(receivedB, []);
});

test('subscribeAll receives every published event regardless of recipient', () => {
  const bus = createNotificationBus();
  const all = [];
  bus.subscribeAll((recipientId, event) => all.push({ recipientId, event }));

  bus.publish('usr_a', { n: 1 });
  bus.publish('usr_b', { n: 2 });

  assert.deepEqual(all, [
    { recipientId: 'usr_a', event: { n: 1 } },
    { recipientId: 'usr_b', event: { n: 2 } },
  ]);
});

test('unsubscribe actually stops further delivery to that handler', () => {
  const bus = createNotificationBus();
  const received = [];
  const unsubscribe = bus.subscribe('usr_a', (event) => received.push(event));

  bus.publish('usr_a', { n: 1 });
  unsubscribe();
  bus.publish('usr_a', { n: 2 });

  assert.deepEqual(received, [{ n: 1 }]);
});

test('unsubscribe from subscribeAll actually stops further delivery', () => {
  const bus = createNotificationBus();
  const received = [];
  const unsubscribe = bus.subscribeAll((recipientId, event) => received.push(event));

  bus.publish('usr_a', { n: 1 });
  unsubscribe();
  bus.publish('usr_a', { n: 2 });

  assert.deepEqual(received, [{ n: 1 }]);
});

test('calling unsubscribe twice is a harmless no-op', () => {
  const bus = createNotificationBus();
  const received = [];
  const unsubscribe = bus.subscribe('usr_a', (event) => received.push(event));
  unsubscribe();
  assert.doesNotThrow(() => unsubscribe());
  bus.publish('usr_a', { n: 1 });
  assert.deepEqual(received, []);
});

test('publish with zero subscribers never throws', () => {
  const bus = createNotificationBus();
  assert.doesNotThrow(() => bus.publish('nobody_subscribed', { n: 1 }));
});

test('a handler subscribed to one recipient does not see events for a different recipient published later', () => {
  const bus = createNotificationBus();
  const received = [];
  bus.subscribe('usr_a', (event) => received.push(event));
  bus.publish('usr_c', { n: 'not for a' });
  bus.publish('usr_a', { n: 'for a' });
  assert.deepEqual(received, [{ n: 'for a' }]);
});
