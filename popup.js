import { DEFAULT_SUGGESTIONS } from './suggestions.js';
import * as UTILS from './utils.js';

/** WhatsApp web favicon URLs often fail in extension pages (referrer / fetch); use embedded SVG. */
const WHATSAPP_FAVICON_DATA_URL =
  'data:image/svg+xml;base64,' +
  btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#25D366" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.117 1.036 6.981 2.91a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.881 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>'
  );

/**
 * @param {chrome.tabs.Tab | undefined | null} tab
 * @returns {string}
 */
function faviconSrcForTab(tab) {
  if (!tab?.url) return tab?.favIconUrl || '';
  const host = UTILS.safeHostnameFromTabUrl(tab.url);
  if (host === 'web.whatsapp.com') {
    return WHATSAPP_FAVICON_DATA_URL;
  }
  return tab.favIconUrl || '';
}

/**
 * @param {chrome.tabs.Tab | undefined | null} tab
 * @returns {string}
 */
function faviconImgHtml(tab) {
  const src = faviconSrcForTab(tab);
  if (!src) return '';
  return `<img src="${src}" alt="" width="16" height="16" style="width:16px;height:16px;vertical-align:middle;margin-right:5px;border-radius:50%;">`;
}

/**
 * @param {{ permission?: string, channelResults?: { id: string, label: string, ok: boolean, error?: string, note?: string, fixHints?: string[] }[] }} res
 * @param {{ headline?: string }} [opts]
 */
function formatNotificationTestResult(res, opts = {}) {
  const lines = [];
  if (opts.headline) {
    lines.push(opts.headline);
    lines.push('');
  } else {
    lines.push(
      'Shown after you click “Test all enabled notifications”, or after a quick chime preview when you turn chime on.',
      'Same channels as the toggles above (badge, digest, chime). Real unread updates still come from your tabs.',
      '',
      'Results',
      ''
    );
  }
  if (res.permission) {
    lines.push(`Chrome notification permission: ${res.permission}`);
    lines.push('');
  }
  for (const ch of res.channelResults || []) {
    const status = ch.ok ? 'OK' : 'FAILED';
    lines.push(`• ${ch.label}: ${status}`);
    if (ch.error) lines.push(`  Reason: ${ch.error}`);
    if (ch.note) lines.push(`  Note: ${ch.note}`);
    if (ch.fixHints?.length) {
      lines.push('  Try:');
      for (const h of ch.fixHints) {
        lines.push(`  – ${h}`);
      }
    }
  }
  const desktopTried = (res.channelResults || []).some((c) => c.id === 'desktop_list');
  if (desktopTried) {
    lines.push('');
    lines.push(
      'Digest toast is silent. If it shows OK but no banner: notification center (clock), Focus Assist off, Chrome allowed in Windows notifications.'
    );
  }
  const chimeTried = (res.channelResults || []).some((c) => c.id === 'chime');
  if (chimeTried) {
    lines.push('');
    lines.push(
      'Chime: turn on “Extension chime” in Advanced to include this row. The digest toast stays silent.'
    );
  }
  return lines.join('\n');
}

// === popup.js ===

function clickFiltersTab() {
  document.getElementById('show-filters')?.click();
}

function applyPopupThemeFromStorageValue(themeVal) {
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
  const dark = themeVal === 'dark' || (themeVal !== 'light' && prefersDark);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const chk = document.getElementById('popup-theme-dark');
  if (chk) chk.checked = dark;
}

/**
 * Suggest a URL to open from a URL-type regex (or fallback for title rules).
 * @param {string} pattern
 * @param {string} type
 */
function guessOpenUrlFromFilter(pattern, type) {
  const raw = (pattern || '').trim();
  if (!raw) return 'https://';
  if (/^https?:\/\//i.test(raw)) {
    try {
      return new URL(raw).href;
    } catch {
      return raw;
    }
  }
  if (type === 'title') {
    return 'https://www.google.com/';
  }
  const loosened = raw.replace(/^\^/, '').replace(/\$$/, '');
  const beforeSlash = loosened.split(/[/\\?#[\]|]/)[0];
  const hostish = beforeSlash.replace(/\([^)]*\)/g, '').replace(/\\./g, '.');
  if (hostish.includes('.') && !/\s/.test(hostish)) {
    let h = hostish.replace(/^\.\*?/, '').replace(/\.\*$/, '').replace(/^https?:\/\//i, '');
    h = h.replace(/[^a-zA-Z0-9.-]/g, '');
    if (h) return `https://${h}/`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(raw)}`;
}

/**
 * @param {Record<string, HTMLElement | null>} dom
 */
function closeAllRegexOpenPanels(dom) {
  if (!dom.regexList) return;
  dom.regexList.querySelectorAll('.regex-open-panel').forEach((p) => {
    p.classList.remove('is-open');
  });
}

/**
 * @param {Record<string, HTMLElement | null>} dom
 * @param {chrome.tabs.Tab[]} openTabs
 */
function refreshFilterTabStatus(dom, openTabs) {
  if (!dom.regexList) return;
  const bits = [];
  for (const row of dom.regexList.querySelectorAll('.regex-row')) {
    const inp = row.querySelector('input[type="text"]');
    const sel = row.querySelector('select');
    const badge = row.querySelector('.regex-row-match-count');
    const helpOpen = row.querySelector('.regex-help-open');
    if (!inp || !sel || !badge) continue;
    const pattern = inp.value.trim();
    if (!pattern) {
      badge.textContent = '';
      badge.classList.remove('regex-row-match-count--zero');
      helpOpen?.classList.remove('regex-help-open--zero');
      continue;
    }
    const valid = UTILS.isRegexPatternSyntaxValid(pattern);
    if (!valid) {
      badge.textContent = 'invalid';
      badge.classList.remove('regex-row-match-count--zero');
      helpOpen?.classList.remove('regex-help-open--zero');
      bits.push(`"${pattern.slice(0, 14)}…" (invalid)`);
      continue;
    }
    const rule = { pattern, type: sel.value };
    const n = openTabs.filter((t) => UTILS.tabMatchesStringFilterRule(t, rule)).length;
    badge.textContent = n === 0 ? '0 tabs' : `${n} tab${n === 1 ? '' : 's'}`;
    badge.classList.toggle('regex-row-match-count--zero', n === 0);
    helpOpen?.classList.toggle('regex-help-open--zero', n === 0);
    const short = pattern.length > 18 ? `${pattern.slice(0, 18)}…` : pattern;
    bits.push(`${short} (${rule.type}): ${n}`);
  }
  if (dom.filterMatchStatusEl) {
    dom.filterMatchStatusEl.textContent = bits.length ? `Open tabs — ${bits.join(' · ')}` : '';
  }
  updateFilterPartialNoticeBar(dom, openTabs);
}

/**
 * Notifications tab hint: some saved rules have no open tab while others still match.
 * @param {Record<string, HTMLElement | null>} dom
 * @param {chrome.tabs.Tab[]} openTabs
 */
function updateFilterPartialNoticeBar(dom, openTabs) {
  if (!dom.regexList || !dom.filterPartialNoticeEl) return;
  const rules = [];
  for (const row of dom.regexList.querySelectorAll('.regex-row')) {
    const inp = row.querySelector('input[type="text"]');
    const sel = row.querySelector('select');
    if (!inp || !sel) continue;
    const pattern = inp.value.trim();
    if (!pattern) continue;
    if (!UTILS.isRegexPatternSyntaxValid(pattern)) continue;
    rules.push({ pattern, type: sel.value });
  }
  const titleEl = dom.filterPartialNoticeEl.querySelector('.filter-partial-notice__title');
  const bodyEl = dom.filterPartialNoticeEl.querySelector('.filter-partial-notice__body');

  if (!rules.length) {
    dom.filterPartialNoticeEl.classList.remove('filter-partial-notice--visible');
    if (titleEl) titleEl.textContent = '';
    if (bodyEl) bodyEl.textContent = '';
    return;
  }
  const anyMatch = openTabs.some((t) => UTILS.tabMatchesAnyStringFilterRules(t, rules));
  const someZero = rules.some(
    (rule) => openTabs.filter((t) => !UTILS.tabMatchesStringFilterRule(t, rule)).length === openTabs.length
  );
  if (anyMatch && someZero) {
    if (titleEl) {
      titleEl.textContent = 'Some filters have no open matching tabs.';
    }
    if (bodyEl) {
      bodyEl.textContent = 'Open a tab to enable notifications (use ↗ in Filters).';
    }
    dom.filterPartialNoticeEl.classList.add('filter-partial-notice--visible');
  } else {
    dom.filterPartialNoticeEl.classList.remove('filter-partial-notice--visible');
    if (titleEl) titleEl.textContent = '';
    if (bodyEl) bodyEl.textContent = '';
  }
}

/**
 * @param {Record<string, HTMLElement | null>} dom
 * @param {{ filterStatusRefreshTimer: ReturnType<typeof setTimeout> | null }} ui
 */
function scheduleRefreshFilterTabStatus(dom, ui) {
  clearTimeout(ui.filterStatusRefreshTimer);
  ui.filterStatusRefreshTimer = setTimeout(async () => {
    ui.filterStatusRefreshTimer = null;
    refreshFilterTabStatus(dom, await chrome.tabs.query({}));
  }, 280);
}

/**
 * @param {Record<string, HTMLElement | null>} dom
 */
function getNotificationModeFromDom(dom) {
  return UTILS.deriveNotificationModeFromBooleans(!!dom.optBadgeEl?.checked, !!dom.optPopupEl?.checked);
}

/**
 * @param {Record<string, HTMLElement | null>} dom
 */
function syncSummaryNotificationButton(dom) {
  if (!dom.summaryNotifyButton || !dom.notificationList) return;
  const hasUnread = dom.notificationList.children.length > 0;
  const mode = getNotificationModeFromDom(dom);
  dom.summaryNotifyButton.style.display =
    hasUnread && UTILS.notificationModeIncludesDigest(mode) ? 'inline-block' : 'none';
}

/**
 * @param {HTMLInputElement | null} input
 */
function toggleCheckboxAndEmitChange(input) {
  if (!input) return;
  input.checked = !input.checked;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function highlightRegexMatches(text, regexPattern) {
  try {
    const regex = new RegExp(regexPattern, 'gi');
    return text.replace(regex, (match) => `<u><span class="match-highlight">${match}</span></u>`);
  } catch (e) {
    console.warn('Invalid regex:', regexPattern);
    return text;
  }
}

/**
 * @param {{ pattern: string, type: string }} rule
 * @param {number} _index
 */
function ruleGroupCaption(rule, _index) {
  const typeTag = rule.type === 'title' ? 'Title' : 'URL';
  const pat = rule.pattern.length > 44 ? `${rule.pattern.slice(0, 42)}…` : rule.pattern;
  return `${typeTag} · ${pat}`;
}

/** Tell the background which http(s) hosts are active in normal windows while this UI is open. */
async function sendToolUiHostHeartbeat() {
  try {
    const wins = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
    const hosts = new Set();
    for (const w of wins) {
      const active = w.tabs?.find((t) => t.active);
      if (!active?.url) continue;
      const h = UTILS.safeHostnameFromTabUrl(active.url);
      if (h) hosts.add(h);
    }
    await chrome.runtime.sendMessage({
      action: UTILS.MESSAGE_NAMES.TOOL_UI_HOST_HEARTBEAT,
      hosts: [...hosts],
    });
  } catch {
    /* ignore — e.g. extension context invalidating while closing */
  }
}

/**
 * @param {{ pulseCoalesceTimer: ReturnType<typeof setTimeout> | null, pulseAnimClearTimer: ReturnType<typeof setTimeout> | null }} ui
 * @param {HTMLElement | null} runBtn
 * @param {HTMLElement | null} testTipDiv
 */
function runNotificationTestPulseAnimation(ui, runBtn, testTipDiv) {
  if (!runBtn || !testTipDiv || testTipDiv.style.display === 'none') {
    return;
  }
  runBtn.classList.remove('pulse-hint');
  void runBtn.offsetWidth;
  runBtn.classList.add('pulse-hint');
  if (ui.pulseAnimClearTimer) clearTimeout(ui.pulseAnimClearTimer);
  ui.pulseAnimClearTimer = setTimeout(() => {
    runBtn.classList.remove('pulse-hint');
    ui.pulseAnimClearTimer = null;
  }, 3200);
}

/**
 * @param {{ pulseCoalesceTimer: ReturnType<typeof setTimeout> | null, pulseAnimClearTimer: ReturnType<typeof setTimeout> | null }} ui
 * @param {HTMLElement | null} runBtn
 * @param {HTMLElement | null} testTipDiv
 * @param {number} [delayMs]
 */
function scheduleRunNotificationTestPulse(ui, runBtn, testTipDiv, delayMs = 90) {
  clearTimeout(ui.pulseCoalesceTimer);
  ui.pulseCoalesceTimer = setTimeout(() => {
    ui.pulseCoalesceTimer = null;
    runNotificationTestPulseAnimation(ui, runBtn, testTipDiv);
  }, delayMs);
}

/**
 * @param {{ pulseCoalesceTimer: ReturnType<typeof setTimeout> | null, pulseAnimClearTimer: ReturnType<typeof setTimeout> | null }} ui
 * @param {HTMLElement | null} runBtn
 */
function clearNotificationTestPulseTimers(ui, runBtn) {
  clearTimeout(ui.pulseCoalesceTimer);
  ui.pulseCoalesceTimer = null;
  if (ui.pulseAnimClearTimer) {
    clearTimeout(ui.pulseAnimClearTimer);
    ui.pulseAnimClearTimer = null;
  }
  runBtn?.classList.remove('pulse-hint');
}

/**
 * Shows a short inline result inside a card (badge or digest), auto-fades after 8s.
 * @param {HTMLElement | null} el
 * @param {string} text
 * @param {boolean} ok
 */
function showCardPreview(el, text, ok) {
  if (!el) return;
  el.textContent = text;
  el.classList.remove('is-ok', 'is-err');
  el.classList.add('visible', ok ? 'is-ok' : 'is-err');
  clearTimeout(el._fadeTimer);
  el._fadeTimer = setTimeout(() => {
    el.classList.remove('visible', 'is-ok', 'is-err');
  }, 8000);
}

/**
 * @param {Record<string, HTMLElement | null>} dom
 */
function showNotificationTestPanel(dom, text, isError) {
  if (!dom.testOutputEl) return;
  dom.testOutputEl.textContent = text;
  dom.testOutputEl.classList.add('visible');
  dom.testOutputEl.classList.toggle('is-error', !!isError);
}

/**
 * @param {Record<string, HTMLElement | null>} dom
 */
function clearNotificationTestPanel(dom) {
  if (!dom.testOutputEl) return;
  dom.testOutputEl.textContent = '';
  dom.testOutputEl.classList.remove('visible', 'is-error');
}

/**
 * @param {Record<string, HTMLElement | null>} dom
 * @param {('badge'|'desktop_list'|'chime')[]} channels
 * @param {string} headline
 */
function runChannelPreview(dom, channels, headline) {
  if (!dom.testNotifDiv || dom.testNotifDiv.style.display === 'none' || !channels.length) {
    return;
  }
  chrome.runtime.sendMessage(
    { action: UTILS.MESSAGE_NAMES.TEST_NOTIFICATION_CHANNELS, channels },
    (res) => {
      if (chrome.runtime.lastError) return;
      if (!res?.ok) {
        showNotificationTestPanel(dom, res?.error || 'Preview failed.', true);
        return;
      }
      if (res.nothing || !res.channelResults?.length) return;
      showNotificationTestPanel(dom, formatNotificationTestResult(res, { headline }), false);
    }
  );
}

/**
 * @param {Record<string, HTMLElement | null>} dom
 */
function syncAdvTestStripIconButtons(dom) {
  if (dom.advTestToggleBadge && dom.optBadgeEl) {
    dom.advTestToggleBadge.setAttribute('aria-pressed', String(dom.optBadgeEl.checked));
  }
  if (dom.advTestToggleDigest && dom.optPopupEl) {
    dom.advTestToggleDigest.setAttribute('aria-pressed', String(dom.optPopupEl.checked));
  }
  if (dom.advTestToggleChime && dom.warnSoundEl) {
    dom.advTestToggleChime.setAttribute('aria-pressed', String(dom.warnSoundEl.checked));
  }
}

/**
 * @param {Record<string, HTMLElement | null>} dom
 */
function syncPopupSubState(dom) {
  const on = !!dom.optPopupEl?.checked;
  if (dom.popupSubEl) dom.popupSubEl.classList.toggle('is-muted', !on);
  if (dom.warnPersistentEl) dom.warnPersistentEl.disabled = !on;
}

/**
 * @param {Record<string, HTMLElement | null>} dom
 */
function syncSoundSubState(dom) {
  const on = !!dom.warnSoundEl?.checked;
  if (dom.soundSubEl) dom.soundSubEl.classList.toggle('is-muted', !on);
  const dis = !on;
  if (dom.chimeNotifyModeEl) dom.chimeNotifyModeEl.disabled = dis;
  if (dom.chimeSoundEl) dom.chimeSoundEl.disabled = dis;
  if (dom.chimeDurationEl) dom.chimeDurationEl.disabled = dis;
  if (dom.chimeVolumeEl) dom.chimeVolumeEl.disabled = dis;
}

/**
 * @param {Record<string, HTMLElement | null>} dom
 */
function updateChimeDurationLabel(dom) {
  if (dom.chimeDurationValEl && dom.chimeDurationEl) {
    dom.chimeDurationValEl.textContent = `${dom.chimeDurationEl.value} ms`;
  }
}

/**
 * @param {Record<string, HTMLElement | null>} dom
 * @param {{ filterStatusRefreshTimer: ReturnType<typeof setTimeout> | null, tabTitleRefreshTimer: ReturnType<typeof setTimeout> | null, pulseCoalesceTimer: ReturnType<typeof setTimeout> | null, pulseAnimClearTimer: ReturnType<typeof setTimeout> | null, toolUiHeartbeatTimer: ReturnType<typeof setInterval> | null, cachedRegexFilters: Array<{ pattern: string, type: string }>, prevBadgeChecked: boolean, prevPopupChecked: boolean, prevSoundChecked: boolean }} ui
 */
async function persistNotificationModeFromToggles(dom, ui) {
  const mode = getNotificationModeFromDom(dom);
  await chrome.storage.local.set({ [UTILS.STORE_NAMES.NOTIFICATION_MODE]: mode });
  chrome.runtime.sendMessage({ action: UTILS.MESSAGE_NAMES.UPDATE_BADGE_NOW });
  syncPopupSubState(dom);
  syncSummaryNotificationButton(dom);
  syncAdvTestStripIconButtons(dom);
}

/**
 * @param {Record<string, HTMLElement | null>} dom
 */
function readWarningPrefsFromDom(dom) {
  const sid = dom.chimeSoundEl?.value;
  const chimeSoundId = UTILS.CHIME_SOUND_IDS.includes(sid) ? sid : 'soft';
  const dur = parseInt(dom.chimeDurationEl?.value, 10);
  const chimeDurationMs =
    Number.isFinite(dur) && dur >= 200 && dur <= 1500 ? dur : 500;
  const volPct = parseInt(dom.chimeVolumeEl?.value, 10);
  const chimeVolume =
    Number.isFinite(volPct) && volPct >= 5 && volPct <= 100
      ? volPct / 100
      : 0.85;
  const chimeNotifyMode =
    dom.chimeNotifyModeEl?.value === 'first' ? 'first' : 'every';
  return {
    badge: true,
    desktopPopup: false,
    desktopPersistent: !!dom.warnPersistentEl?.checked,
    desktopSound: !!dom.warnSoundEl?.checked,
    chimeNotifyMode,
    toolbarSummary: true,
    chimeSoundId,
    chimeDurationMs,
    chimeVolume,
  };
}

/**
 * @param {Record<string, HTMLElement | null>} dom
 * @param {{ filterStatusRefreshTimer: ReturnType<typeof setTimeout> | null, tabTitleRefreshTimer: ReturnType<typeof setTimeout> | null, pulseCoalesceTimer: ReturnType<typeof setTimeout> | null, pulseAnimClearTimer: ReturnType<typeof setTimeout> | null, toolUiHeartbeatTimer: ReturnType<typeof setInterval> | null, cachedRegexFilters: Array<{ pattern: string, type: string }>, prevBadgeChecked: boolean, prevPopupChecked: boolean, prevSoundChecked: boolean }} ui
 * @param {{ omitTestButtonPulse?: boolean }} [opts]
 */
async function saveWarningPrefs(dom, ui, opts = {}) {
  await chrome.storage.local.set({
    [UTILS.STORE_NAMES.WARNING_PREFS]: readWarningPrefsFromDom(dom),
  });
  chrome.runtime.sendMessage({ action: UTILS.MESSAGE_NAMES.UPDATE_BADGE_NOW });
  syncSummaryNotificationButton(dom);
  if (!opts.omitTestButtonPulse) {
    scheduleRunNotificationTestPulse(ui, dom.runNotificationTestBtn, dom.testNotifDiv);
  }
}

/**
 * Refresh unread + matched lists when storage/tabs change without rebuilding Filters UI.
 * @param {Record<string, HTMLElement | null>} dom
 * @param {Record<string, { since: number, tabIds: number[] }>} notifiedByHostMap
 * @param {Array<{ pattern: string, type: string }>} regexFiltersForMatch
 * @param {chrome.tabs.Tab[]} openTabs
 */
function renderUnreadAndMatchedViews(dom, notifiedByHostMap, regexFiltersForMatch, openTabs) {
  dom.notificationList.replaceChildren();
  dom.matchedList.replaceChildren();

  const notifiedTabIdSet = new Set();
  Object.values(notifiedByHostMap).forEach((entry) => {
    (entry.tabIds || []).forEach((id) => notifiedTabIdSet.add(id));
  });

  let foundNotification = false;
  let foundMatch = false;
  let matchedTabsQuantity = 0;
  const now = Date.now();

  /** @type {Array<{ tab: chrome.tabs.Tab, host: string, entry: { since: number, tabIds: number[] } }>} */
  const notifiedRows = [];
  for (const host of Object.keys(notifiedByHostMap)) {
    const entry = notifiedByHostMap[host];
    for (const id of entry.tabIds || []) {
      const tab = openTabs.find((t) => t.id === id);
      if (tab) notifiedRows.push({ tab, host, entry });
    }
  }

  /** @type {Map<string, { caption: string, rows: typeof notifiedRows }>} */
  const notifyGroups = new Map();
  for (const row of notifiedRows) {
    const pr = UTILS.findFirstStringFilterRuleMatch(row.tab, regexFiltersForMatch);
    const key = pr ? `r:${pr.index}` : '_other';
    const caption = pr
      ? ruleGroupCaption(pr.rule, pr.index)
      : 'Unread · no filter match';
    if (!notifyGroups.has(key)) {
      notifyGroups.set(key, { caption, rows: [] });
    }
    notifyGroups.get(key).rows.push(row);
  }

  const notifyGroupKeys = [
    ...regexFiltersForMatch.map((_, i) => `r:${i}`).filter((k) => notifyGroups.has(k)),
    ...(notifyGroups.has('_other') ? ['_other'] : []),
  ];

  for (const key of notifyGroupKeys) {
    const g = notifyGroups.get(key);
    if (!g?.rows.length) continue;

    const heading = document.createElement('li');
    heading.className = 'regex-group-heading';
    heading.setAttribute('role', 'presentation');
    heading.textContent = g.caption;
    dom.notificationList.appendChild(heading);

    for (const { tab, host, entry } of g.rows) {
      const pr = UTILS.findFirstStringFilterRuleMatch(tab, regexFiltersForMatch);
      const highlightPattern = pr?.rule.pattern || regexFiltersForMatch[0]?.pattern || '.*';
      const notificationItem = document.createElement('li');
      notificationItem.className = 'regex-group-item';
      const favicon = faviconImgHtml(tab);
      notificationItem.innerHTML = `<div class="notification-item-stack"><div class="notification-item-line--host">${favicon} <span class="match-highlight-title">${host}</span></div><div class="notification-item-line--meta"><span>${tab.title || '(no title)'}</span> (<i>${UTILS.getTimeAsHuman(now - entry.since)}</i>)</div><div class="notification-item-line--url"><small>${highlightRegexMatches(tab.url, highlightPattern)}</small></div></div>`;
      notificationItem.style.cursor = 'pointer';
      notificationItem.tabIndex = 0;
      notificationItem.onclick = () => {
        void UTILS.focusTabInWindow(tab.id, tab.windowId);
      };
      dom.notificationList.appendChild(notificationItem);
      foundNotification = true;
    }
  }

  /** @type {chrome.tabs.Tab[]} */
  const matchedOnlyTabs = [];
  openTabs.forEach((tab) => {
    const prMatch = UTILS.findFirstStringFilterRuleMatch(tab, regexFiltersForMatch);
    const isNotified = notifiedTabIdSet.has(tab.id);

    if (!isNotified && !prMatch) return;

    matchedTabsQuantity++;

    if (!isNotified && prMatch) {
      matchedOnlyTabs.push(tab);
    }
  });

  /** @type {Map<string, { caption: string, rows: chrome.tabs.Tab[] }>} */
  const matchedGroups = new Map();
  for (const tab of matchedOnlyTabs) {
    const pr = UTILS.findFirstStringFilterRuleMatch(tab, regexFiltersForMatch);
    const key = pr ? `r:${pr.index}` : '_other';
    const caption = pr ? ruleGroupCaption(pr.rule, pr.index) : 'Matched';
    if (!matchedGroups.has(key)) {
      matchedGroups.set(key, { caption, rows: [] });
    }
    matchedGroups.get(key).rows.push(tab);
  }

  const matchedGroupKeys = [
    ...regexFiltersForMatch.map((_, i) => `r:${i}`).filter((k) => matchedGroups.has(k)),
    ...(matchedGroups.has('_other') ? ['_other'] : []),
  ];

  for (const key of matchedGroupKeys) {
    const g = matchedGroups.get(key);
    if (!g?.rows.length) continue;

    const heading = document.createElement('li');
    heading.className = 'regex-group-heading';
    heading.setAttribute('role', 'presentation');
    heading.textContent = g.caption;
    dom.matchedList.appendChild(heading);

    for (const tab of g.rows) {
      const pr = UTILS.findFirstStringFilterRuleMatch(tab, regexFiltersForMatch);
      const highlightPattern = pr?.rule.pattern || '.*';
      const matchedItem = document.createElement('li');
      matchedItem.className = 'regex-group-item';
      const favicon = faviconImgHtml(tab);
      matchedItem.innerHTML = `<div class="matched-item-stack"><div class="matched-item-line--title">${favicon} ${tab.title}</div><div class="matched-item-line--url"><small>${highlightRegexMatches(tab.url, highlightPattern)}</small></div></div>`;
      matchedItem.style.opacity = 0.8;
      matchedItem.style.cursor = 'pointer';
      matchedItem.tabIndex = 0;
      matchedItem.onclick = () => {
        void UTILS.focusTabInWindow(tab.id, tab.windowId);
      };
      dom.matchedList.appendChild(matchedItem);
      foundMatch = true;
    }
  }

  if (dom.tabWorkNoticeEl) {
    const hasFilters = regexFiltersForMatch.length > 0;
    const anyOpenMatch =
      hasFilters && openTabs.some((t) => UTILS.tabMatchesAnyStringFilterRules(t, regexFiltersForMatch));
    if (hasFilters && !anyOpenMatch) {
      dom.tabWorkNoticeEl.textContent =
        'We only watch open tabs: each tab’s URL and title is checked against your filters, so the page must stay open for new activity to show up. No tab matches yet — open the site, then tap here for Filters (counts per rule, ↗ to open a URL).';
      dom.tabWorkNoticeEl.classList.add('tab-work-notice--visible');
    } else {
      dom.tabWorkNoticeEl.textContent = '';
      dom.tabWorkNoticeEl.classList.remove('tab-work-notice--visible');
    }
  }

  const mtq = dom.matchedTitleQuantity;
  if (mtq) mtq.textContent = ` (${matchedTabsQuantity})`;

  const hasOpenTabMatchingFilters =
    regexFiltersForMatch.length > 0 &&
    openTabs.some((t) => UTILS.tabMatchesAnyStringFilterRules(t, regexFiltersForMatch));

  dom.notificationsTitle.style.display = foundNotification ? 'block' : 'none';
  dom.noNotifications.style.display =
    foundNotification || hasOpenTabMatchingFilters ? 'none' : 'block';
  dom.clearBadgeButton.style.display = foundNotification ? 'inline-block' : 'none';
  syncSummaryNotificationButton(dom);

  if (dom.matchedTitle) {
    dom.matchedTitle.style.display = foundMatch ? 'block' : 'none';
  }
  dom.noMatched.style.display = foundMatch ? 'none' : 'block';
}

/**
 * @param {Record<string, HTMLElement | null>} dom
 * @param {{ filterStatusRefreshTimer: ReturnType<typeof setTimeout> | null, tabTitleRefreshTimer: ReturnType<typeof setTimeout> | null, pulseCoalesceTimer: ReturnType<typeof setTimeout> | null, pulseAnimClearTimer: ReturnType<typeof setTimeout> | null, toolUiHeartbeatTimer: ReturnType<typeof setInterval> | null, cachedRegexFilters: Array<{ pattern: string, type: string }>, prevBadgeChecked: boolean, prevPopupChecked: boolean, prevSoundChecked: boolean }} ui
 */
async function saveRegexRules(dom, ui) {
  const containers = dom.regexList.querySelectorAll('.regex-row');
  const newFilters = [];
  containers.forEach((c) => {
    const pattern = c.querySelector('input[type="text"]')?.value.trim() ?? '';
    const type = c.querySelector('select')?.value ?? 'url';
    if (pattern && UTILS.isRegexPatternSyntaxValid(pattern)) {
      newFilters.push({ pattern, type });
    } else if (pattern) {
      console.warn(`Regex inválido ignorado: ${pattern}`);
    }
  });
  await chrome.storage.local.set({ [UTILS.STORE_NAMES.REGEX_FILTERS]: newFilters });
  ui.cachedRegexFilters = newFilters;
  const nbStore = await chrome.storage.local.get(UTILS.STORE_NAMES.NOTIFIED_BY_HOST);
  const nb = nbStore[UTILS.STORE_NAMES.NOTIFIED_BY_HOST] || {};
  const tabsFresh = await chrome.tabs.query({});
  renderUnreadAndMatchedViews(dom, nb, newFilters, tabsFresh);
  refreshFilterTabStatus(dom, tabsFresh);
  dom.saveMessage.style.display = 'block';
  dom.saveMessage.style.opacity = 1;
  dom.saveMessage.style.transition = '';
  setTimeout(() => {
    dom.saveMessage.style.transition = 'opacity 0.5s';
    dom.saveMessage.style.opacity = 0;
    setTimeout(() => {
      dom.saveMessage.style.display = 'none';
      dom.saveMessage.style.opacity = 1;
      dom.saveMessage.style.transition = '';
    }, 500);
  }, 2000);
}

/**
 * @param {Record<string, HTMLElement | null>} dom
 * @param {{ filterStatusRefreshTimer: ReturnType<typeof setTimeout> | null, tabTitleRefreshTimer: ReturnType<typeof setTimeout> | null, pulseCoalesceTimer: ReturnType<typeof setTimeout> | null, pulseAnimClearTimer: ReturnType<typeof setTimeout> | null, toolUiHeartbeatTimer: ReturnType<typeof setInterval> | null, cachedRegexFilters: Array<{ pattern: string, type: string }>, prevBadgeChecked: boolean, prevPopupChecked: boolean, prevSoundChecked: boolean }} ui
 * @param {{ pattern?: string, type?: string, onRemove?: (() => void) | null, editable?: boolean }} [prefill]
 */
function createRegexRow(dom, ui, prefill = {}) {
  const p = {
    pattern: '',
    type: 'url',
    onRemove: null,
    editable: true,
    ...prefill,
  };
  const container = document.createElement('div');
  container.className = 'regex-row';

  const pattern = document.createElement('input');
  pattern.type = 'text';
  pattern.placeholder = 'Regex pattern';
  pattern.value = p.pattern;
  pattern.title = 'Padrão regex';
  pattern.addEventListener('input', () => {
    void saveRegexRules(dom, ui);
    scheduleRefreshFilterTabStatus(dom, ui);
  });

  const type = document.createElement('select');
  ['url', 'title'].forEach((opt) => {
    const option = document.createElement('option');
    option.value = opt;
    option.text = opt;
    type.appendChild(option);
  });
  if (!p.editable) {
    type.disabled = true;
    pattern.disabled = true;
    pattern.readOnly = true;
  }
  type.classList.add('nodisplay');
  type.value = p.type;
  type.title = 'Tipo de regra';
  type.addEventListener('change', () => {
    void saveRegexRules(dom, ui);
    scheduleRefreshFilterTabStatus(dom, ui);
  });

  const statusSpan = document.createElement('span');
  statusSpan.className = 'regex-row-match-count';
  statusSpan.setAttribute('aria-label', 'Open tabs matching this row');

  const helpBtn = document.createElement('button');
  helpBtn.type = 'button';
  helpBtn.className = 'regex-help-open';
  helpBtn.textContent = '\u2197';
  helpBtn.title = 'Open in new tab — edit URL if needed, then confirm';
  helpBtn.setAttribute('aria-label', 'Open tab from this filter (external link)');

  const panel = document.createElement('div');
  panel.className = 'regex-open-panel';

  const panelLabel = document.createElement('label');
  panelLabel.textContent = 'Open tab at this address (edit if needed, then Open tab)';

  const urlInput = document.createElement('input');
  urlInput.type = 'text';
  urlInput.className = 'regex-open-url-input';
  urlInput.spellcheck = false;
  urlInput.autocomplete = 'off';

  const actions = document.createElement('div');
  actions.className = 'regex-open-tab-actions';

  const okBtn = document.createElement('button');
  okBtn.type = 'button';
  okBtn.className = 'regex-open-tab-ok';
  okBtn.textContent = 'Open tab';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'regex-open-tab-cancel';
  cancelBtn.textContent = 'Cancel';

  helpBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const wasOpen = panel.classList.contains('is-open');
    closeAllRegexOpenPanels(dom);
    if (!wasOpen) {
      urlInput.value = guessOpenUrlFromFilter(pattern.value, type.value);
      panel.classList.add('is-open');
      urlInput.focus();
      urlInput.select();
    }
  });

  cancelBtn.addEventListener('click', () => {
    panel.classList.remove('is-open');
  });

  okBtn.addEventListener('click', () => {
    let u = urlInput.value.trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) {
      u = `https://${u}`;
    }
    try {
      const parsed = new URL(u);
      chrome.tabs.create({ url: parsed.href });
      panel.classList.remove('is-open');
    } catch {
      window.alert('Please enter a valid http(s) URL.');
    }
  });

  actions.appendChild(okBtn);
  actions.appendChild(cancelBtn);
  panel.appendChild(panelLabel);
  panel.appendChild(urlInput);
  panel.appendChild(actions);

  const removeBtn = document.createElement('button');
  removeBtn.className = 'remove-btn';
  removeBtn.textContent = '🗑️';
  removeBtn.title = 'Remover filtro';
  removeBtn.onclick = () => {
    if (p.onRemove) p.onRemove();
    container.remove();
    void saveRegexRules(dom, ui);
    scheduleRefreshFilterTabStatus(dom, ui);
  };

  container.appendChild(pattern);
  container.appendChild(type);
  container.appendChild(statusSpan);
  container.appendChild(helpBtn);
  container.appendChild(removeBtn);
  container.appendChild(panel);
  dom.regexList.appendChild(container);
}

async function initPopup() {
  const dom = {
    notificationList: document.getElementById('notification-list'),
    matchedList: document.getElementById('matched-list'),
    regexList: document.getElementById('regex-list'),
    notificationsTitle: document.getElementById('notifications-title'),
    matchedTitle: document.getElementById('matched-title'),
    matchedTitleQuantity: document.getElementById('matched-title-quantity'),
    clearBadgeButton: document.getElementById('clear-badge'),
    summaryNotifyButton: document.getElementById('show-summary-notification'),
    noNotifications: document.getElementById('no-notifications'),
    noMatched: document.getElementById('no-matched'),
    clearMessage: document.getElementById('clear-message'),
    saveMessage: document.getElementById('save-message'),
    tabWorkNoticeEl: document.getElementById('tab-work-notice'),
    filterPartialNoticeEl: document.getElementById('filter-partial-notice'),
    addRegexButton: document.getElementById('add-regex'),
    saveRegexButton: document.getElementById('save-regex'),
    testNotifDiv: document.getElementById('test-notif-tip'),
    testOutputEl: document.getElementById('notification-test-output'),
    runNotificationTestBtn: document.getElementById('run-notification-test'),
    optBadgeEl: document.getElementById('opt-badge'),
    optPopupEl: document.getElementById('opt-popup'),
    badgePreviewEl: document.getElementById('badge-preview'),
    popupPreviewEl: document.getElementById('popup-preview'),
    popupSubEl: document.getElementById('popup-sub'),
    soundSubEl: document.getElementById('sound-sub'),
    warnPersistentEl: document.getElementById('warn-persistent'),
    warnSoundEl: document.getElementById('warn-sound'),
    chimeNotifyModeEl: document.getElementById('chime-notify-mode'),
    chimeSoundEl: document.getElementById('chime-sound'),
    chimeDurationEl: document.getElementById('chime-duration'),
    chimeDurationValEl: document.getElementById('chime-duration-val'),
    chimeVolumeEl: document.getElementById('chime-volume'),
    advTestToggleBadge: document.getElementById('adv-test-toggle-badge'),
    advTestToggleDigest: document.getElementById('adv-test-toggle-digest'),
    advTestToggleChime: document.getElementById('adv-test-toggle-chime'),
    colorSchemaDiv: document.getElementById('badge-color-schema'),
    filterMatchStatusEl: document.getElementById('filter-match-status'),
  };

  /** One object per popup open: timers, filter cache, toggle baselines (explicit state, not module globals). */
  const ui = {
    filterStatusRefreshTimer: /** @type {ReturnType<typeof setTimeout> | null} */ (null),
    tabTitleRefreshTimer: /** @type {ReturnType<typeof setTimeout> | null} */ (null),
    pulseCoalesceTimer: /** @type {ReturnType<typeof setTimeout> | null} */ (null),
    pulseAnimClearTimer: /** @type {ReturnType<typeof setTimeout> | null} */ (null),
    toolUiHeartbeatTimer: /** @type {ReturnType<typeof setInterval> | null} */ (null),
    cachedRegexFilters: /** @type {Array<{ pattern: string, type: string }>} */ ([]),
    prevBadgeChecked: false,
    prevPopupChecked: false,
    prevSoundChecked: false,
  };

  document.getElementById('popup-theme-dark')?.addEventListener('change', async (e) => {
    const on = /** @type {HTMLInputElement} */ (e.target).checked;
    document.documentElement.dataset.theme = on ? 'dark' : 'light';
    await chrome.storage.local.set({ [UTILS.STORE_NAMES.POPUP_THEME]: on ? 'dark' : 'light' });
  });

  if (dom.runNotificationTestBtn) {
    dom.runNotificationTestBtn.onclick = () => {
      clearNotificationTestPulseTimers(ui, dom.runNotificationTestBtn);
      clearNotificationTestPanel(dom);
      chrome.runtime.sendMessage(
        { action: UTILS.MESSAGE_NAMES.TEST_ALL_ALERTS },
        (res) => {
          if (chrome.runtime.lastError) {
            showNotificationTestPanel(dom, 'Could not run test: ' + chrome.runtime.lastError.message, true);
            return;
          }
          if (res?.nothing) {
            showNotificationTestPanel(dom, res.hint || 'Nothing to test. Turn on the toolbar badge, desktop digest, or extension chime.', true);
            return;
          }
          if (!res?.ok) {
            showNotificationTestPanel(dom, res?.error || 'Test failed.', true);
            return;
          }
          if (res.channelResults?.length) {
            showNotificationTestPanel(dom, formatNotificationTestResult(res), false);
          }
        }
      );
    };
  }

  document.getElementById('show-notification').addEventListener('click', async () => {
    activateOneTabOnly('notification');
    const openTabs = await chrome.tabs.query({});
    updateFilterPartialNoticeBar(dom, openTabs);
  });

  document.getElementById('show-filters').addEventListener('click', async () => {
    activateOneTabOnly('filters');
    const openTabs = await chrome.tabs.query({});
    refreshFilterTabStatus(dom, openTabs);
  });

  document.getElementById('show-advanced').addEventListener('click', () => {
    activateOneTabOnly('advanced');
  });

  dom.noNotifications.addEventListener('click', clickFiltersTab);
  dom.noMatched.addEventListener('click', clickFiltersTab);
  dom.tabWorkNoticeEl?.addEventListener('click', clickFiltersTab);
  dom.filterPartialNoticeEl?.addEventListener('click', clickFiltersTab);

  dom.advTestToggleBadge?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleCheckboxAndEmitChange(dom.optBadgeEl);
  });
  dom.advTestToggleDigest?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleCheckboxAndEmitChange(dom.optPopupEl);
  });
  dom.advTestToggleChime?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleCheckboxAndEmitChange(dom.warnSoundEl);
  });

  [dom.warnPersistentEl, dom.chimeNotifyModeEl, dom.chimeSoundEl].forEach((el) => {
    if (el) el.addEventListener('change', () => void saveWarningPrefs(dom, ui));
  });
  [dom.chimeDurationEl, dom.chimeVolumeEl].forEach((el) => {
    if (el) {
      el.addEventListener('input', () => {
        updateChimeDurationLabel(dom);
        void saveWarningPrefs(dom, ui);
        scheduleRunNotificationTestPulse(ui, dom.runNotificationTestBtn, dom.testNotifDiv, 280);
      });
    }
  });
  if (dom.warnSoundEl) {
    dom.warnSoundEl.addEventListener('change', async () => {
      const turnedOn = dom.warnSoundEl.checked && !ui.prevSoundChecked;
      syncSoundSubState(dom);
      await saveWarningPrefs(dom, ui);
      if (turnedOn) {
        runChannelPreview(dom, ['chime'], 'Quick preview — extension chime (current tone / length / volume):');
      }
      ui.prevSoundChecked = dom.warnSoundEl.checked;
      syncAdvTestStripIconButtons(dom);
    });
  }

  if (dom.optBadgeEl) {
    dom.optBadgeEl.addEventListener('change', async () => {
      const turnedOn = dom.optBadgeEl.checked && !ui.prevBadgeChecked;
      await persistNotificationModeFromToggles(dom, ui);
      if (turnedOn) {
        /* updateBadge() runs on persist and may clear the demo if no unread; delay so actionSetForTest wins */
        window.setTimeout(() => {
          chrome.runtime.sendMessage(
            { action: UTILS.MESSAGE_NAMES.TEST_NOTIFICATION_CHANNELS, channels: ['badge'] },
            (res) => {
              if (chrome.runtime.lastError) return;
              const ok = !!res?.ok && !res?.nothing;
              const text = ok
                ? 'Badge shown on the pinned toolbar icon — hover it to see the title.'
                : (res?.error || 'Badge preview failed.');
              showCardPreview(dom.badgePreviewEl, text, ok);
            }
          );
        }, 480);
      }
      ui.prevBadgeChecked = dom.optBadgeEl.checked;
      syncAdvTestStripIconButtons(dom);
    });
  }
  if (dom.optPopupEl) {
    dom.optPopupEl.addEventListener('change', async () => {
      const turnedOn = dom.optPopupEl.checked && !ui.prevPopupChecked;
      await persistNotificationModeFromToggles(dom, ui);
      await saveWarningPrefs(dom, ui, { omitTestButtonPulse: true });
      if (turnedOn) {
        chrome.runtime.sendMessage(
          { action: UTILS.MESSAGE_NAMES.TEST_NOTIFICATION_CHANNELS, channels: ['desktop_list'] },
          (res) => {
            if (chrome.runtime.lastError) return;
            const ok = !!res?.ok && !res?.nothing;
            const text = ok
              ? 'Digest toast sent — check the notification center or Windows taskbar.'
              : (res?.error || 'Digest preview failed.');
            showCardPreview(dom.popupPreviewEl, text, ok);
          }
        );
      }
      ui.prevPopupChecked = dom.optPopupEl.checked;
      syncAdvTestStripIconButtons(dom);
    });
  }

  document.querySelectorAll('.adv-block .help-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') === 'true';
      const next = !open;
      btn.setAttribute('aria-expanded', String(next));
      const panel = btn.closest('.adv-block')?.querySelector('.help-panel');
      if (panel) panel.classList.toggle('is-open', next);
    });
  });

  const [stored, tabs] = await Promise.all([
    chrome.storage.local.get([
      UTILS.STORE_NAMES.POPUP_THEME,
      UTILS.STORE_NAMES.REGEX_FILTERS,
      UTILS.STORE_NAMES.NOTIFIED_BY_HOST,
      UTILS.STORE_NAMES.NOTIFICATION_MODE,
      UTILS.STORE_NAMES.WARNING_PREFS,
      UTILS.STORE_NAMES.BADGE_COLOR_SCHEME,
    ]),
    chrome.tabs.query({}),
  ]);

  applyPopupThemeFromStorageValue(stored[UTILS.STORE_NAMES.POPUP_THEME]);

  const regexFilters = stored[UTILS.STORE_NAMES.REGEX_FILTERS] || [];
  ui.cachedRegexFilters = regexFilters;
  const notifiedByHost = stored[UTILS.STORE_NAMES.NOTIFIED_BY_HOST] || {};
  const notificationMode = UTILS.normalizeNotificationMode(stored[UTILS.STORE_NAMES.NOTIFICATION_MODE]);
  const warningPrefs = { ...UTILS.DEFAULT_WARNING_PREFS, ...(stored[UTILS.STORE_NAMES.WARNING_PREFS] || {}) };

  dom.warnPersistentEl.checked = warningPrefs.desktopPersistent !== false;
  dom.warnSoundEl.checked = warningPrefs.desktopSound !== false;
  if (dom.chimeNotifyModeEl) {
    dom.chimeNotifyModeEl.value =
      warningPrefs.chimeNotifyMode === 'first' ? 'first' : 'every';
  }
  if (dom.chimeSoundEl) {
    const sid = UTILS.CHIME_SOUND_IDS.includes(warningPrefs.chimeSoundId)
      ? warningPrefs.chimeSoundId
      : 'soft';
    dom.chimeSoundEl.value = sid;
  }
  if (dom.chimeDurationEl) {
    const d = parseInt(warningPrefs.chimeDurationMs, 10);
    dom.chimeDurationEl.value = String(
      Number.isFinite(d) && d >= 200 && d <= 1500 ? d : 500
    );
  }
  if (dom.chimeVolumeEl) {
    const v = Number(warningPrefs.chimeVolume);
    const pct = Number.isFinite(v) ? Math.round(v * 100) : 85;
    dom.chimeVolumeEl.value = String(Math.min(100, Math.max(5, pct)));
  }
  updateChimeDurationLabel(dom);

  const badgeOn = UTILS.notificationModeIncludesBadge(notificationMode);
  const popupOn = UTILS.notificationModeIncludesDigest(notificationMode);
  if (dom.optBadgeEl) dom.optBadgeEl.checked = badgeOn;
  if (dom.optPopupEl) dom.optPopupEl.checked = popupOn;
  syncPopupSubState(dom);
  syncSoundSubState(dom);

  ui.prevBadgeChecked = !!dom.optBadgeEl?.checked;
  ui.prevPopupChecked = !!dom.optPopupEl?.checked;
  ui.prevSoundChecked = !!dom.warnSoundEl?.checked;
  syncAdvTestStripIconButtons(dom);

  renderUnreadAndMatchedViews(dom, notifiedByHost, ui.cachedRegexFilters, tabs);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[UTILS.STORE_NAMES.NOTIFIED_BY_HOST]) return;
    const raw = changes[UTILS.STORE_NAMES.NOTIFIED_BY_HOST].newValue;
    const next = raw && typeof raw === 'object' ? raw : {};
    chrome.tabs.query({}, (openTabs) => {
      renderUnreadAndMatchedViews(dom, next, ui.cachedRegexFilters, openTabs);
      updateFilterPartialNoticeBar(dom, openTabs);
    });
  });

  /** Re-read tab titles while this UI is open (storage does not change on title-only updates). */
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (!changeInfo.title && !changeInfo.favIconUrl) return;
    if (ui.tabTitleRefreshTimer != null) clearTimeout(ui.tabTitleRefreshTimer);
    ui.tabTitleRefreshTimer = setTimeout(async () => {
      ui.tabTitleRefreshTimer = null;
      try {
        const nbStore = await chrome.storage.local.get(UTILS.STORE_NAMES.NOTIFIED_BY_HOST);
        const nb = nbStore[UTILS.STORE_NAMES.NOTIFIED_BY_HOST] || {};
        const openTabs = await chrome.tabs.query({});
        renderUnreadAndMatchedViews(dom, nb, ui.cachedRegexFilters, openTabs);
        updateFilterPartialNoticeBar(dom, openTabs);
      } catch {
        /* ignore */
      }
    }, 200);
  });

  [dom.addRegexButton, dom.saveRegexButton, dom.clearBadgeButton, dom.summaryNotifyButton].forEach((button) => {
    if (!button) return;
    button.style.cursor = 'pointer';
  });

  regexFilters.forEach((rule) => {
    const alreadyExists = DEFAULT_SUGGESTIONS.some(s => rule.pattern === s.pattern);
    if (!alreadyExists) createRegexRow(dom, ui, rule);
  });

  const suggestionTitle = document.createElement('h4');
  suggestionTitle.textContent = 'Quick Suggestions:';
  suggestionTitle.style.marginTop = '10px';

  const suggestionContainer = document.createElement('div');
  suggestionContainer.style = 'margin-top:5px; display: flex;flex-direction: column;align-items: flex-start';

  DEFAULT_SUGGESTIONS.forEach(s => {
    const btn = document.createElement('button');
    btn.innerHTML = `+ <img src="./icons/${s.title}.png" class="suggestion_icon" alt="icon" /> ${s.pattern}`;
    btn.classList.add('regex_suggestion');
    btn.title = `Adicionar filtro para ${s.title}`;
    btn.tabIndex = 0;
    btn.onclick = () => {
      s.onRemove = () => {
        suggestionContainer.appendChild(btn);
      };
      createRegexRow(dom, ui, s);
      btn.remove();
      setTimeout(() => void saveRegexRules(dom, ui), 100);
    };
    suggestionContainer.appendChild(btn);

    const alreadyExists = regexFilters.some(rule => rule.pattern === s.pattern);
    if (alreadyExists) {
      btn.click();
    }
  });

  dom.regexList.parentNode.insertBefore(suggestionTitle, dom.addRegexButton);
  dom.regexList.parentNode.insertBefore(suggestionContainer, dom.addRegexButton);

  createRegexRow(dom, ui);

  refreshFilterTabStatus(dom, tabs);

  dom.addRegexButton.addEventListener('click', () => {
    createRegexRow(dom, ui);
    scheduleRefreshFilterTabStatus(dom, ui);
  });

  dom.clearBadgeButton.addEventListener('click', async () => {
    await chrome.storage.local.set({ [UTILS.STORE_NAMES.NOTIFIED_BY_HOST]: {} });
    chrome.runtime.sendMessage({ action: UTILS.MESSAGE_NAMES.UPDATE_BADGE_NOW });
    const tabsAfter = await chrome.tabs.query({});
    renderUnreadAndMatchedViews(dom, {}, ui.cachedRegexFilters, tabsAfter);
    dom.clearMessage.style.display = 'block';
    setTimeout(() => dom.clearMessage.style.display = 'none', 2000);
  });

  dom.summaryNotifyButton.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: UTILS.MESSAGE_NAMES.SHOW_DESKTOP_SUMMARY });
  });

  const schemeList = stored[UTILS.STORE_NAMES.BADGE_COLOR_SCHEME];
  const colorItems = [];
  if (Array.isArray(schemeList)) {
    schemeList.forEach((colorItem) => {
      const colorSchemaItem = document.createElement('li');
      colorSchemaItem.innerHTML = `After <input type="number" name="number" value="${colorItem.threshold}" style="width:3rem;"/> minutes <input type="color" name="color" value="${colorItem.color}"/> `;
      dom.colorSchemaDiv.appendChild(colorSchemaItem);
      colorItems.push(colorSchemaItem);
    });
  }
  if (colorItems.length > 0) {
    colorItems[0].querySelector('input[type="number"]').disabled = true;
    colorItems[colorItems.length - 1].querySelector('input[type="number"]').disabled = true;
  }

  const handleChange = UTILS.debounce(async function handleChange(event) {
    const newColorScheme = Array.from(dom.colorSchemaDiv.querySelectorAll("li")).map((colorItem) => {
      return {threshold: parseInt(colorItem.querySelector('input[type="number"]').value), color: colorItem.querySelector('input[type="color"]').value };
    });
    await chrome.storage.local.set({ [UTILS.STORE_NAMES.BADGE_COLOR_SCHEME]: newColorScheme });
    chrome.runtime.sendMessage({ action: UTILS.MESSAGE_NAMES.UPDATE_BADGE_NOW });
  }, 500);
  dom.colorSchemaDiv.addEventListener('input', handleChange);
  dom.colorSchemaDiv.addEventListener('change', handleChange);

  await sendToolUiHostHeartbeat();
  ui.toolUiHeartbeatTimer = setInterval(sendToolUiHostHeartbeat, 4000);
  window.addEventListener('pagehide', () => {
    if (ui.toolUiHeartbeatTimer != null) clearInterval(ui.toolUiHeartbeatTimer);
    chrome.runtime
      .sendMessage({ action: UTILS.MESSAGE_NAMES.TOOL_UI_HOST_HEARTBEAT, hosts: [] })
      .catch(() => {});
  });
}

document.addEventListener('DOMContentLoaded', () => {
  void initPopup().catch((err) => console.warn('Inbox Radar popup init:', err));
});

/** Preserve vertical scroll per section when switching tabs (Chrome popup). */
const sectionScrollTop = { notification: 0, filters: 0, advanced: 0 };

function sectionKeyFromActivePanel() {
  const el = document.querySelector('div.section.active');
  if (!el) return 'notification';
  if (el.classList.contains('notification')) return 'notification';
  if (el.classList.contains('filters')) return 'filters';
  return 'advanced';
}

function activateOneTabOnly(tabName) {
  const from = sectionKeyFromActivePanel();
  const prevSection = document.querySelector(`div.section.${from}`);
  if (prevSection) sectionScrollTop[from] = prevSection.scrollTop;

  Array.from(document.querySelectorAll('button.tab.active')).forEach((button) => {
    button.classList.remove('active');
  });

  Array.from(document.querySelectorAll('div.section.active')).forEach((div) => {
    div.classList.remove('active');
  });

  document.querySelector('button.tab.' + tabName).classList.add('active');
  const nextSection = document.querySelector('div.section.' + tabName);
  if (nextSection) {
    nextSection.classList.add('active');
    requestAnimationFrame(() => {
      nextSection.scrollTop = sectionScrollTop[tabName] || 0;
    });
  }
}
