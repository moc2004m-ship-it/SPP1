// Stage 31 — Event service.
//
// The ONLY code path allowed to change mission-progress/share/claim
// state. ../database/repositories/event.repository.js is a plain
// data-integrity layer with no opinion on what counts as valid progress
// or when a reward may be paid -- every rule below lives here, same split
// as family.service.js vs family.repository.js.
//
// Honest wiring status (read this before assuming more than is true):
//   - Events and missions themselves come from a real server-side catalog
//     (../domain/events-catalog.js), not the client.
//   - share is fully wired end-to-end: recordShare() is a real action a
//     client can call, it is persisted (event_shares), and it drives real
//     progress on any 'share'-type mission in that event.
//   - gift_sent/gift_received-type missions ARE now driven by real gift
//     sends: gifts.service.js calls incrementMissionsByType() (below) once
//     a send has actually been debited and recorded -- see that file's
//     "Stage 31" comment for the exact call site. This closes the gap this
//     stage originally shipped with (see STAGE31_PROGRESS_STOPPED.md,
//     section 5) without touching sendGift()'s pre-existing debit/create/
//     XP logic (Stage 26/27/28), matching the same additive,
//     optional-dependency pattern already used there for `accounts`.
//   - rewards are real: claimReward() always credits real coins through
//     wallets.credit() (the same repository store.service.js/
//     family.service.js use), with an idempotency key derived from
//     (eventId, missionKey, accountId) so it can never double-pay even if
//     called twice.
//   - countdown is computed from the catalog's real startAt/endAt against
//     the injected clock (`now`), never a stored, staleness-prone field.
//   - history is real: it is the actual list of missions this account has
//     completed and been paid for (event_mission_progress rows with a
//     real claimedAt), not a placeholder feed.

const { EVENTS_CATALOG, statusOf } = require('../domain/events-catalog');

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}
function forbidden(message) {
  return Object.assign(new Error(message), { status: 403 });
}
function conflict(message) {
  return Object.assign(new Error(message), { status: 409 });
}

// Stage 33 -- `notificationService` is an OPTIONAL constructor dependency,
// same additive pattern as gifts.service.js/couple.service.js above. When
// provided, a real completed claim reports EVENT_REWARD_CLAIMED AFTER the
// real wallet credit has already committed. When omitted, behavior is
// byte-for-byte identical to before this stage.
function createEventService({ eventProgress, wallets, notificationService, catalog = EVENTS_CATALOG, now = () => new Date() }) {
  function publicEvent(event) {
    const status = statusOf(event, now());
    const nowMs = now().getTime();
    const secondsToStart = status === 'upcoming' ? Math.max(0, Math.round((Date.parse(event.startAt) - nowMs) / 1000)) : 0;
    const secondsRemaining = status === 'active' ? Math.max(0, Math.round((Date.parse(event.endAt) - nowMs) / 1000)) : 0;
    return {
      id: event.id,
      title: event.title,
      description: event.description,
      startAt: event.startAt,
      endAt: event.endAt,
      status,
      secondsToStart,
      secondsRemaining,
      missions: event.missions.map((m) => ({ key: m.key, title: m.title, type: m.type, targetCount: m.targetCount, rewardCoins: m.rewardCoins })),
    };
  }

  // Looks up an event in the INJECTED catalog (defaults to the real
  // EVENTS_CATALOG) -- deliberately not events-catalog.js's own
  // findEvent(), which always reads the real catalog and would ignore a
  // test's injected fixture catalog.
  function lookupEvent(eventId) {
    const event = catalog.find((e) => e.id === eventId);
    if (!event) {
      throw Object.assign(new Error(`unknown eventId; must be one of ${catalog.map((e) => e.id).join(', ')}`), { status: 404 });
    }
    return event;
  }

  function lookupMission(event, missionKey) {
    const mission = event.missions.find((m) => m.key === missionKey);
    if (!mission) {
      throw Object.assign(
        new Error(`unknown missionKey for event "${event.id}"; must be one of ${event.missions.map((m) => m.key).join(', ')}`),
        { status: 404 }
      );
    }
    return mission;
  }

  async function listEvents() {
    return catalog.map(publicEvent);
  }

  async function getEvent(eventId) {
    return publicEvent(lookupEvent(eventId));
  }

  async function getMyProgress({ eventId, accountId }) {
    const event = lookupEvent(eventId);
    const rows = await eventProgress.listProgressForEvent(eventId, accountId);
    const byMission = new Map(rows.map((r) => [r.missionKey, r]));
    return event.missions.map((m) => {
      const row = byMission.get(m.key);
      return {
        key: m.key,
        title: m.title,
        type: m.type,
        targetCount: m.targetCount,
        rewardCoins: m.rewardCoins,
        progress: row ? row.progress : 0,
        completed: row ? row.completed : false,
        claimed: Boolean(row && row.claimedAt),
        claimedAt: row ? row.claimedAt : null,
      };
    });
  }

  // The one function allowed to move a mission's progress. `amount`
  // defaults to 1 and is always added to the account's current real
  // progress for this (event, mission) -- progress is capped at the
  // mission's real targetCount, it can never overshoot.
  async function incrementMissionProgress({ eventId, missionKey, accountId, amount = 1 }) {
    if (!Number.isInteger(amount) || amount < 1) throw badRequest('amount must be a positive integer');
    const event = lookupEvent(eventId);
    const mission = lookupMission(event, missionKey);
    if (statusOf(event, now()) !== 'active') {
      throw forbidden('this event is not currently active');
    }

    const existing = await eventProgress.getProgress(eventId, missionKey, accountId);
    if (existing && existing.completed) return existing; // already at/over target -- no-op, not an error

    const newProgress = Math.min(mission.targetCount, (existing ? existing.progress : 0) + amount);
    const completed = newProgress >= mission.targetCount;
    return eventProgress.upsertProgress({ eventId, missionKey, accountId, progress: newProgress, completed });
  }

  // Increments progress on every currently-active event's missions of a
  // given `type`, for `accountId`, by `amount` (default 1). This is the
  // integration point other real-action services use to drive
  // gift_sent/gift_received/etc-type missions without needing any
  // knowledge of the events catalog themselves -- they just report "this
  // real thing of type X happened for this account" and this service
  // decides whether that maps to any actual, currently-active mission
  // progress. A type with no matching active mission across the whole
  // catalog is a silent no-op (most real actions in this app do not
  // correspond to any live event at any given moment), not an error --
  // callers should never need to check "is there an event for this"
  // before reporting a real action. Skips ended/upcoming events the same
  // way incrementMissionProgress() itself would (via statusOf()), so this
  // never throws the 403 that a direct incrementMissionProgress() call
  // against an inactive event would.
  async function incrementMissionsByType({ accountId, type, amount = 1 }) {
    const results = [];
    for (const event of catalog) {
      if (statusOf(event, now()) !== 'active') continue;
      for (const mission of event.missions) {
        if (mission.type !== type) continue;
        // eslint-disable-next-line no-await-in-loop
        results.push(await incrementMissionProgress({ eventId: event.id, missionKey: mission.key, accountId, amount }));
      }
    }
    return results;
  }

  // Records a real share action, then -- if this event defines a
  // 'share'-type mission -- feeds that same action into its progress.
  // This is the one mission type this stage fully drives end-to-end.
  async function recordShare({ eventId, accountId }) {
    const event = lookupEvent(eventId);
    if (statusOf(event, now()) !== 'active') {
      throw forbidden('this event is not currently active');
    }
    const share = await eventProgress.recordShare({ eventId, accountId });

    const shareMission = event.missions.find((m) => m.type === 'share');
    let progress = null;
    if (shareMission) {
      progress = await incrementMissionProgress({ eventId, missionKey: shareMission.key, accountId, amount: 1 });
    }
    return { share, progress };
  }

  async function claimReward({ eventId, missionKey, accountId }) {
    const event = lookupEvent(eventId);
    const mission = lookupMission(event, missionKey);

    const progress = await eventProgress.getProgress(eventId, missionKey, accountId);
    if (!progress || !progress.completed) {
      throw conflict('this mission has not been completed yet');
    }
    if (progress.claimedAt) {
      throw conflict('this mission reward was already claimed');
    }

    // markClaimed() is called BEFORE the wallet credit so a
    // duplicate/concurrent claim is rejected (409, from
    // event.repository.js) before a second credit is ever attempted;
    // wallets.credit()'s own idempotency key (derived below) is the
    // second line of defense if the two ever diverge. Unlike donate()'s
    // "debit before grant" (Stage 30), there is no balance check on a
    // credit, so there is no risk symmetric to an insufficient-balance
    // rollback here.
    const claimed = await eventProgress.markClaimed(eventId, missionKey, accountId);
    const idempotencyKey = `event_reward_${eventId}_${missionKey}_${accountId}`;
    const walletTransaction = await wallets.credit(accountId, 'coins', mission.rewardCoins, idempotencyKey);

    if (notificationService) {
      await notificationService.notify({
        recipientId: accountId,
        type: 'EVENT_REWARD_CLAIMED',
        payload: { eventId, missionKey },
      });
    }

    return {
      eventId,
      missionKey,
      rewardCoins: mission.rewardCoins,
      walletTransactionId: walletTransaction.id,
      claimedAt: claimed.claimedAt,
    };
  }

  // Real history: every mission this account has completed and actually
  // been paid for, most recent first, enriched with the catalog's
  // display title/reward for readability.
  async function getHistory({ accountId }) {
    const claims = await eventProgress.listClaimsForAccount(accountId);
    return claims.map((c) => {
      let missionTitle = c.missionKey;
      let rewardCoins = null;
      let eventTitle = c.eventId;
      try {
        const event = lookupEvent(c.eventId);
        eventTitle = event.title;
        const mission = lookupMission(event, c.missionKey);
        missionTitle = mission.title;
        rewardCoins = mission.rewardCoins;
      } catch {
        // Catalog entry no longer exists (e.g. removed in a later
        // release) -- history still reflects the real claim that
        // happened, just without catalog display details.
      }
      return {
        eventId: c.eventId,
        eventTitle,
        missionKey: c.missionKey,
        missionTitle,
        rewardCoins,
        claimedAt: c.claimedAt,
      };
    });
  }

  return { listEvents, getEvent, getMyProgress, incrementMissionProgress, incrementMissionsByType, recordShare, claimReward, getHistory };
}

module.exports = { createEventService };
