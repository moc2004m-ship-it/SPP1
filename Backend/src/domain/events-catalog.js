// Stage 31 — Server-owned events catalog.
//
// Same boundary as store-catalog.js / gift-catalog.js / family-donations.js:
// an event's missions, targets, and reward amounts are ALWAYS looked up
// here, server-side, from eventId/missionKey -- never accepted as a
// number from the client. A client can say "I completed mission X", but
// the server decides how much progress that is worth and how many coins
// it pays out (see ../services/event.service.js).
//
// Real event content/scheduling belongs to whoever runs live-ops for this
// app -- these are illustrative starting events, not secret, and meant to
// be edited/replaced before real launch (exactly the same disclaimer
// store-catalog.js makes about its own prices).
//
// Each event:
//   id          — stable catalog id, e.g. 'evt_autumn_gifting'
//   title       — display title
//   description — display description
//   startAt     — ISO 8601 instant the event becomes 'active'
//   endAt       — ISO 8601 instant the event becomes 'ended' (exclusive)
//   missions    — array of:
//     key           — stable within the event, e.g. 'send_10_gifts'
//     title         — display title
//     type          — 'gift_sent' | 'gift_received' | 'share' -- what kind
//                      of action moves this mission's progress. 'share' is
//                      driven directly by event.service.js's recordShare();
//                      'gift_sent'/'gift_received' are driven by
//                      gifts.service.js calling
//                      event.service.js's incrementMissionsByType() after a
//                      real gift send -- see event.service.js's file header
//                      for the current, honest wiring status.
//     targetCount   — progress value at which the mission is completed
//     rewardCoins   — coins credited to the wallet on claim

const EVENTS_CATALOG = Object.freeze([
  Object.freeze({
    id: 'evt_autumn_gifting',
    title: 'Autumn Gifting Festival',
    description: 'Send and receive gifts this week for bonus coin rewards.',
    startAt: '2026-09-08T00:00:00.000Z',
    endAt: '2026-09-22T00:00:00.000Z',
    missions: Object.freeze([
      Object.freeze({ key: 'send_10_gifts', title: 'Send 10 gifts', type: 'gift_sent', targetCount: 10, rewardCoins: 500 }),
      Object.freeze({ key: 'receive_10_gifts', title: 'Receive 10 gifts', type: 'gift_received', targetCount: 10, rewardCoins: 500 }),
      Object.freeze({ key: 'share_the_event', title: 'Share this event', type: 'share', targetCount: 1, rewardCoins: 100 }),
    ]),
  }),
  Object.freeze({
    id: 'evt_launch_celebration',
    title: 'Launch Celebration',
    description: 'A short welcome event with an easy first reward.',
    startAt: '2026-09-01T00:00:00.000Z',
    endAt: '2026-09-10T00:00:00.000Z',
    missions: Object.freeze([
      Object.freeze({ key: 'share_the_event', title: 'Share this event', type: 'share', targetCount: 1, rewardCoins: 50 }),
    ]),
  }),
]);

function findEvent(eventId) {
  const event = EVENTS_CATALOG.find((e) => e.id === eventId);
  if (!event) {
    throw Object.assign(new Error(`unknown eventId; must be one of ${EVENTS_CATALOG.map((e) => e.id).join(', ')}`), {
      status: 404,
    });
  }
  return event;
}

function findMission(event, missionKey) {
  const mission = event.missions.find((m) => m.key === missionKey);
  if (!mission) {
    throw Object.assign(
      new Error(`unknown missionKey for event "${event.id}"; must be one of ${event.missions.map((m) => m.key).join(', ')}`),
      { status: 404 }
    );
  }
  return mission;
}

// 'upcoming' | 'active' | 'ended', computed from real timestamps compared
// against `now` -- never a stored/stale status field.
function statusOf(event, now) {
  const nowMs = now.getTime();
  if (nowMs < Date.parse(event.startAt)) return 'upcoming';
  if (nowMs >= Date.parse(event.endAt)) return 'ended';
  return 'active';
}

module.exports = { EVENTS_CATALOG, findEvent, findMission, statusOf };
