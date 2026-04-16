export function getTimeAsHuman(msTime) {
  let text;
  const minutes = getTimeInMinutes(msTime);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days >= 2) text = `${days}d`;
  else if (hours >= 2) text = `${hours}h`;
  else text = `${minutes}m`;
  return text;
}

export function getTimeInMinutes(msTime) {
  return Math.floor(msTime / 60000);
}

/** @typedef {{ since: number, tabIds: number[] }} NotifiedHostEntry */

export const STORE_NAMES = {
  /** `'light'` | `'dark'` — popup UI only */
  POPUP_THEME: 'popupTheme',
  BADGE_COLOR_SCHEME: 'badgeColorScheme',
  REGEX_FILTERS: 'regexFilters',
  /** @deprecated Legacy per-tab timestamps; migrated to NOTIFIED_BY_HOST */
  NOTIFIED_TABS: 'notifiedTabs',
  NOTIFIED_BY_HOST: 'notifiedByHost',
  NOTIFICATION_MODE: 'notificationMode',
  WARNING_PREFS: 'warningPrefs',
};

export const MESSAGE_NAMES = {
  UPDATE_BADGE_NOW: 'updateBadgeNow',
  /** From popup: show list-style desktop notification for current unread hosts */
  SHOW_DESKTOP_SUMMARY: 'showDesktopSummary',
  /** From popup: demo every alert channel that is currently enabled */
  TEST_ALL_ALERTS: 'testAllAlerts',
  /** From popup: demo specific channels, e.g. after enabling one toggle */
  TEST_NOTIFICATION_CHANNELS: 'testNotificationChannels',
};

/** Defaults: badge + digest always on; digest UI prefs are stored. */
export const DEFAULT_WARNING_PREFS = {
  badge: true,
  desktopPopup: false,
  desktopPersistent: true,
  desktopSound: true,
  chimeNotifyMode: 'every',
  toolbarSummary: true,
  chimeSoundId: 'soft',
  chimeDurationMs: 500,
  chimeVolume: 0.85,
};

export const CHIME_SOUND_IDS = /** @type {const} */ (['soft', 'bright', 'low']);

/** @type {Record<string, string>} */
export const CHIME_SOUND_FILES = {
  soft: 'sounds/soft-440.wav',
  bright: 'sounds/bright-660.wav',
  low: 'sounds/low-330.wav',
};

/**
 * Hostname from a tab URL, or null if not http(s).
 * @param {string | undefined} url
 * @returns {string | null}
 */
export function safeHostnameFromTabUrl(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const h = u.hostname;
    return h ? normalizeHost(h) : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} hostname
 * @returns {string}
 */
export function normalizeHost(hostname) {
  return String(hostname).trim().toLowerCase();
}
