-- Stage 11 (Private Chat) — conversations, messages, presence.
--
-- A 1:1 conversation exists at most once per unordered pair of users --
-- participant_a is ALWAYS the lexicographically smaller of the two ids
-- (enforced by the application layer, never trusted from a client; see
-- ../repositories/chat.repository.js's sortedPair()), and the unique
-- index below is what makes "the conversation between these two users"
-- an unambiguous fact regardless of call order, same idempotency
-- discipline as gift_wall_sessions_one_active_per_room.
--
-- Messages are append-only. There is no hard DELETE anywhere in this
-- file -- softDeleteMessage() only zeroes body/sticker_id/image_url and
-- flips deleted=true, same "no real delete ever" philosophy as every
-- other domain in this project.
--
-- NOT executed automatically -- same activation switch as every other
-- table here: STAGE3_ENABLE_POSTGRES=true + DATABASE_URL (see ../index.js).

CREATE TABLE IF NOT EXISTS chat_conversations (
    id               TEXT        PRIMARY KEY,  -- server-generated, e.g. conv_<uuid>
    participant_a    TEXT        NOT NULL,      -- always the lexicographically smaller id
    participant_b    TEXT        NOT NULL,      -- always the lexicographically larger id
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_message_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (participant_a < participant_b)
);

-- At most one conversation per unordered pair -- this is what makes
-- getOrCreateConversation() idempotent under real concurrent requests.
CREATE UNIQUE INDEX IF NOT EXISTS chat_conversations_pair_idx
    ON chat_conversations (participant_a, participant_b);

CREATE INDEX IF NOT EXISTS chat_conversations_participant_a_idx ON chat_conversations (participant_a, last_message_at DESC);
CREATE INDEX IF NOT EXISTS chat_conversations_participant_b_idx ON chat_conversations (participant_b, last_message_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
    id                    TEXT        PRIMARY KEY,  -- server-generated, e.g. msg_<uuid>
    conversation_id       TEXT        NOT NULL REFERENCES chat_conversations(id),
    sender_id             TEXT        NOT NULL,
    type                  TEXT        NOT NULL CHECK (type IN ('text', 'emoji', 'sticker', 'image')),
    body                  TEXT,          -- text/emoji only; NULL (and zeroed on delete) otherwise
    sticker_id            TEXT,          -- sticker only, always a ../domain/chat-catalog.js key
    image_url             TEXT,          -- image only, always an http(s) URL
    reply_to_message_id   TEXT        REFERENCES chat_messages(id),
    status                TEXT        NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'read')),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at               TIMESTAMPTZ,
    deleted               BOOLEAN     NOT NULL DEFAULT false,
    deleted_by            TEXT,
    deleted_at            TIMESTAMPTZ,
    reports               JSONB       NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS chat_messages_conversation_created_idx
    ON chat_messages (conversation_id, created_at);

-- Partial index for the common "how many unread do I have" query --
-- only rows that are actually still unread need to be indexed.
CREATE INDEX IF NOT EXISTS chat_messages_unread_idx
    ON chat_messages (conversation_id, sender_id)
    WHERE status <> 'read';

-- One row per account: real heartbeat-derived presence. `status` is the
-- last EXPLICIT state written (heartbeat -> 'online', goOffline ->
-- 'offline') -- the *effective* online/offline shown to another user
-- also factors in how stale last_seen_at is (see
-- ../repositories/chat.repository.js's getPresence(), which derives
-- staleness at read time and never mutates this row just to expire it).
CREATE TABLE IF NOT EXISTS chat_presence (
    account_id  TEXT        PRIMARY KEY,
    status      TEXT        NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'offline')),
    last_seen_at TIMESTAMPTZ,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
