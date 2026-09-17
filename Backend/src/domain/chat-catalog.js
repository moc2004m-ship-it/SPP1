'use strict';

// Stage 11 — Private Chat sticker catalog.
//
// Same boundary as gift-catalog.js/guard-catalog.js: a message's
// `stickerId` is ALWAYS resolved here, server-side, from a fixed key --
// never accepted as an arbitrary client-supplied url/name. This keeps
// every sticker message ever sent referencing one of a known, reviewed
// set of assets instead of letting a client point a "sticker" message at
// an arbitrary (and unmoderated) URL -- that risk is exactly why `image`
// messages are validated only as a well-formed http(s) URL (see
// ../database/models/chat.model.js) while `sticker` messages resolve to
// one of these fixed, reviewed entries instead.
//
// Real asset URLs are an illustrative placeholder (this backend has no
// CDN/asset pipeline of its own) -- meant to be replaced with real hosted
// sticker art before launch, same "illustrative, not secret" note as
// gift-catalog.js's GIFTS.

const STICKERS = Object.freeze({
  sticker_like: Object.freeze({ id: 'sticker_like', name: 'Like', url: 'https://cdn.example.com/stickers/like.png' }),
  sticker_love: Object.freeze({ id: 'sticker_love', name: 'Love', url: 'https://cdn.example.com/stickers/love.png' }),
  sticker_laugh: Object.freeze({ id: 'sticker_laugh', name: 'Laugh', url: 'https://cdn.example.com/stickers/laugh.png' }),
  sticker_wow: Object.freeze({ id: 'sticker_wow', name: 'Wow', url: 'https://cdn.example.com/stickers/wow.png' }),
  sticker_sad: Object.freeze({ id: 'sticker_sad', name: 'Sad', url: 'https://cdn.example.com/stickers/sad.png' }),
  sticker_thumbsup: Object.freeze({ id: 'sticker_thumbsup', name: 'Thumbs Up', url: 'https://cdn.example.com/stickers/thumbsup.png' }),
});

function resolveSticker(stickerId) {
  const sticker = STICKERS[stickerId];
  if (!sticker) {
    throw Object.assign(
      new Error(`unknown stickerId; must be one of ${Object.keys(STICKERS).join(', ')}`),
      { status: 400 }
    );
  }
  return sticker;
}

module.exports = { STICKERS, resolveSticker };
