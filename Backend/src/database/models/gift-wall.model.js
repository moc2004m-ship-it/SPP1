// Stage 26 — Gift Wall model.

const crypto = require('node:crypto');

function generateGiftWallSessionId() {
  return `gws_${crypto.randomUUID()}`;
}

module.exports = { generateGiftWallSessionId };
