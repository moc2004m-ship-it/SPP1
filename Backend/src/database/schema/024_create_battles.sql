-- Stage 18 (PK/Battles) — dedicated battles table.
--
-- Moved off the generic feature_records stage-18 slot (was a bare
-- store.add(18, ...) stub with no state machine and no real effect) onto
-- its own domain, same reasoning as inventory/recharge/gifts/game_matches
-- in Phase 5: a real state machine (pending -> active -> ended, or
-- declined/cancelled) needs real columns and a real constraint, not a
-- free-form JSON blob.
--
-- A room may have at most one PENDING or ACTIVE battle at a time (the
-- partial unique index below) -- this is what makes "the battle currently
-- happening in this room" an unambiguous, server-decided fact, and it is
-- also what services/battle.service.js#recordGiftPoints relies on to know
-- unambiguously which battle a gift's points belong to.
--
-- host_score/opponent_score are NEVER written by a client value -- they
-- only ever move via addScore(), which is only ever called from
-- battle.service.js#recordGiftPoints, itself only ever called from
-- services/gifts.service.js AFTER a real wallet debit + gift record
-- already committed. winner_id is only set by end(), computed from those
-- two real columns, never accepted from a request body.
--
-- NOT executed automatically -- same activation switch as every other
-- table here: STAGE3_ENABLE_POSTGRES=true + DATABASE_URL (see ../index.js).

CREATE TABLE IF NOT EXISTS battles (
    id             TEXT        PRIMARY KEY,   -- server-generated, e.g. battle_<uuid>
    room_id        TEXT        NOT NULL,
    host_id        TEXT        NOT NULL,
    opponent_id    TEXT        NOT NULL,
    status         TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'active', 'declined', 'cancelled', 'ended')),
    host_score     BIGINT      NOT NULL DEFAULT 0 CHECK (host_score >= 0),
    opponent_score BIGINT      NOT NULL DEFAULT 0 CHECK (opponent_score >= 0),
    winner_id      TEXT,
    duration_ms    BIGINT      NOT NULL,
    started_at     TIMESTAMPTZ,
    ends_at        TIMESTAMPTZ,
    ended_at       TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (host_id <> opponent_id)
);

-- At most one pending/active battle per room -- see header. Race-safe the
-- same way gift_wall_sessions_one_active_per_room is: an INSERT that would
-- violate this index fails outright rather than silently creating a second
-- concurrent battle for the same room.
CREATE UNIQUE INDEX IF NOT EXISTS battles_one_open_per_room
    ON battles (room_id)
    WHERE status IN ('pending', 'active');

CREATE INDEX IF NOT EXISTS battles_host_id_idx ON battles (host_id, created_at DESC);
CREATE INDEX IF NOT EXISTS battles_opponent_id_idx ON battles (opponent_id, created_at DESC);
