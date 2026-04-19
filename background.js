import { DEFAULT_BADGE_COLORS, DEFAULT_SUGGESTIONS } from './suggestions.js';
import * as UTILS from './utils.js';

// === background.js ===
let lastTitles = {};
let lastFavicons = {};
/** Last hostname for which this tab matched a filter; used to detect title-only churn vs first match on a host. */
let lastMatchedHostByTab = {};
let regexRules = [];
/** Dedupe spurious repeated `windows.onFocusChanged` for the same active tab (clears unread and re-arms digest). */
const lastFocusHandledByWindow = new Map();
let timeoutId = null;

/** Single list notification for all unread hosts (replaces per-host basic toasts). */
const DIGEST_NOTIFICATION_ID = 'inboxradar-unread-digest';
/** Fingerprint of last successfully shown digest; avoids clear+create on every updateBadge. */
let lastDigestNotificationSignature = '';
let lastExtensionChimeAt = 0;
/** Minimum time between any two notification chimes (cross-site). */
const CHIME_GLOBAL_COOLDOWN_MS = 4500;
const ACTION_DEFAULT_ICON_PATH = 'icons/icon128.png';
const ACTION_WARNING_ICON_PATH = 'icons/icon128.png';
let actionWarningIconActive = false;

/** Brief badge color pulse when new background activity updates the badge. */
const BADGE_PULSE_HIGHLIGHT = '#ffeb3e';
let badgePulseTimeouts = [];
let lastBadgePulseAt = 0;

const TEST_NOTIFY_LIST_ID = 'inboxradar-test-list';

/** Ignore duplicate tab updates (same title/favicon) on other tabs matching the same filter(s). */
const FILTER_NOTIFY_DEDUPE_MS = 2500;
/** @type Map<string, { sig: string, at: number }> */
const lastNotifyByFilterKey = new Map();

// Note: "already-pending" state (tab already fired a full alert) is derived from persisted
// notifiedByHost[host].tabIds rather than an in-memory Set, so it survives service-worker
// restarts (Chrome MV3 workers are terminated after ~30 s of idleness).

// --- small Chrome / Promise helpers ---

/** @returns {Promise<Map<number, chrome.tabs.Tab>>} */
async function tabsByIdMap() {
  const tabs = await chrome.tabs.query({});
  return new Map(tabs.map((t) => [t.id, t]));
}

function clearDigestNotification() {
  return new Promise((r) => chrome.notifications.clear(DIGEST_NOTIFICATION_ID, r));
}

/**
 * @param {(cb: () => void) => void} callWithCallback
 * @returns {Promise<string | undefined>} Chrome lastError.message, if any
 */
function chromeLastError(callWithCallback) {
  return new Promise((resolve) => {
    callWithCallback(() => resolve(chrome.runtime.lastError?.message));
  });
}

async function getNotificationsPermission() {
  if (!chrome.notifications.getPermissionLevel) return 'unknown';
  try {
    return await new Promise((resolve) => {
      chrome.notifications.getPermissionLevel((level) => resolve(level || 'unknown'));
    });
  } catch {
    return 'unknown';
  }
}

/** @returns {('badge' | 'desktop_list' | 'chime')[]} */
function channelsEnabledForCurrentSettings(mode, prefs) {
  const channels = /** @type {('badge' | 'desktop_list' | 'chime')[]} */ ([]);
  if (UTILS.notificationModeIncludesBadge(mode)) channels.push('badge');
  if (UTILS.notificationModeIncludesDigest(mode)) channels.push('desktop_list');
  if (prefs.desktopSound) channels.push('chime');
  return channels;
}

function clearBadgePulse() {
  badgePulseTimeouts.forEach(clearTimeout);
  badgePulseTimeouts = [];
}

function pulseBadgeBackground(finalColor) {
  clearBadgePulse();
  const seq = [
    BADGE_PULSE_HIGHLIGHT,
    finalColor,
    BADGE_PULSE_HIGHLIGHT,
    finalColor,
    BADGE_PULSE_HIGHLIGHT,
    finalColor,
  ];
  let i = 0;
  const step = () => {
    if (i >= seq.length) return;
    chrome.action.setBadgeBackgroundColor({ color: seq[i] });
    i++;
    if (i < seq.length) badgePulseTimeouts.push(setTimeout(step, 90));
  };
  step();
}

function maybePulseBadgeForAttention(finalColor) {
  const now = Date.now();
  if (now - lastBadgePulseAt < 1800) return;
  lastBadgePulseAt = now;
  pulseBadgeBackground(finalColor);
}

/**
 * Switches the toolbar icon to warning mode when some filters have no matching open tabs.
 * @param {boolean} active
 */
function syncActionWarningIcon(active) {
  if (actionWarningIconActive === active) return;
  actionWarningIconActive = active;
  chrome.action.setIcon({
    path: active ? ACTION_WARNING_ICON_PATH : ACTION_DEFAULT_ICON_PATH,
  });
}

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    try {
      await chrome.tabs.create({
        url: chrome.runtime.getURL('welcome.html'),
        active: true,
      });
    } catch (e) {
      console.warn('Could not open welcome tab:', e);
    }
  }
  await bootExtension();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action === 'OFFSCREEN_BEEP') {
    return false;
  }
  if (message?.action === 'CHIME_OFFSCREEN_DONE') {
    if (chrome.offscreen?.closeDocument) {
      chrome.offscreen.closeDocument().catch(() => {});
    }
    return false;
  }
  if (message.action === UTILS.MESSAGE_NAMES.UPDATE_BADGE_NOW) {
    updateBadge();
    return;
  }
  if (message.action === UTILS.MESSAGE_NAMES.TOOL_UI_HOST_HEARTBEAT) {
    const raw = message.hosts;
    const hosts = Array.isArray(raw)
      ? [...new Set(raw.filter((h) => typeof h === 'string' && h.length > 0))]
      : [];
    if (hosts.length === 0) {
      clearExtensionToolUiSession().catch(() => {});
    } else {
      refreshExtensionToolUiSession(hosts).catch(() => {});
    }
    return;
  }
  if (message.action === UTILS.MESSAGE_NAMES.SHOW_DESKTOP_SUMMARY) {
    showDesktopSummaryNotification();
    return;
  }
  if (message.action === UTILS.MESSAGE_NAMES.TEST_ALL_ALERTS) {
    UTILS.forwardPromiseToSendResponse(runTestAllEnabledAlerts(), sendResponse);
    return true;
  }
  if (message.action === UTILS.MESSAGE_NAMES.TEST_NOTIFICATION_CHANNELS) {
    const raw = message.channels;
    const channels = Array.isArray(raw)
      ? raw.filter((c) => c === 'badge' || c === 'desktop_list' || c === 'chime')
      : [];
    UTILS.forwardPromiseToSendResponse(runTestNotificationChannels(channels), sendResponse);
    return true;
  }
});

chrome.windows.onFocusChanged.addListener(async function clearNotificationFromFocusedWindow(windowId) {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;

  const tabs = await chrome.tabs.query({ active: true, windowId });
  const tab = tabs[0];
  if (!tab) return;

  const now = Date.now();
  const prev = lastFocusHandledByWindow.get(windowId);
  if (prev && prev.tabId === tab.id && now - prev.at < 500) {
    return;
  }
  lastFocusHandledByWindow.set(windowId, { tabId: tab.id, at: now });

  await handleTabVisited(tab.id);
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.regexFilters?.newValue) {
    regexRules = changes.regexFilters.newValue.map((r) => ({
      pattern: new RegExp(r.pattern, 'i'),
      type: r.type,
    }));
    updateBadge();
  }
  if (changes[UTILS.STORE_NAMES.WARNING_PREFS] || changes[UTILS.STORE_NAMES.NOTIFICATION_MODE]) {
    updateBadge();
  }
});

function tabMatchesRegexRules(tab, title) {
  return regexRules.some((rule) => {
    if (rule.type === 'url') return rule.pattern.test(tab.url);
    if (rule.type === 'title') return rule.pattern.test(title);
    return false;
  });
}

function tabMatchesSingleRegexRule(tab, rule) {
  const haystack = rule.type === 'title' ? tab.title || '' : tab.url || '';
  return rule.pattern.test(haystack);
}

/**
 * Stable id per saved filter row (type + pattern + index).
 * @param {chrome.tabs.Tab} tab
 * @param {string} title
 * @returns {string[]}
 */
function collectMatchingFilterKeys(tab, title) {
  const keys = [];
  const tabWithTitle = { ...tab, title };
  for (let i = 0; i < regexRules.length; i++) {
    const rule = regexRules[i];
    if (tabMatchesSingleRegexRule(tabWithTitle, rule)) {
      keys.push(`${rule.type}:${rule.pattern.source}:${i}`);
    }
  }
  return keys;
}

function pruneFilterNotifyDedupe(now) {
  for (const [k, v] of lastNotifyByFilterKey) {
    if (now - v.at > 60000) lastNotifyByFilterKey.delete(k);
  }
}

/**
 * True when every matching filter was notified with the same signature recently (other tabs, same “message”).
 * @param {string[]} filterKeys
 * @param {string} sig
 * @param {number} now
 */
function isDuplicateMultiTabNotification(filterKeys, sig, now) {
  pruneFilterNotifyDedupe(now);
  if (filterKeys.length === 0) return false;
  for (const fk of filterKeys) {
    const prev = lastNotifyByFilterKey.get(fk);
    if (!prev || prev.sig !== sig || now - prev.at >= FILTER_NOTIFY_DEDUPE_MS) {
      return false;
    }
  }
  return true;
}

/**
 * @param {string[]} filterKeys
 * @param {string} sig
 * @param {number} now
 */
function recordFilterNotification(filterKeys, sig, now) {
  for (const fk of filterKeys) {
    lastNotifyByFilterKey.set(fk, { sig, at: now });
  }
}

/** Session snapshot written by the popup/options heartbeat while the tool UI is open. */
const SESSION_TOOL_UI_SNAPSHOT = 'inboxRadarToolUiHostSnapshot';
/** Heartbeats arrive every 4s; treat as stale after this so SW restarts do not leave stale “open” state. */
const TOOL_UI_SNAPSHOT_MAX_AGE_MS = 15000;
async function refreshExtensionToolUiSession(hosts) {
  const session = chrome.storage?.session;
  if (!session?.set) return;
  await session.set({
    [SESSION_TOOL_UI_SNAPSHOT]: { hosts, at: Date.now() },
  });
}

async function clearExtensionToolUiSession() {
  const session = chrome.storage?.session;
  if (!session?.remove) return;
  await session.remove(SESSION_TOOL_UI_SNAPSHOT);
}

/**
 * True while popup/options is open and recently reported this host as an active-tab hostname
 * in some normal browser window (user is using the tool over that page).
 * @param {string} host
 */
async function isExtensionToolUiShowingHost(host) {
  try {
    const session = chrome.storage?.session;
    if (!session?.get) return false;
    const data = await session.get(SESSION_TOOL_UI_SNAPSHOT);
    const snap = data[SESSION_TOOL_UI_SNAPSHOT];
    if (!snap || typeof snap.at !== 'number') return false;
    if (Date.now() - snap.at > TOOL_UI_SNAPSHOT_MAX_AGE_MS) return false;
    const list = Array.isArray(snap.hosts) ? snap.hosts : [];
    return list.includes(host);
  } catch {
    return false;
  }
}

/**
 * True if some window is focused and its active tab is already on this host (user is “in” this site).
 * Avoids chimes when another background tab on the same host updates.
 * @param {string} host
 */
async function isUserViewingHostnameInFocusedWindow(host) {
  const activeTabs = await chrome.tabs.query({ active: true });
  for (const t of activeTabs) {
    if (UTILS.safeHostnameFromTabUrl(t.url) !== host) continue;
    try {
      const w = await chrome.windows.get(t.windowId);
      if (w.focused) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

/**
 * User is effectively “on” this host: browser focus on that tab, or extension tool open while that
 * host is active in a normal window (popup steals OS focus from the tab).
 * @param {string} host
 */
async function isUserEffectivelyViewingHost(host) {
  if (await isExtensionToolUiShowingHost(host)) return true;
  return isUserViewingHostnameInFocusedWindow(host);
}

async function countUnmonitoredFilters() {
  if (!Array.isArray(regexRules) || regexRules.length === 0) return 0;
  const tabs = await chrome.tabs.query({});
  let missing = 0;
  for (const rule of regexRules) {
    const hasMatch = tabs.some((tab) => tabMatchesSingleRegexRule(tab, rule));
    if (!hasMatch) missing += 1;
  }
  return missing;
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.title && !tab.url && !changeInfo.favIconUrl) return;

  const hadPriorTitle = Object.prototype.hasOwnProperty.call(lastTitles, tabId);
  const newTitle = changeInfo.title || tab.title;
  const newFavicon = changeInfo.favIconUrl || tab.favIconUrl;
  lastTitles[tabId] = newTitle;
  lastFavicons[tabId] = newFavicon;

  try {
    const tabInfo = await chrome.tabs.get(tabId);
    let tabWindow;
    try {
      tabWindow = await chrome.windows.get(tabInfo.windowId);
    } catch {
      return;
    }

    // Foreground matched tab: window focused, extension UI shows this host, or stable-host title-only
    // churn on the selected tab (Chrome often reports the window as unfocused while the user still
    // reads Gmail, which used to re-fire the OS digest on every title tick).
    // Still refresh badge/icon state because opening/loading this tab may satisfy a regex coverage gap.
    // Pass digestQuiet when there are already-unread hosts so that rapid title churn does not keep
    // recreating the OS "Unread by site" toast.
    //
    // When the extension popup/options has focus, Chrome often marks the browser window as
    // unfocused even though the user is still on a matched tab — treat an open tool + active tab on
    // this host the same as a focused window.
    const matchesForFocus = tabMatchesRegexRules(tabInfo, newTitle);
    const hostForFocus = matchesForFocus ? UTILS.safeHostnameFromTabUrl(tabInfo.url) : null;
    const toolMimicsBrowserFocus =
      Boolean(hostForFocus) &&
      tabInfo.active &&
      (await isExtensionToolUiShowingHost(hostForFocus));

    // Title-only updates on the *selected* tab of a matched site: Chrome often leaves
    // `windows.get(...).focused` false (extension UI, OS focus quirks) even though the user is
    // still reading that tab. Treat that like the focused-tab path so Gmail-style unread counters
    // in the tab title do not re-append `notifiedByHost` and re-fire the OS digest forever.
    const looksLikeTitleChurn =
      tabInfo.status === 'complete' &&
      hadPriorTitle &&
      Boolean(changeInfo.title) &&
      changeInfo.url === undefined &&
      changeInfo.favIconUrl === undefined &&
      Boolean(hostForFocus) &&
      lastMatchedHostByTab[tabId] === hostForFocus;

    if (
      tabInfo.active &&
      matchesForFocus &&
      (tabWindow.focused || toolMimicsBrowserFocus || looksLikeTitleChurn)
    ) {
      const currentUnread = await getNotifiedByHost();
      // Never re-sync the OS digest on focused-tab churn while unread exists — that caused
      // “Unread by site” to repeat (clear+create / live-title signature drift). Toolbar + popup
      // already show live titles.
      await updateBadge(currentUnread, {
        digestQuiet: Object.keys(currentUnread).length > 0,
      });
      if (hostForFocus) {
        lastMatchedHostByTab[tabId] = hostForFocus;
      }
      return;
    }

    if (!tabMatchesRegexRules(tabInfo, newTitle)) {
      delete lastMatchedHostByTab[tabId];
      return;
    }

    const host = UTILS.safeHostnameFromTabUrl(tabInfo.url);
    if (!host) return;

    const notifiedByHost = await getNotifiedByHost();
    /** `first` chime mode: beep only on transition from no unread sites → at least one (not once per host). */
    const wasGloballyClear = Object.keys(notifiedByHost).length === 0;
    const prevEntry = notifiedByHost[host];

    /**
     * Derive "already pending" from the persisted tabIds instead of an in-memory Set.
     * This survives service-worker restarts: if the tab ID is already in storage it means
     * it fired a full alert once and the user has not cleared it yet.
     */
    const alreadyPending = prevEntry?.tabIds?.includes(tabId) === true;

    const tabIds = new Set(prevEntry?.tabIds || []);
    tabIds.add(tabId);

    notifiedByHost[host] = {
      since: prevEntry ? prevEntry.since : Date.now(),
      tabIds: Array.from(tabIds),
      // Freeze the sample title at first-notification time so that rapid title churn does not
      // change the digest signature and cause the OS toast to reappear repeatedly.
      sampleTitle: prevEntry?.sampleTitle ?? newTitle,
    };

    const filterKeys = collectMatchingFilterKeys(tabInfo, newTitle);
    const sig = `${host}\0${newTitle}\0${newFavicon || ''}`;
    const now = Date.now();
    const suppressUserAlert = isDuplicateMultiTabNotification(filterKeys, sig, now);

    await chrome.storage.local.set({ [UTILS.STORE_NAMES.NOTIFIED_BY_HOST]: notifiedByHost });

    if (!suppressUserAlert) {
      recordFilterNotification(filterKeys, sig, now);
    }

    lastMatchedHostByTab[tabId] = host;

    const userViewingHost = suppressUserAlert ? false : await isUserEffectivelyViewingHost(host);
    const suppressAttention = suppressUserAlert || userViewingHost || alreadyPending;
    /**
     * Same tab still unread: refresh badge/title but skip digest OS toast to avoid
     * repeated toasts on every title churn while the user has not yet cleared the notification.
     */
    const digestQuiet = alreadyPending;

    if (!suppressAttention) {
      // New unread event — apply every enabled channel (badge, digest, chime) in one call.
      await updateBadge(notifiedByHost, {
        pulse: true,
        digestQuiet: false,
        chime: { wasGloballyClear },
      });
    } else {
      // Already-pending or suppressed: sync badge + toolbar title only; no chime replay.
      await updateBadge(notifiedByHost, { pulse: false, digestQuiet });
    }
  } catch (error) {
    console.warn(`Error processing tab update ${tabId}:`, error);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  delete lastTitles[tabId];
  delete lastFavicons[tabId];
  delete lastMatchedHostByTab[tabId];
  await handleTabClosed(tabId);
});

chrome.tabs.onCreated.addListener(async () => {
  // Opening a new tab can satisfy a filter with zero matching tabs.
  await updateBadge();
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await handleTabVisited(tabId);
});

function getDefaultActionTitle() {
  return chrome.runtime.getManifest().action?.default_title || 'All-in-One Message Notifier';
}

function setActionTitleDefault() {
  chrome.action.setTitle({ title: getDefaultActionTitle() });
}

/**
 * Native toolbar tooltip (hover) with unread sites and short tab titles.
 * @param {Record<string, { since: number, tabIds: number[] }>} notifiedByHost
 */
async function refreshUnreadActionTitle(notifiedByHost, unmonitoredFiltersCount = 0) {
  const hosts = Object.keys(notifiedByHost);
  if (hosts.length === 0) {
    if (unmonitoredFiltersCount > 0) {
      chrome.action.setTitle({
        title: `${getDefaultActionTitle()} · Warning: ${unmonitoredFiltersCount} filter(s) have no open matching tab.`,
      });
    } else {
      setActionTitleDefault();
    }
    return;
  }

  const tabById = await tabsByIdMap();
  const now = Date.now();
  const segments = [];

  for (const host of hosts.slice(0, 3)) {
    const entry = notifiedByHost[host];
    const tabsForHost = (entry.tabIds || [])
      .map((id) => tabById.get(id))
      .filter(Boolean);
    const t = tabsForHost[0];
    const wait = UTILS.getTimeAsHuman(now - entry.since);
    const raw = t?.title || '';
    const shortTitle = raw.length > 36 ? `${raw.slice(0, 36)}…` : raw;
    segments.push(`${host} — ${shortTitle || '·'} (${wait})`);
  }

  let title = `Unread · ${segments.join(' | ')}`;
  if (hosts.length > 3) title += ` · +${hosts.length - 3} more`;
  if (unmonitoredFiltersCount > 0) {
    title += ` · Warning: ${unmonitoredFiltersCount} filter(s) not monitored`;
  }
  if (title.length > 130) title = `${title.slice(0, 127)}…`;
  chrome.action.setTitle({ title });
}

/**
 * Throttles real notification chimes. Tests call {@link playExtensionChime} directly.
 */
async function maybePlayExtensionChime() {
  const now = Date.now();
  if (now - lastExtensionChimeAt < CHIME_GLOBAL_COOLDOWN_MS) return;
  try {
    await playExtensionChime();
    lastExtensionChimeAt = Date.now();
  } catch (e) {
    console.warn('Extension chime:', e);
  }
}

/**
 * @returns {Promise<void>}
 */
async function playExtensionChime() {
  if (!chrome.offscreen?.createDocument) {
    throw new Error('chrome.offscreen is not available (Chrome 109+ required).');
  }

  const prefs = await getWarningPrefs();
  const soundId = UTILS.CHIME_SOUND_IDS.includes(prefs.chimeSoundId) ? prefs.chimeSoundId : 'soft';
  const rel = UTILS.CHIME_SOUND_FILES[soundId] || UTILS.CHIME_SOUND_FILES.soft;
  const url = chrome.runtime.getURL(rel);
  const durationMs = Math.min(1500, Math.max(200, prefs.chimeDurationMs ?? 500));
  const volume = Math.min(1, Math.max(0.05, prefs.chimeVolume ?? 0.85));

  const pageUrl = chrome.runtime.getURL('offscreen-beep.html');
  if (typeof chrome.offscreen.hasDocument === 'function' && (await chrome.offscreen.hasDocument())) {
    await chrome.offscreen.closeDocument().catch(() => {});
    await new Promise((r) => setTimeout(r, 60));
  }

  await chrome.offscreen.createDocument({
    url: pageUrl,
    reasons: ['AUDIO_PLAYBACK'],
    justification: 'Short tone when a background tab matches your filters.',
  });

  await new Promise((r) => setTimeout(r, 280));

  let lastErr = /** @type {Error | null} */ (null);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Offscreen chime did not answer in time.'));
        }, 3200);
        chrome.runtime.sendMessage(
          { action: 'OFFSCREEN_BEEP', url, durationMs, volume },
          (res) => {
            clearTimeout(timeout);
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            if (res && res.ok === false) {
              reject(new Error(res.error || 'Offscreen beep reported failure.'));
              return;
            }
            resolve(undefined);
          }
        );
      });
      return;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      await new Promise((r) => setTimeout(r, 160));
    }
  }
  throw lastErr || new Error('Chime failed after retries.');
}

/**
 * @param {Record<string, { since: number, tabIds: number[] }>} notifiedByHost
 * @returns {Promise<chrome.notifications.NotificationCreateOptions | null>}
 */
async function buildDigestListOptions(notifiedByHost) {
  const hosts = Object.keys(notifiedByHost);
  if (hosts.length === 0) return null;

  const tabById = await tabsByIdMap();
  const items = [];
  for (const host of hosts) {
    const entry = notifiedByHost[host];
    const tabsForHost = (entry.tabIds || [])
      .map((id) => tabById.get(id))
      .filter(Boolean);
    const n = tabsForHost.length;
    const liveTitle = tabsForHost[0]?.title || '';
    // Always prefer frozen sample for the OS digest so the fingerprint stays stable on title churn.
    // Live titles remain in the toolbar tooltip and popup UI.
    const titleBit = entry.sampleTitle || liveTitle || 'Activity';
    const line = n > 1 ? `${host} (${n} tabs) — ${titleBit}` : `${host} — ${titleBit}`;
    items.push(line);
  }

  return {
    type: 'list',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: 'Unread by site',
    message: 'Sites with new activity:',
    items: items.slice(0, 5).map((m) => ({ title: m, message: '' })),
    priority: 2,
  };
}

/**
 * @param {string} [errorMessage]
 * @param {string} [permission] from chrome.notifications.getPermissionLevel
 * @returns {string[]}
 */
function fixHintsForNotificationFailure(errorMessage, permission) {
  const hints = [];
  const err = (errorMessage || '').toLowerCase();

  if (permission && permission !== 'granted') {
    hints.push(
      'Chrome: Settings → Privacy and security → Site settings → Notifications — allow sites to send notifications (or open chrome://settings/content/notifications).'
    );
    hints.push(
      'Windows: Settings → System → Notifications → find “Google Chrome” and turn notifications on.'
    );
  }
  if (err.includes('permission') || err.includes('denied') || err.includes('not allowed')) {
    hints.push(
      'If Chrome never asked, reset notification permission for extensions in Chrome’s site settings.'
    );
  }
  if (err.includes('invalid') || err.includes('malformed')) {
    hints.push('Update Chrome to the latest version; invalid options sometimes come from version mismatches.');
  }

  hints.push(
    'Click the clock/date in the taskbar to open Notification center — banners may only show there.'
  );
  hints.push('Turn off Focus Assist, quiet hours, and Do not disturb (Windows / third-party tools).');
  hints.push(
    'On a managed PC, IT policy can block or hide toasts even when the extension reports success.'
  );

  return [...new Set(hints)];
}

async function actionSetForTest() {
  const title =
    'Unread · web.example.com — Sample tab (1m) | mail.example.com — Inbox (3m) — test';
  const errs = [];
  for (const [label, call] of /** @type {const} */ ([
    ['badge text', (cb) => chrome.action.setBadgeText({ text: '1m' }, cb)],
    ['badge color', (cb) => chrome.action.setBadgeBackgroundColor({ color: '#d93025' }, cb)],
    ['title', (cb) => chrome.action.setTitle({ title }, cb)],
  ])) {
    const msg = await chromeLastError(call);
    if (msg) errs.push(`${label}: ${msg}`);
  }
  return { ok: errs.length === 0, error: errs.length ? errs.join('; ') : undefined };
}

/**
 * @param {string} id
 * @param {chrome.notifications.NotificationCreateOptions} options
 * @param {boolean} tryRelaxedOnFail retry without requireInteraction if create fails
 * @returns {Promise<{ ok: boolean, error?: string, retriedWithoutPersistent?: boolean }>}
 */
async function notificationsCreateTracked(id, options, tryRelaxedOnFail) {
  await new Promise((r) => chrome.notifications.clear(id, r));

  const tryOnce = (opts, useFixedId) =>
    new Promise((resolve) => {
      const cb = () => {
        const err = chrome.runtime.lastError;
        resolve(err ? { ok: false, error: err.message } : { ok: true });
      };
      if (useFixedId) chrome.notifications.create(id, opts, cb);
      else chrome.notifications.create(opts, cb);
    });

  let res = await tryOnce(options, true);
  if (res.ok) return res;

  res = await tryOnce(options, false);
  if (res.ok) return res;

  if (tryRelaxedOnFail && options.requireInteraction) {
    const relaxed = { ...options, requireInteraction: false, priority: 1 };
    res = await tryOnce(relaxed, true);
    if (res.ok) return { ok: true, retriedWithoutPersistent: true };
    res = await tryOnce(relaxed, false);
    if (res.ok) return { ok: true, retriedWithoutPersistent: true };
  }

  return res;
}

/**
 * Stable string for digest list content + persistence flag (used to skip redundant creates).
 * @param {chrome.notifications.NotificationCreateOptions} listBase
 * @param {boolean} persistent
 */
function digestNotificationSignature(listBase, persistent) {
  const parts = (listBase.items || []).map((i) => `${i.title}\u001f${i.message || ''}`);
  return `${persistent ? 1 : 0}:${parts.join('|')}`;
}

/**
 * One deduplicated list notification; OS toast is silent (optional extension chime).
 * @param {Record<string, { since: number, tabIds: number[] }>} notifiedByHost
 * @param {string} mode
 * @param {{ desktopPersistent: boolean }} prefs
 */
async function syncUnreadDigestNotificationFromState(notifiedByHost, mode, prefs) {
  const hosts = Object.keys(notifiedByHost);
  if (hosts.length === 0 || !UTILS.notificationModeIncludesDigest(mode)) {
    lastDigestNotificationSignature = '';
    await clearDigestNotification();
    return;
  }
  const listBase = await buildDigestListOptions(notifiedByHost);
  if (!listBase) {
    lastDigestNotificationSignature = '';
    await clearDigestNotification();
    return;
  }
  const persistent = prefs.desktopPersistent !== false;
  const sig = digestNotificationSignature(listBase, persistent);
  if (sig === lastDigestNotificationSignature) {
    return;
  }
  const options = {
    ...listBase,
    silent: true,
    ...(persistent ? { requireInteraction: true } : {}),
  };

  // Prefer update in-place so Windows/Chrome do not treat every refresh as a new toast.
  if (typeof chrome.notifications?.update === 'function') {
    const updated = await new Promise((resolve) => {
      try {
        chrome.notifications.update(DIGEST_NOTIFICATION_ID, options, (wasUpdated) => {
          resolve(wasUpdated === true && !chrome.runtime.lastError);
        });
      } catch {
        resolve(false);
      }
    });
    if (updated) {
      lastDigestNotificationSignature = sig;
      return;
    }
  }

  const r = await notificationsCreateTracked(DIGEST_NOTIFICATION_ID, options, true);
  if (r.ok) {
    lastDigestNotificationSignature = sig;
  } else {
    console.warn('Digest notification:', r.error);
  }
}

async function showDesktopSummaryNotification() {
  lastDigestNotificationSignature = '';
  const notifiedByHost = await getNotifiedByHost();
  const mode = await getNotificationMode();
  const prefs = await getWarningPrefs();
  await syncUnreadDigestNotificationFromState(notifiedByHost, mode, prefs);
}

/**
 * @typedef {{ id: string, label: string, attempted: boolean, ok: boolean, error?: string, note?: string, fixHints?: string[] }} ChannelTestResult
 */

/**
 * @param {string} id
 * @param {string} label
 * @param {{ ok: boolean, error?: string, retriedWithoutPersistent?: boolean }} r
 * @param {string} permission
 * @returns {ChannelTestResult}
 */
function desktopChannelTestResult(id, label, r, permission) {
  /** @type {ChannelTestResult} */
  const row = {
    id,
    label,
    attempted: true,
    ok: r.ok,
  };
  if (!r.ok) {
    row.error = [
      r.error || 'notifications.create failed',
      permission && permission !== 'granted' ? `(Chrome permission: "${permission}")` : '',
    ]
      .filter(Boolean)
      .join(' ');
    row.fixHints = fixHintsForNotificationFailure(r.error, permission);
    return row;
  }
  const notes = [];
  if (r.retriedWithoutPersistent) {
    notes.push(
      'Shown without “stay on screen” (persistent failed; a normal toast was used).'
    );
  }
  if (permission && permission !== 'granted') {
    notes.push(
      `Chrome still reports permission "${permission}". If you see no banner, allow notifications in Chrome and Windows and check Focus Assist.`
    );
  }
  if (notes.length) row.note = notes.join(' ');
  return row;
}

/** @typedef {'badge' | 'desktop_list' | 'chime'} TestChannelId */

/**
 * @param {TestChannelId[]} channels
 * @returns {Promise<{ ok: boolean, nothing?: boolean, hint?: string, channelResults?: ChannelTestResult[], permission?: string }>}
 */
async function runTestNotificationChannels(channels) {
  const uniq = [...new Set(channels)];
  if (uniq.length === 0) {
    return {
      ok: true,
      nothing: true,
      hint: 'No preview channel specified.',
    };
  }

  const prefs = await getWarningPrefs();
  const permission = await getNotificationsPermission();

  /** @type {ChannelTestResult[]} */
  const channelResults = [];
  const iconUrl = chrome.runtime.getURL('icons/icon128.png');

  for (const id of uniq) {
    if (id === 'badge') {
      const br = await actionSetForTest();
      channelResults.push({
        id: 'badge',
        label: 'Toolbar badge & hover title',
        attempted: true,
        ok: br.ok,
        ...(br.error ? { error: br.error } : {}),
        ...(!br.ok
          ? {
              fixHints: [
                'Pin the extension so the toolbar icon is visible.',
                'If the icon is hidden, open the extensions puzzle menu and pin this extension.',
              ],
            }
          : {}),
      });
    } else if (id === 'desktop_list') {
      const listOpts = {
        type: 'list',
        iconUrl,
        title: 'Unread by site (test)',
        message: 'Sample digest (same shape as the live summary):',
        items: [
          { title: 'web.example.com — Sample chat (test)', message: '' },
          { title: 'mail.example.com (2 tabs) — Inbox (test)', message: '' },
        ],
        priority: 2,
        silent: true,
        ...(prefs.desktopPersistent ? { requireInteraction: true } : {}),
      };
      const rList = await notificationsCreateTracked(TEST_NOTIFY_LIST_ID, listOpts, true);
      channelResults.push(
        desktopChannelTestResult(
          'desktop_list',
          'Desktop digest (all unread, one notification)',
          rList,
          permission
        )
      );
    } else if (id === 'chime') {
      try {
        await playExtensionChime();
        channelResults.push({
          id: 'chime',
          label: 'Extension chime',
          attempted: true,
          ok: true,
          note:
            'A brief tone should have played (not the silent digest). Unmute Windows/Chrome if you heard nothing.',
        });
      } catch (e) {
        channelResults.push({
          id: 'chime',
          label: 'Extension chime',
          attempted: true,
          ok: false,
          error: String(e?.message || e),
          fixHints: [
            'Update Chrome (109+). Turn on “Extension chime” in Advanced.',
            'Raise system volume; check that Chrome is not muted in the Windows volume mixer.',
            'Run the test again from this popup—sometimes the first play needs a fresh offscreen page.',
          ],
        });
      }
    }
  }

  setTimeout(() => {
    updateBadge();
  }, 8000);

  return {
    ok: true,
    channelResults,
    permission,
  };
}

/**
 * Demo badge (when type includes badge) and digest list (when type includes popup).
 * @returns {Promise<{ ok: boolean, nothing?: boolean, hint?: string, channelResults?: ChannelTestResult[], permission?: string }>}
 */
async function runTestAllEnabledAlerts() {
  const prefs = await getWarningPrefs();
  const mode = await getNotificationMode();
  const channels = channelsEnabledForCurrentSettings(mode, prefs);

  if (channels.length === 0) {
    return {
      ok: true,
      nothing: true,
      hint: 'Turn on the toolbar badge, desktop digest, or extension chime to run a test.',
    };
  }

  return runTestNotificationChannels(channels);
}

function notificationIdForHost(host) {
  return `inboxradar-host-${host.replace(/[^a-z0-9_-]/gi, '_')}`;
}

/** Clear legacy per-host notification IDs from older versions (digest uses a single id). */
function clearLegacyPerHostNotifications(notifiedByHost) {
  for (const host of Object.keys(notifiedByHost)) {
    chrome.notifications.clear(notificationIdForHost(host), () => {});
  }
}

async function setDefaultColorSchema() {
  const stored = await chrome.storage.local.get(UTILS.STORE_NAMES.BADGE_COLOR_SCHEME);

  if (stored[UTILS.STORE_NAMES.BADGE_COLOR_SCHEME] === undefined) {
    await chrome.storage.local.set({ [UTILS.STORE_NAMES.BADGE_COLOR_SCHEME]: DEFAULT_BADGE_COLORS });
  }
}

async function initRegexFilters() {
  const loadExistingRules = await chrome.storage.local.get(UTILS.STORE_NAMES.REGEX_FILTERS);
  let regexFilters = loadExistingRules[UTILS.STORE_NAMES.REGEX_FILTERS] || [];

  DEFAULT_SUGGESTIONS.forEach((s) => {
    const exists = regexFilters.some((r) => r.pattern === s.pattern && r.type === s.type);
    if (!exists) regexFilters.push(s);
  });

  await chrome.storage.local.set({ [UTILS.STORE_NAMES.REGEX_FILTERS]: regexFilters });
  return await getRegexRules();
}

async function setUpdateTimeInterval() {
  clearInterval(timeoutId);
  updateBadge();
  timeoutId = setInterval(async () => {
    updateBadge();
  }, 60000);
}

async function getRegexRules() {
  const stored = await chrome.storage.local.get(UTILS.STORE_NAMES.REGEX_FILTERS);
  return (stored[UTILS.STORE_NAMES.REGEX_FILTERS] || []).map((r) => ({
    pattern: new RegExp(r.pattern, 'i'),
    type: r.type,
  }));
}

/** @returns {Promise<Record<string, { since: number, tabIds: number[] }>>} */
async function getNotifiedByHost() {
  const stored = await chrome.storage.local.get(UTILS.STORE_NAMES.NOTIFIED_BY_HOST);
  return stored[UTILS.STORE_NAMES.NOTIFIED_BY_HOST] || {};
}

async function migrateLegacyNotifiedTabsIfNeeded() {
  const data = await chrome.storage.local.get([
    UTILS.STORE_NAMES.NOTIFIED_BY_HOST,
    UTILS.STORE_NAMES.NOTIFIED_TABS,
  ]);
  const legacy = data[UTILS.STORE_NAMES.NOTIFIED_TABS];
  if (!legacy || typeof legacy !== 'object' || Object.keys(legacy).length === 0) return;

  const existing = data[UTILS.STORE_NAMES.NOTIFIED_BY_HOST];
  if (existing && typeof existing === 'object' && Object.keys(existing).length > 0) {
    await chrome.storage.local.set({ [UTILS.STORE_NAMES.NOTIFIED_TABS]: {} });
    return;
  }

  const tabById = await tabsByIdMap();
  /** @type {Record<string, { since: number, tabIds: number[] }>} */
  const notifiedByHost = {};

  for (const [tabIdStr, since] of Object.entries(legacy)) {
    const tabId = parseInt(tabIdStr, 10);
    const tab = tabById.get(tabId);
    const host = UTILS.safeHostnameFromTabUrl(tab?.url);
    if (!host) continue;
    if (!notifiedByHost[host]) {
      notifiedByHost[host] = { since: typeof since === 'number' ? since : Date.now(), tabIds: [] };
    }
    if (!notifiedByHost[host].tabIds.includes(tabId)) {
      notifiedByHost[host].tabIds.push(tabId);
    }
    notifiedByHost[host].since = Math.min(
      notifiedByHost[host].since,
      typeof since === 'number' ? since : Date.now()
    );
  }

  await chrome.storage.local.set({
    [UTILS.STORE_NAMES.NOTIFIED_BY_HOST]: notifiedByHost,
    [UTILS.STORE_NAMES.NOTIFIED_TABS]: {},
  });
}

/**
 * User focused a tab: mark that hostname as read (all tabs on that host).
 * @param {number} tabId
 */
async function handleTabVisited(tabId) {
  let host = null;
  try {
    const tab = await chrome.tabs.get(tabId);
    host = UTILS.safeHostnameFromTabUrl(tab.url);
  } catch {
    // ignore
  }
  if (!host) return;

  const notifiedByHost = await getNotifiedByHost();
  if (!notifiedByHost[host]) {
    // Even without unread items on this host, activation can change
    // "filters with no open tabs" state, so refresh toolbar icon/badge.
    await updateBadge(notifiedByHost);
    return;
  }

  delete notifiedByHost[host];
  const tabById = await tabsByIdMap();
  for (const t of tabById.values()) {
    if (UTILS.safeHostnameFromTabUrl(t.url) === host) {
      delete lastTitles[t.id];
      delete lastFavicons[t.id];
      delete lastMatchedHostByTab[t.id];
    }
  }

  await chrome.storage.local.set({ [UTILS.STORE_NAMES.NOTIFIED_BY_HOST]: notifiedByHost });
  await updateBadge(notifiedByHost);
}

/**
 * Tab closed: remove that tab from host entries; drop empty hosts.
 * @param {number} tabId
 */
async function handleTabClosed(tabId) {
  const notifiedByHost = await getNotifiedByHost();
  let changed = false;

  for (const [host, entry] of Object.entries(notifiedByHost)) {
    const ids = (entry.tabIds || []).filter((id) => id !== tabId);
    if (ids.length !== (entry.tabIds || []).length) {
      changed = true;
      if (ids.length === 0) {
        delete notifiedByHost[host];
      } else {
        notifiedByHost[host] = { ...entry, tabIds: ids };
      }
    }
  }

  if (changed) {
    await chrome.storage.local.set({ [UTILS.STORE_NAMES.NOTIFIED_BY_HOST]: notifiedByHost });
  }
  // Closing a tab can also create a "no matching tab" filter state,
  // even when unread host map did not change.
  await updateBadge(notifiedByHost);
}

/**
 * The single entry-point for applying ALL enabled notification channels.
 *
 * Every path that needs to reflect new unread state — or fire alerts on new activity — must
 * go through here.  Settings are read once in parallel so every channel sees the same snapshot.
 *
 * @param {Record<string, { since: number, tabIds: number[] }>} [notifiedByHost]
 * @param {object} [options]
 * @param {boolean} [options.pulse]
 *   Animate the badge color for newly-arrived unread activity (default false).
 * @param {boolean} [options.digestQuiet]
 *   Skip creating / updating the desktop digest OS toast for this call.
 *   Set when the same tab is already pending-clear to avoid repeated toasts on title churn.
 * @param {{ wasGloballyClear: boolean } | false} [options.chime]
 *   Pass `{ wasGloballyClear }` to allow the chime for a new unread event.
 *   Omit or pass `false` for state-sync calls (periodic refresh, clear, prefs change, etc.)
 *   that must never play a sound.
 */
async function updateBadge(notifiedByHost, options = {}) {
  clearBadgePulse();
  notifiedByHost = notifiedByHost ?? (await getNotifiedByHost());

  // Read all settings in parallel — every channel uses the same snapshot.
  const [prefs, mode, unmonitoredFiltersCount] = await Promise.all([
    getWarningPrefs(),
    getNotificationMode(),
    countUnmonitoredFilters(),
  ]);

  const hasUnmonitoredFilters = unmonitoredFiltersCount > 0;
  syncActionWarningIcon(hasUnmonitoredFilters);

  const badgeAllowed = UTILS.notificationModeIncludesBadge(mode);
  const wantPulse = options.pulse === true;
  const digestQuiet = options.digestQuiet === true;
  const chimeCtx = options.chime || false;
  const warningBadgeColor = '#C2410C';
  const hosts = Object.keys(notifiedByHost);

  // ── Badge ──────────────────────────────────────────────────────────────────
  if (hosts.length === 0) {
    if (!badgeAllowed || !hasUnmonitoredFilters) {
      chrome.action.setBadgeText({ text: '' });
    } else {
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: warningBadgeColor });
    }
  } else if (!badgeAllowed) {
    chrome.action.setBadgeText({ text: '' });
  } else {
    const now = Date.now();
    const oldest = Math.max(...hosts.map((h) => now - notifiedByHost[h].since));
    const timeAsHuman = UTILS.getTimeAsHuman(oldest);
    const messageMinutes = UTILS.getTimeInMinutes(oldest);

    const stored = await chrome.storage.local.get(UTILS.STORE_NAMES.BADGE_COLOR_SCHEME);
    const scheme = stored[UTILS.STORE_NAMES.BADGE_COLOR_SCHEME] || DEFAULT_BADGE_COLORS;
    const selectedColor =
      [...scheme].reverse().find((s) => s.threshold <= messageMinutes)?.color || 'red';

    const badgeText = hasUnmonitoredFilters
      ? timeAsHuman.length <= 3 ? `${timeAsHuman}!` : '!'
      : timeAsHuman;
    chrome.action.setBadgeText({ text: badgeText });
    chrome.action.setBadgeBackgroundColor({ color: selectedColor });
    if (wantPulse) {
      maybePulseBadgeForAttention(selectedColor);
    }
  }

  // ── Toolbar title ──────────────────────────────────────────────────────────
  await refreshUnreadActionTitle(notifiedByHost, unmonitoredFiltersCount);

  // ── Desktop digest ─────────────────────────────────────────────────────────
  if (!digestQuiet) {
    await syncUnreadDigestNotificationFromState(notifiedByHost, mode, prefs);
  }

  // ── Chime ──────────────────────────────────────────────────────────────────
  // Only fires when the caller explicitly opts in via options.chime (new unread events only).
  // State-sync calls (prefs change, periodic refresh, tab close, clear) never pass options.chime.
  if (chimeCtx && prefs.desktopSound) {
    const chimeEvery = prefs.chimeNotifyMode !== 'first';
    if (chimeEvery || chimeCtx.wasGloballyClear) {
      await maybePlayExtensionChime();
    }
  }
}

async function getNotificationMode() {
  const stored = await chrome.storage.local.get(UTILS.STORE_NAMES.NOTIFICATION_MODE);
  const m = stored[UTILS.STORE_NAMES.NOTIFICATION_MODE];
  if (m === 'badge' || m === 'popup' || m === 'both' || m === 'none') return m;
  return 'badge';
}

async function getWarningPrefs() {
  const stored = await chrome.storage.local.get(UTILS.STORE_NAMES.WARNING_PREFS);
  const raw = stored[UTILS.STORE_NAMES.WARNING_PREFS] || {};
  const soundId = UTILS.CHIME_SOUND_IDS.includes(raw.chimeSoundId) ? raw.chimeSoundId : 'soft';
  const dur = parseInt(raw.chimeDurationMs, 10);
  const chimeDurationMs =
    Number.isFinite(dur) && dur >= 200 && dur <= 1500 ? dur : 500;
  const vol = parseFloat(raw.chimeVolume);
  const chimeVolume =
    Number.isFinite(vol) && vol >= 0.05 && vol <= 1 ? vol : 0.85;
  const modeRaw = raw.chimeNotifyMode;
  const chimeNotifyMode =
    modeRaw === 'first' || modeRaw === 'every' ? modeRaw : 'every';
  return {
    badge: true,
    desktopPopup: false,
    desktopPersistent: raw.desktopPersistent !== false,
    desktopSound: raw.desktopSound !== false,
    chimeNotifyMode,
    toolbarSummary: true,
    chimeSoundId: soundId,
    chimeDurationMs,
    chimeVolume,
  };
}

async function ensureWarningPrefsDefault() {
  const stored = await chrome.storage.local.get(UTILS.STORE_NAMES.WARNING_PREFS);
  if (stored[UTILS.STORE_NAMES.WARNING_PREFS] !== undefined) return;
  await chrome.storage.local.set({ [UTILS.STORE_NAMES.WARNING_PREFS]: { ...UTILS.DEFAULT_WARNING_PREFS } });
}

async function bootExtension() {
  await setDefaultColorSchema();
  await ensureWarningPrefsDefault();
  await migrateLegacyNotifiedTabsIfNeeded();
  const nb = await getNotifiedByHost();
  clearLegacyPerHostNotifications(nb);
  regexRules = await initRegexFilters();
  await setUpdateTimeInterval();
}

async function validateNotifiedHosts() {
  const notifiedByHost = await getNotifiedByHost();
  const openTabs = await chrome.tabs.query({});
  const openTabIds = new Set(openTabs.map((tab) => tab.id));

  let hasChanges = false;
  const cleaned = { ...notifiedByHost };

  for (const host of Object.keys(cleaned)) {
    const entry = cleaned[host];
    const ids = (entry.tabIds || []).filter((id) => openTabIds.has(id));
    if (ids.length !== (entry.tabIds || []).length) {
      hasChanges = true;
    }
    if (ids.length === 0) {
      delete cleaned[host];
      hasChanges = true;
    } else {
      cleaned[host] = { ...entry, tabIds: ids };
    }
  }

  if (hasChanges) {
    await chrome.storage.local.set({ [UTILS.STORE_NAMES.NOTIFIED_BY_HOST]: cleaned });
    await updateBadge(cleaned);
  }
}

setInterval(() => {
  validateNotifiedHosts();
}, 5 * 60 * 1000);

validateNotifiedHosts();
bootExtension();
