'use strict';

// Stage 12 — Create Room catalogs.
//
// Same boundary as chat-catalog.js/guard-catalog.js: a room's theme,
// category/topic, spoken language, and age rule are ALWAYS resolved
// here, server-side, from a fixed key -- never accepted as an arbitrary
// client-supplied string. This keeps every room's discovery metadata
// (the fields other users filter/browse by) referencing one of a known,
// reviewed set of values instead of letting a client stuff free-form
// text into a field that the client UI and discovery filters both treat
// as an enum.
//
// `tags`, by contrast, are intentionally NOT a fixed catalog (real rooms
// need free-form tags) -- see MAX_TAGS/MAX_TAG_LENGTH and normalizeTags()
// in ../database/models/room.model.js, which validates/cleans them
// instead of resolving them against a list here.

const ROOM_THEMES = Object.freeze({
  classic: Object.freeze({ id: 'classic', name: 'Classic', accentColor: '#6C5CE7' }),
  midnight: Object.freeze({ id: 'midnight', name: 'Midnight', accentColor: '#1B1F3B' }),
  sunset: Object.freeze({ id: 'sunset', name: 'Sunset', accentColor: '#FF7E5F' }),
  ocean: Object.freeze({ id: 'ocean', name: 'Ocean', accentColor: '#0984E3' }),
  royal: Object.freeze({ id: 'royal', name: 'Royal', accentColor: '#B8860B' }),
});
const DEFAULT_THEME = 'classic';

const ROOM_CATEGORIES = Object.freeze({
  general: Object.freeze({ id: 'general', name: 'General Chat' }),
  music: Object.freeze({ id: 'music', name: 'Music' }),
  gaming: Object.freeze({ id: 'gaming', name: 'Gaming' }),
  dating: Object.freeze({ id: 'dating', name: 'Dating' }),
  education: Object.freeze({ id: 'education', name: 'Education' }),
  sports: Object.freeze({ id: 'sports', name: 'Sports' }),
  comedy: Object.freeze({ id: 'comedy', name: 'Comedy' }),
});
const DEFAULT_CATEGORY = 'general';

// Spoken/room language -- a discovery/filter field describing what
// language the room's conversation is expected to be in. Deliberately a
// separate, wider catalog from ../../Localization/languages.json (which
// is the app UI's own translation set, currently ar/en only): a room can
// be declared as e.g. a French-speaking room while the app UI itself is
// only translated into Arabic/English so far. Illustrative starting set,
// same "not secret, easy to extend" caveat as every other catalog here.
const ROOM_LANGUAGES = Object.freeze({
  ar: Object.freeze({ code: 'ar', name: 'Arabic' }),
  en: Object.freeze({ code: 'en', name: 'English' }),
  fr: Object.freeze({ code: 'fr', name: 'French' }),
  es: Object.freeze({ code: 'es', name: 'Spanish' }),
  tr: Object.freeze({ code: 'tr', name: 'Turkish' }),
  hi: Object.freeze({ code: 'hi', name: 'Hindi' }),
  ur: Object.freeze({ code: 'ur', name: 'Urdu' }),
  id: Object.freeze({ code: 'id', name: 'Indonesian' }),
  fil: Object.freeze({ code: 'fil', name: 'Filipino' }),
  pt: Object.freeze({ code: 'pt', name: 'Portuguese' }),
});
const DEFAULT_LANGUAGE = 'ar';

// Age rule is a declared room policy, not an enforced identity-verified
// gate (this backend has no age-verification system) -- same honesty
// boundary as every other "declared, not verified" field in this
// project (e.g. profile fields). '18+' only means the room is *labeled*
// as adult-audience; it does not by itself block a minor from joining.
const ROOM_AGE_RULES = Object.freeze({
  all: Object.freeze({ id: 'all', name: 'All ages' }),
  '18+': Object.freeze({ id: '18+', name: '18+' }),
});
const DEFAULT_AGE_RULE = 'all';

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function resolveTheme(themeId) {
  if (themeId === undefined || themeId === null) return ROOM_THEMES[DEFAULT_THEME].id;
  const theme = ROOM_THEMES[themeId];
  if (!theme) throw badRequest(`theme must be one of ${Object.keys(ROOM_THEMES).join(', ')}`);
  return theme.id;
}

function resolveCategory(categoryId) {
  if (categoryId === undefined || categoryId === null) return ROOM_CATEGORIES[DEFAULT_CATEGORY].id;
  const category = ROOM_CATEGORIES[categoryId];
  if (!category) throw badRequest(`category must be one of ${Object.keys(ROOM_CATEGORIES).join(', ')}`);
  return category.id;
}

function resolveLanguage(languageCode) {
  if (languageCode === undefined || languageCode === null) return ROOM_LANGUAGES[DEFAULT_LANGUAGE].code;
  const language = ROOM_LANGUAGES[languageCode];
  if (!language) throw badRequest(`language must be one of ${Object.keys(ROOM_LANGUAGES).join(', ')}`);
  return language.code;
}

function resolveAgeRule(ageRule) {
  if (ageRule === undefined || ageRule === null) return ROOM_AGE_RULES[DEFAULT_AGE_RULE].id;
  const rule = ROOM_AGE_RULES[ageRule];
  if (!rule) throw badRequest(`ageRule must be one of ${Object.keys(ROOM_AGE_RULES).join(', ')}`);
  return rule.id;
}

module.exports = {
  ROOM_THEMES,
  ROOM_CATEGORIES,
  ROOM_LANGUAGES,
  ROOM_AGE_RULES,
  DEFAULT_THEME,
  DEFAULT_CATEGORY,
  DEFAULT_LANGUAGE,
  DEFAULT_AGE_RULE,
  resolveTheme,
  resolveCategory,
  resolveLanguage,
  resolveAgeRule,
};
