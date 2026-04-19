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

/** @typedef {{ since: number, tabIds: number[], sampleTitle?: string }} NotifiedHostEntry */

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
  /**
   * From popup/options: active-tab hostname(s) from every normal browser window while the UI is open.
   * Background treats those hosts like the user is still “on” the page (same as window focused).
   */
  TOOL_UI_HOST_HEARTBEAT: 'toolUiHostHeartbeat',
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

/**
 * @param {string} pattern
 * @returns {boolean}
 */
export function isRegexPatternSyntaxValid(pattern) {
  if (typeof pattern !== 'string' || !pattern.trim()) return false;
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

/**
 * @typedef {{ pattern: string, type: string }} StringFilterRule
 */

/**
 * Match a saved string rule against a tab (case-insensitive). Invalid patterns return false.
 * @param {{ url?: string, title?: string }} tab
 * @param {StringFilterRule} rule
 * @param {{ flags?: string }} [opts]
 */
export function tabMatchesStringFilterRule(tab, rule, opts = {}) {
  const flags = opts.flags ?? 'i';
  try {
    const regex = new RegExp(rule.pattern, flags);
    if (rule.type === 'url') return regex.test(tab.url || '');
    if (rule.type === 'title') return regex.test(tab.title || '');
    return false;
  } catch {
    return false;
  }
}

/**
 * @param {{ url?: string, title?: string }} tab
 * @param {StringFilterRule[]} rules
 */
export function tabMatchesAnyStringFilterRules(tab, rules) {
  if (!Array.isArray(rules) || rules.length === 0) return false;
  return rules.some((rule) => tabMatchesStringFilterRule(tab, rule));
}

/**
 * First matching rule in saved order (stable group key for UI).
 * @param {{ url?: string, title?: string }} tab
 * @param {StringFilterRule[]} rules
 * @returns {{ index: number, rule: StringFilterRule } | null}
 */
export function findFirstStringFilterRuleMatch(tab, rules) {
  if (!Array.isArray(rules) || rules.length === 0) return null;
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    if (tabMatchesStringFilterRule(tab, rule)) {
      return { index: i, rule };
    }
  }
  return null;
}

/** @param {unknown} raw */
export function normalizeNotificationMode(raw) {
  return raw === 'badge' || raw === 'popup' || raw === 'both' || raw === 'none' ? raw : 'badge';
}

/**
 * @param {boolean} badgeOn
 * @param {boolean} popupOn
 * @returns {'badge' | 'popup' | 'both' | 'none'}
 */
export function deriveNotificationModeFromBooleans(badgeOn, popupOn) {
  if (badgeOn && popupOn) return 'both';
  if (badgeOn) return 'badge';
  if (popupOn) return 'popup';
  return 'none';
}

/** @param {string} mode */
export function notificationModeIncludesBadge(mode) {
  return mode === 'badge' || mode === 'both';
}

/** @param {string} mode */
export function notificationModeIncludesDigest(mode) {
  return mode === 'popup' || mode === 'both';
}

/**
 * @template T
 * @param {(...args: any[]) => T | Promise<T>} func
 * @param {number} delayMs
 * @returns {(...args: any[]) => void}
 */
export function debounce(func, delayMs) {
  let timeoutId = /** @type {ReturnType<typeof setTimeout> | null} */ (null);
  return function debounced(...args) {
    const context = this;
    if (timeoutId != null) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      timeoutId = null;
      func.apply(context, args);
    }, delayMs);
  };
}

/**
 * MV3: wire an async handler to `sendResponse` and swallow errors into `{ ok: false, error }`.
 * @param {Promise<unknown>} promise
 * @param {(result: unknown) => void} sendResponse
 */
export function forwardPromiseToSendResponse(promise, sendResponse) {
  promise
    .then((result) => sendResponse(result))
    .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
}

/**
 * Focus a tab and its window (extension / popup UI).
 * @param {number} tabId
 * @param {number} windowId
 */
export async function focusTabInWindow(tabId, windowId) {
  await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(windowId, { focused: true });
}
