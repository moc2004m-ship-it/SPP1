-- Phase 5 — Game Matches domain — canonical schema.
--
-- CRITICAL invariant enforced by this design, not just application code:
-- result/winner_id/result_source are only ever written by finishMatch()
-- in ../../services/game-match.service.js, and that function is not
-- reachable from any mobile-facing route yet -- see
-- routes/platform.routes.js POST /api/games/:matchId/finish, which returns
-- 403 until a real, per-game server-side rules engine exists (Ludo,
-- Chess, Snakes & Ladders, ...). That engine is a large, separate body of
-- work per game and is explicitly OUT OF SCOPE of this migration -- see
-- PHASE5_CENTRAL_SYSTEMS_REPORT.md. This table exists now so that engine
-- has a real, tested, idempotent place to write results into, instead of
-- a route trusting a client-supplied "winner" field (which is exactly the
-- fake-result shortcut this project must not take).
--
-- NOT executed automatically -- same activation switch as every other
-- table here: STAGE3_ENABLE_POSTGRES=true + DATABASE_URL (see ../index.js).

CREATE TABLE IF NOT EXISTS game_matches (
    id             TEXT        PRIMARY KEY,     -- server-generated, e.g. match_<uuid>
    room_id        TEXT        NOT NULL,
    game_id        TEXT        NOT NULL,        -- which game (ludo, chess, snakes_ladders, ...)
    version        TEXT        NOT NULL DEFAULT '1',
    started_by     TEXT        NOT NULL REFERENCES accounts(id),
    player_ids     JSONB       NOT NULL DEFAULT '[]'::jsonb,
    state          TEXT        NOT NULL DEFAULT 'lobby'
                       CHECK (state IN ('lobby', 'active', 'finished', 'cancelled')),
    result         JSONB       NULL,             -- only ever set by the server-side engine, never the client
    result_source  TEXT        NULL CHECK (result_source IS NULL OR result_source = 'server'),
    winner_id      TEXT        NULL REFERENCES accounts(id),
    ended_at       TIMESTAMPTZ NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS game_matches_room_id_idx ON game_matches (room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS game_matches_started_by_idx ON game_matches (started_by, created_at DESC);


-- Defense in depth: mobile/client SQL roles must not be able to manufacture
-- a finished result. The application service remains the primary boundary;
-- this trigger additionally rejects non-server session settings. A trusted
-- game-engine connection sets app.game_engine='true' for the transaction.
CREATE OR REPLACE FUNCTION enforce_server_game_result() RETURNS trigger AS $$
BEGIN
  IF (NEW.result IS DISTINCT FROM OLD.result OR NEW.winner_id IS DISTINCT FROM OLD.winner_id OR NEW.result_source IS DISTINCT FROM OLD.result_source OR NEW.state = 'finished')
     AND current_setting('app.game_engine', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'game result may only be finalized by the server game engine' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS game_matches_server_result_guard ON game_matches;
CREATE TRIGGER game_matches_server_result_guard
BEFORE UPDATE ON game_matches
FOR EACH ROW EXECUTE FUNCTION enforce_server_game_result();
