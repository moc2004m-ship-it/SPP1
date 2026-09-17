// Stage 34 — General Settings model.
//
// Replaces the old primitive `settings.set(input) -> store.add(34, {userId,
// key, value})` (append-only, no validation, no fixed key set — see
// STAGE_34_FINAL_REPORT.md §2 for the before/after). Same boundary
// discipline as notification.model.js: this file owns id shapes and the
// fixed key/value catalog; ../../services/settings.service.js is the only
// caller and owns authorization.
//
// SETTING_KEYS is intentionally exactly the five "new preference domain"
// items identified in the Stage 34 gap analysis (language/sound/mic/
// network/media) — the other Stage 34 items (Account, Privacy,
// Notifications, Devices, Login/Password/OTP, Delete Account, Logout,
// Block/Security, Report, Terms, Help) are real functionality that
// already lives in Stage 5/7/8/10/33/35 (or, for Delete Account/Terms/
// Help, is implemented directly in settings.service.js against those
// same existing systems) — see settings.service.js's header. This model
// does not invent storage for anything beyond the five real new
// preferences, per the explicit instruction not to invent settings
// beyond the original Stage 34 list.
//
// Every value below has a REAL downstream consumer, not just storage:
//   - language: validated against Backend/src/config/config.schema.js's
//     DEFAULT_CONFIG.languages.supported — the exact same list the real
//     Stage 4 Config system already serves to every client. Not a new,
//     parallel list.
//   - mic: a real boolean read by the client immediately after joining a
//     room's voice channel and passed straight into
//     Mobile/app/rtc/agora-voice-client.js's real setMuted() — see
//     Mobile/app/app.js's join handler.
//   - sound / network / media: no existing native audio/network/media
//     pipeline exists in this sandbox to hook into beyond persistence +
//     client read (there is no volume mixer, no data-usage manager, no
//     media autoplay engine anywhere in the repository). Per the task's
//     own instruction ("the backend must persist the authoritative user
//     preference and the mobile/client must consume it"), these are
//     implemented as real, validated, per-user persisted preferences
//     that a real endpoint returns — the client already has everything
//     it needs to condition its own behavior on them. This boundary is
//     documented honestly in STAGE_34_FINAL_REPORT.md rather than faked
//     with an invented backend "sound engine".

const crypto = require('node:crypto');
const { DEFAULT_CONFIG } = require('../../config/config.schema');

function generateSettingId() {
  return `set_${crypto.randomUUID()}`;
}

const SETTING_KEYS = Object.freeze(['language', 'sound', 'mic', 'network', 'media']);

const NETWORK_MODES = Object.freeze(['wifi_only', 'wifi_and_cellular']);

// Real defaults returned for a key the user has never set — matches
// Stage 4's own default language, and otherwise the least-surprising
// value (sound on, mic unmuted by default, cellular allowed, autoplay
// on) so a first-time read never has to special-case "unset".
const DEFAULT_SETTINGS = Object.freeze({
  language: DEFAULT_CONFIG.languages.default,
  sound: true,
  mic: false,
  network: 'wifi_and_cellular',
  media: true,
});

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function assertValidKey(key) {
  if (!SETTING_KEYS.includes(key)) {
    throw badRequest(`key must be one of ${SETTING_KEYS.join(', ')}`);
  }
}

function assertValidBoolean(value, key) {
  if (typeof value !== 'boolean') throw badRequest(`${key} must be a boolean`);
}

// Validates `value` for `key` and returns the normalized value to persist.
// Throws a real 400 for an unknown key or an out-of-range/wrong-type value
// — there is no silent coercion anywhere here.
function validateSettingValue(key, value) {
  assertValidKey(key);
  switch (key) {
    case 'language':
      if (!DEFAULT_CONFIG.languages.supported.includes(value)) {
        throw badRequest(`language must be one of ${DEFAULT_CONFIG.languages.supported.join(', ')}`);
      }
      return value;
    case 'sound':
    case 'mic':
    case 'media':
      assertValidBoolean(value, key);
      return value;
    case 'network':
      if (!NETWORK_MODES.includes(value)) {
        throw badRequest(`network must be one of ${NETWORK_MODES.join(', ')}`);
      }
      return value;
    default:
      // Unreachable: assertValidKey already rejected anything else.
      throw badRequest(`key must be one of ${SETTING_KEYS.join(', ')}`);
  }
}

module.exports = {
  generateSettingId,
  SETTING_KEYS,
  NETWORK_MODES,
  DEFAULT_SETTINGS,
  validateSettingValue,
};
