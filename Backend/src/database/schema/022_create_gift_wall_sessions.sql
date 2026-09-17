-- Stage 26 (Gifts + Gift Wall) — Gift Wall sessions.
--
-- A "Gift Wall" is scoped to one Host Room Session, not to the room
-- forever: contributions must never leak between one broadcast and the
-- next broadcast in the same room. A room has at most one ACTIVE gift
-- wall session at a time (enforced by the partial unique index below);
-- closing it ends that wall, and the next gift sent to the room opens a
-- brand new session with a clean wall. Nothing here duplicates
-- gifts_log (007_create_gifts.sql) — this only tracks which session a
-- room's gifts currently belong to and the running per-gifter totals for
-- that session. The gift row itself (and its already-real wallet debit)
-- remains gifts_log's job alone.
--
-- NOT executed automatically -- same activation switch as every other
-- table here: STAGE3_ENABLE_POSTGRES=true + DATABASE_URL (see ../index.js).

CREATE TABLE IF NOT EXISTS gift_wall_sessions (
    id         TEXT        PRIMARY KEY,     -- server-generated, e.g. gws_<uuid>
    room_id    TEXT        NOT NULL,
    status     TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at  TIMESTAMPTZ
);

-- At most one active session per room -- this is what makes "the current
-- Gift Wall for this room" an unambiguous, server-decided fact instead of
-- something a client could pick between.
CREATE UNIQUE INDEX IF NOT EXISTS gift_wall_sessions_one_active_per_room
    ON gift_wall_sessions (room_id)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS gift_wall_sessions_room_id_idx ON gift_wall_sessions (room_id, started_at DESC);

-- Running per-gifter contribution total for one Gift Wall session. Always
-- derived server-side from the real, already-debited gift amount
-- (gifts_log.total_cost_coins) -- never from a client-supplied number.
CREATE TABLE IF NOT EXISTS gift_wall_contributions (
    session_id  TEXT   NOT NULL REFERENCES gift_wall_sessions(id),
    gifter_id   TEXT   NOT NULL,
    total_coins BIGINT NOT NULL DEFAULT 0 CHECK (total_coins >= 0),
    PRIMARY KEY (session_id, gifter_id)
);

CREATE INDEX IF NOT EXISTS gift_wall_contributions_ranking_idx
    ON gift_wall_contributions (session_id, total_coins DESC);

-- One row per real gift record ever applied to a wall. The primary key on
-- gift_id is the double-counting guard: applying the same already-sent
-- gift to the wall twice (e.g. a retried event/notification, a re-run
-- job) is a no-op, not a second credit -- the wall amount can never drift
-- from the real sum of gifts_log.
CREATE TABLE IF NOT EXISTS gift_wall_applied_gifts (
    gift_id    TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES gift_wall_sessions(id)
);
