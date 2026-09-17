'use strict';
const express = require('express');
const { requireSession } = require('../auth/session-middleware');
const { assertCanJoinRoomVoice } = require('../rtc/agora-room-access');

// SECURITY (same rules as ./platform.routes.js):
// - Every route here requires a valid Bearer session (requireSession).
// - The acting identity is ALWAYS req.session.accountId. req.body.userId
//   (or any client-supplied identity) is never used for authorization or
//   passed to the token builder as the uid.
// - The room must exist and the session must be allowed into it
//   (assertCanJoinRoomVoice) before any token is generated.
// - Tokens are generated server-side only, with a limited lifetime set by
//   AGORA_RTC_TOKEN_TTL_SECONDS (see ../rtc/agora-config.js).
// - The response never contains the Agora App Certificate — only the App
//   ID (not secret) and the generated, time-limited token.
function createAgoraRouter({ platform, authStore, tokenService }) {
  const router = express.Router();
  router.use(requireSession(authStore));

  // POST /api/rtc/token  { roomId }  -> { appId, channel, uid, role, token, ttlSeconds, expiresAt }
  router.post('/api/rtc/token', async (req, res) => {
    try {
      const roomId = req.body && req.body.roomId;
      if (!roomId || typeof roomId !== 'string') {
        return res.status(400).json({ ok: false, error: 'roomId is required' });
      }
      const room = await platform.store.find(12, (r) => r.id === roomId);
      const role = assertCanJoinRoomVoice(room, req.session.accountId);
      const data = tokenService.generateRtcToken({
        channelName: roomId,
        account: req.session.accountId,
        role,
      });
      res.json({ ok: true, data });
    } catch (e) {
      res.status(e.status || 400).json({ ok: false, error: e.message });
    }
  });

  return router;
}

module.exports = { createAgoraRouter };
