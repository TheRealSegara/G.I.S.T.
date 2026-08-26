// Shared helpers for _studentAuthHandler.js (signup/login), _sessionHandler.js
// and _teacherRosterHandler.js: name normalization, and the allowed-value
// lists mirrored from src/App.jsx's avatar builder constants (AVATAR_HEADS,
// SKIN_TONES, BADGE_COLORS, ACCESSORY_STICKERS, ANIMAL_COMPANIONS) so a
// request can't smuggle an arbitrary string into stored avatar data. Keep
// these lists in sync with App.jsx if the avatar builder's options ever
// change.

export const ALLOWED_HEADS = ["child", "girl", "boy"];
export const ALLOWED_SKIN_TONES = ["", "🏻", "🏼", "🏽", "🏾", "🏿"];
export const ALLOWED_BADGES = ["khaki", "red", "blue", "purple", "green", "orange", "teal", "pink"];
export const ALLOWED_ACCESSORIES = ["backpack", "cap", "sunglasses", "binoculars", "compass", "boots", "camera", "none"];
export const ALLOWED_ANIMALS = ["orangutan", "tiger", "parrot", "turtle", "butterfly", "monkey", "owl", "gecko"];

// Case/whitespace-insensitive so "Ahmad Bin Ali" and "ahmad  bin ali" (a
// student retyping their name slightly differently) match the same
// account, and used as the DB lookup key alongside access_code_label.
export function normalizeName(name) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function isValidFullName(name) {
  return typeof name === "string" && name.trim().length >= 1 && name.trim().length <= 80;
}

export function isValidAvatarConfig(config) {
  return (
    config &&
    typeof config === "object" &&
    !Array.isArray(config) &&
    ALLOWED_HEADS.includes(config.head) &&
    ALLOWED_SKIN_TONES.includes(config.skinTone) &&
    ALLOWED_BADGES.includes(config.badge) &&
    ALLOWED_ACCESSORIES.includes(config.accessory) &&
    ALLOWED_ANIMALS.includes(config.companion) &&
    Object.keys(config).length === 5
  );
}
