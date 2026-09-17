// Stage 31 — Event model.
//
// Same boundary as family.model.js/gift.model.js: nothing here accepts a
// client-supplied id or progress value. Ids are always generated here;
// progress/completed/claimedAt are always computed by
// ../../services/event.service.js from server-side state, never copied
// from req.body.

const crypto = require('node:crypto');

function generateEventShareId() {
  return `esh_${crypto.randomUUID()}`;
}

function generateEventProgressId() {
  return `eprog_${crypto.randomUUID()}`;
}

module.exports = { generateEventShareId, generateEventProgressId };
