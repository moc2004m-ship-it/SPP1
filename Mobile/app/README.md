# Mobile app shell — server-backed

This is a runnable web/mobile shell backed by the local Backend API under `/platform/api/*`.
It deliberately does not fabricate external services: rooms, profiles, events and actions are created/read through the backend process.

Current storage for stages 6–35 remains in-memory until the planned persistent database stage. Restarting the backend clears those domain records.

Open `/Mobile/app/index.html` only when served by the same backend/static host or configure a development proxy; the app expects `/platform` on the same origin.
