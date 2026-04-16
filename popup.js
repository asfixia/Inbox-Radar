import { DEFAULT_SUGGESTIONS } from './suggestions.js';
import * as UTILS from './utils.js';
import {
  CHIME_SOUND_IDS,
  DEFAULT_WARNING_PREFS,
  MESSAGE_NAMES,
  STORE_NAMES,
} from './utils.js';

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
document.addEventListener('DOMContentLoaded', async () => {
  const notificationList = document.getElementById('notification-list');
  const matchedList = document.getElementById('matched-list');
  const regexList = document.getElementById('regex-list');

  const notificationsTitle = document.getElementById('notifications-title');
  const matchedTitle = document.getElementById('matched-title');
  const clearBadgeButton = document.getElementById('clear-badge');
  const summaryNotifyButton = document.getElementById('show-summary-notification');
  const noNotifications = document.getElementById('no-notifications');
  const noMatched = document.getElementById('no-matched');
  const clearMessage = document.getElementById('clear-message');
  const saveMessage = document.getElementById('save-message');
  const tabWorkNoticeEl = document.getElementById('tab-work-notice');
  const filterPartialNoticeEl = document.getElementById('filter-partial-notice');

  function applyPopupThemeFromStorageValue(themeVal) {
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
    const dark = themeVal === 'dark' || (themeVal !== 'light' && prefersDark);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    const chk = document.getElementById('popup-theme-dark');
    if (chk) chk.checked = dark;
  }

  document.getElementById('popup-theme-dark')?.addEventListener('change', async (e) => {
    const on = /** @type {HTMLInputElement} */ (e.target).checked;
    document.documentElement.dataset.theme = on ? 'dark' : 'light';
    await chrome.storage.local.set({ [STORE_NAMES.POPUP_THEME]: on ? 'dark' : 'light' });
  });

  const addRegexButton = document.getElementById('add-regex');
  const saveRegexButton = document.getElementById('save-regex');

  let filterStatusRefreshTimer = null;

  /**
   * @param {chrome.tabs.Tab} tab
   * @param {{ pattern: string, type: string }} rule
   */
  function tabMatchesSingleRule(tab, rule) {
    try {
      const regex = new RegExp(rule.pattern, 'i');
      if (rule.type === 'url') return regex.test(tab.url || '');
      if (rule.type === 'title') return regex.test(tab.title || '');
    } catch {
      return false;
    }
    return false;
  }

  /**
   * @param {chrome.tabs.Tab} tab
   * @param {Array<{ pattern: string, type: string }>} rules
   */
  function tabMatchesFilters(tab, rules) {
    if (!rules.length) return false;
    return rules.some((rule) => {
      try {
        const regex = new RegExp(rule.pattern, 'i');
        if (rule.type === 'url') return regex.test(tab.url || '');
        if (rule.type === 'title') return regex.test(tab.title || '');
        return false;
      } catch {
        return false;
      }
    });
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

  function closeAllRegexOpenPanels() {
    regexList.querySelectorAll('.regex-open-panel').forEach((p) => {
      p.classList.remove('is-open');
    });
  }

  /**
   * @param {chrome.tabs.Tab[]} openTabs
   */
  function refreshFilterTabStatus(openTabs) {
    const bits = [];
    for (const row of regexList.querySelectorAll('.regex-row')) {
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
      let valid = true;
      try {
        new RegExp(pattern);
      } catch {
        valid = false;
      }
      if (!valid) {
        badge.textContent = 'invalid';
        badge.classList.remove('regex-row-match-count--zero');
        helpOpen?.classList.remove('regex-help-open--zero');
        bits.push(`"${pattern.slice(0, 14)}…" (invalid)`);
        continue;
      }
      const rule = { pattern, type: sel.value };
      const n = openTabs.filter((t) => tabMatchesSingleRule(t, rule)).length;
      badge.textContent = n === 0 ? '0 tabs' : `${n} tab${n === 1 ? '' : 's'}`;
      badge.classList.toggle('regex-row-match-count--zero', n === 0);
      helpOpen?.classList.toggle('regex-help-open--zero', n === 0);
      const short = pattern.length > 18 ? `${pattern.slice(0, 18)}…` : pattern;
      bits.push(`${short} (${rule.type}): ${n}`);
    }
    const statusEl = document.getElementById('filter-match-status');
    if (statusEl) {
      statusEl.textContent = bits.length ? `Open tabs — ${bits.join(' · ')}` : '';
    }
    updateFilterPartialNoticeBar(openTabs);
  }

  /**
   * Notifications tab hint: some saved rules have no open tab while others still match.
   * @param {chrome.tabs.Tab[]} openTabs
   */
  function updateFilterPartialNoticeBar(openTabs) {
    const el = document.getElementById('filter-partial-notice');
    if (!el) return;
    const rules = [];
    for (const row of regexList.querySelectorAll('.regex-row')) {
      const inp = row.querySelector('input[type="text"]');
      const sel = row.querySelector('select');
      if (!inp || !sel) continue;
      const pattern = inp.value.trim();
      if (!pattern) continue;
      try {
        new RegExp(pattern);
      } catch {
        continue;
      }
      rules.push({ pattern, type: sel.value });
    }
    const titleEl = el.querySelector('.filter-partial-notice__title');
    const bodyEl = el.querySelector('.filter-partial-notice__body');

    if (!rules.length) {
      el.classList.remove('filter-partial-notice--visible');
      if (titleEl) titleEl.textContent = '';
      if (bodyEl) bodyEl.textContent = '';
      return;
    }
    const anyMatch = openTabs.some((t) => tabMatchesFilters(t, rules));
    const someZero = rules.some(
      (rule) => openTabs.filter((t) => tabMatchesSingleRule(t, rule)).length === 0
    );
    if (anyMatch && someZero) {
      if (titleEl) {
        titleEl.textContent = 'Some filters have no open matching tabs.';
      }
      if (bodyEl) {
        bodyEl.textContent = 'Open a tab to enable notifications (use ↗ in Filters).';
      }
      el.classList.add('filter-partial-notice--visible');
    } else {
      el.classList.remove('filter-partial-notice--visible');
      if (titleEl) titleEl.textContent = '';
      if (bodyEl) bodyEl.textContent = '';
    }
  }

  function scheduleRefreshFilterTabStatus() {
    clearTimeout(filterStatusRefreshTimer);
    filterStatusRefreshTimer = setTimeout(async () => {
      refreshFilterTabStatus(await chrome.tabs.query({}));
    }, 280);
  }

  const testNotifDiv = document.getElementById('test-notif-tip');
  const testOutputEl = document.getElementById('notification-test-output');
  const runNotificationTestBtn = document.getElementById('run-notification-test');

  let prevBadgeChecked = false;
  let prevPopupChecked = false;
  let prevSoundChecked = false;
  let pulseCoalesceTimer = null;
  let pulseAnimClearTimer = null;

  function pulseRunTestButton() {
    if (!runNotificationTestBtn || testNotifDiv.style.display === 'none') {
      return;
    }
    runNotificationTestBtn.classList.remove('pulse-hint');
    void runNotificationTestBtn.offsetWidth;
    runNotificationTestBtn.classList.add('pulse-hint');
    if (pulseAnimClearTimer) clearTimeout(pulseAnimClearTimer);
    pulseAnimClearTimer = setTimeout(() => {
      runNotificationTestBtn.classList.remove('pulse-hint');
      pulseAnimClearTimer = null;
    }, 3200);
  }

  function schedulePulseRunTest(delay = 90) {
    clearTimeout(pulseCoalesceTimer);
    pulseCoalesceTimer = setTimeout(() => {
      pulseCoalesceTimer = null;
      pulseRunTestButton();
    }, delay);
  }

  function clearRunTestPulse() {
    clearTimeout(pulseCoalesceTimer);
    pulseCoalesceTimer = null;
    if (pulseAnimClearTimer) {
      clearTimeout(pulseAnimClearTimer);
      pulseAnimClearTimer = null;
    }
    runNotificationTestBtn?.classList.remove('pulse-hint');
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

  function runChannelPreview(/** @type {('badge'|'desktop_list'|'chime')[]} */ channels, headline) {
    if (testNotifDiv.style.display === 'none' || !channels.length) {
      return;
    }
    chrome.runtime.sendMessage(
      { action: MESSAGE_NAMES.TEST_NOTIFICATION_CHANNELS, channels },
      (res) => {
        if (chrome.runtime.lastError) return;
        if (!res?.ok) {
          showNotificationTestPanel(res?.error || 'Preview failed.', true);
          return;
        }
        if (res.nothing || !res.channelResults?.length) return;
        showNotificationTestPanel(formatNotificationTestResult(res, { headline }), false);
      }
    );
  }

  function showNotificationTestPanel(text, isError) {
    if (!testOutputEl) return;
    testOutputEl.textContent = text;
    testOutputEl.classList.add('visible');
    testOutputEl.classList.toggle('is-error', !!isError);
  }

  function clearNotificationTestPanel() {
    if (!testOutputEl) return;
    testOutputEl.textContent = '';
    testOutputEl.classList.remove('visible', 'is-error');
  }

  if (runNotificationTestBtn) {
    runNotificationTestBtn.onclick = () => {
    clearRunTestPulse();
    clearNotificationTestPanel();
    chrome.runtime.sendMessage(
      { action: MESSAGE_NAMES.TEST_ALL_ALERTS },
      (res) => {
        if (chrome.runtime.lastError) {
          showNotificationTestPanel(
            'Could not run test: ' + chrome.runtime.lastError.message,
            true
          );
          return;
        }
        if (res?.nothing) {
          showNotificationTestPanel(
            res.hint ||
              'Nothing to test. Turn on the toolbar badge, desktop digest, or extension chime.',
            true
          );
          return;
        }
        if (!res?.ok) {
          showNotificationTestPanel(res?.error || 'Test failed.', true);
          return;
        }
        if (res.channelResults?.length) {
          showNotificationTestPanel(formatNotificationTestResult(res), false);
        }
      }
    );
    };
  }

  document.getElementById('show-notification').addEventListener('click', async () => {
    activateOneTabOnly('notification');
    const openTabs = await chrome.tabs.query({});
    updateFilterPartialNoticeBar(openTabs);
  });

  document.getElementById('show-filters').addEventListener('click', async () => {
    activateOneTabOnly('filters');
    const openTabs = await chrome.tabs.query({});
    refreshFilterTabStatus(openTabs);
  });

  document.getElementById('show-advanced').addEventListener('click', () => {
    activateOneTabOnly('advanced');
  });

  noNotifications.addEventListener('click', () => document.getElementById('show-filters').click());
  noMatched.addEventListener('click', () => document.getElementById('show-filters').click());

  tabWorkNoticeEl?.addEventListener('click', () => {
    document.getElementById('show-filters').click();
  });

  filterPartialNoticeEl?.addEventListener('click', () => {
    document.getElementById('show-filters').click();
  });


  const optBadgeEl = document.getElementById('opt-badge');
  const optPopupEl = document.getElementById('opt-popup');
  const badgePreviewEl = document.getElementById('badge-preview');
  const popupPreviewEl = document.getElementById('popup-preview');
  const popupSubEl = document.getElementById('popup-sub');
  const soundSubEl = document.getElementById('sound-sub');
  const warnPersistentEl = document.getElementById('warn-persistent');
  const warnSoundEl = document.getElementById('warn-sound');
  const chimeNotifyModeEl = document.getElementById('chime-notify-mode');
  const chimeSoundEl = document.getElementById('chime-sound');
  const chimeDurationEl = document.getElementById('chime-duration');
  const chimeDurationValEl = document.getElementById('chime-duration-val');
  const chimeVolumeEl = document.getElementById('chime-volume');
  const advTestToggleBadge = document.getElementById('adv-test-toggle-badge');
  const advTestToggleDigest = document.getElementById('adv-test-toggle-digest');
  const advTestToggleChime = document.getElementById('adv-test-toggle-chime');

  function syncAdvTestStripIconButtons() {
    if (advTestToggleBadge && optBadgeEl) {
      advTestToggleBadge.setAttribute('aria-pressed', String(optBadgeEl.checked));
    }
    if (advTestToggleDigest && optPopupEl) {
      advTestToggleDigest.setAttribute('aria-pressed', String(optPopupEl.checked));
    }
    if (advTestToggleChime && warnSoundEl) {
      advTestToggleChime.setAttribute('aria-pressed', String(warnSoundEl.checked));
    }
  }

  /**
   * @param {HTMLInputElement | null} input
   */
  function toggleCheckboxAndEmitChange(input) {
    if (!input) return;
    input.checked = !input.checked;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  advTestToggleBadge?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleCheckboxAndEmitChange(optBadgeEl);
  });
  advTestToggleDigest?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleCheckboxAndEmitChange(optPopupEl);
  });
  advTestToggleChime?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleCheckboxAndEmitChange(warnSoundEl);
  });

  function deriveNotificationMode(badgeOn, popupOn) {
    if (badgeOn && popupOn) return 'both';
    if (badgeOn) return 'badge';
    if (popupOn) return 'popup';
    return 'none';
  }

  function getNotificationModeFromDom() {
    return deriveNotificationMode(!!optBadgeEl?.checked, !!optPopupEl?.checked);
  }

  function syncPopupSubState() {
    const on = !!optPopupEl?.checked;
    if (popupSubEl) popupSubEl.classList.toggle('is-muted', !on);
    if (warnPersistentEl) warnPersistentEl.disabled = !on;
  }

  function syncSoundSubState() {
    const on = !!warnSoundEl?.checked;
    if (soundSubEl) soundSubEl.classList.toggle('is-muted', !on);
    const dis = !on;
    if (chimeNotifyModeEl) chimeNotifyModeEl.disabled = dis;
    if (chimeSoundEl) chimeSoundEl.disabled = dis;
    if (chimeDurationEl) chimeDurationEl.disabled = dis;
    if (chimeVolumeEl) chimeVolumeEl.disabled = dis;
  }

  function updateChimeDurationLabel() {
    if (chimeDurationValEl && chimeDurationEl) {
      chimeDurationValEl.textContent = `${chimeDurationEl.value} ms`;
    }
  }

  async function persistNotificationModeFromToggles() {
    const mode = getNotificationModeFromDom();
    await chrome.storage.local.set({ [STORE_NAMES.NOTIFICATION_MODE]: mode });
    chrome.runtime.sendMessage({ action: MESSAGE_NAMES.UPDATE_BADGE_NOW });
    syncPopupSubState();
    syncSummaryNotificationButton();
    syncAdvTestStripIconButtons();
  }

  function syncSummaryNotificationButton() {
    if (!summaryNotifyButton) return;
    const hasUnread = notificationList.children.length > 0;
    const mode = getNotificationModeFromDom();
    summaryNotifyButton.style.display =
      hasUnread && (mode === 'popup' || mode === 'both') ? 'inline-block' : 'none';
  }

  function readWarningPrefsFromDom() {
    const sid = chimeSoundEl?.value;
    const chimeSoundId = CHIME_SOUND_IDS.includes(sid) ? sid : 'soft';
    const dur = parseInt(chimeDurationEl?.value, 10);
    const chimeDurationMs =
      Number.isFinite(dur) && dur >= 200 && dur <= 1500 ? dur : 500;
    const volPct = parseInt(chimeVolumeEl?.value, 10);
    const chimeVolume =
      Number.isFinite(volPct) && volPct >= 5 && volPct <= 100
        ? volPct / 100
        : 0.85;
    const chimeNotifyMode =
      chimeNotifyModeEl?.value === 'first' ? 'first' : 'every';
    return {
      badge: true,
      desktopPopup: false,
      desktopPersistent: !!warnPersistentEl?.checked,
      desktopSound: !!warnSoundEl?.checked,
      chimeNotifyMode,
      toolbarSummary: true,
      chimeSoundId,
      chimeDurationMs,
      chimeVolume,
    };
  }

  /**
   * @param {{ omitTestButtonPulse?: boolean }} [opts]
   */
  async function saveWarningPrefs(opts = {}) {
    await chrome.storage.local.set({
      [STORE_NAMES.WARNING_PREFS]: readWarningPrefsFromDom(),
    });
    chrome.runtime.sendMessage({ action: MESSAGE_NAMES.UPDATE_BADGE_NOW });
    syncSummaryNotificationButton();
    if (!opts.omitTestButtonPulse) {
      schedulePulseRunTest();
    }
  }

  [warnPersistentEl, chimeNotifyModeEl, chimeSoundEl].forEach((el) => {
    if (el) el.addEventListener('change', saveWarningPrefs);
  });
  [chimeDurationEl, chimeVolumeEl].forEach((el) => {
    if (el) {
      el.addEventListener('input', () => {
        updateChimeDurationLabel();
        saveWarningPrefs();
        schedulePulseRunTest(280);
      });
    }
  });
  if (warnSoundEl) {
    warnSoundEl.addEventListener('change', async () => {
      const turnedOn = warnSoundEl.checked && !prevSoundChecked;
      syncSoundSubState();
      await saveWarningPrefs();
      if (turnedOn) {
        runChannelPreview(
          ['chime'],
          'Quick preview — extension chime (current tone / length / volume):'
        );
      }
      prevSoundChecked = warnSoundEl.checked;
      syncAdvTestStripIconButtons();
    });
  }

  if (optBadgeEl) {
    optBadgeEl.addEventListener('change', async () => {
      const turnedOn = optBadgeEl.checked && !prevBadgeChecked;
      await persistNotificationModeFromToggles();
      if (turnedOn) {
        /* updateBadge() runs on persist and may clear the demo if no unread; delay so actionSetForTest wins */
        window.setTimeout(() => {
          chrome.runtime.sendMessage(
            { action: MESSAGE_NAMES.TEST_NOTIFICATION_CHANNELS, channels: ['badge'] },
            (res) => {
              if (chrome.runtime.lastError) return;
              const ok = !!res?.ok && !res?.nothing;
              const text = ok
                ? 'Badge shown on the pinned toolbar icon — hover it to see the title.'
                : (res?.error || 'Badge preview failed.');
              showCardPreview(badgePreviewEl, text, ok);
            }
          );
        }, 480);
      }
      prevBadgeChecked = optBadgeEl.checked;
      syncAdvTestStripIconButtons();
    });
  }
  if (optPopupEl) {
    optPopupEl.addEventListener('change', async () => {
      const turnedOn = optPopupEl.checked && !prevPopupChecked;
      await persistNotificationModeFromToggles();
      await saveWarningPrefs({ omitTestButtonPulse: true });
      if (turnedOn) {
        chrome.runtime.sendMessage(
          { action: MESSAGE_NAMES.TEST_NOTIFICATION_CHANNELS, channels: ['desktop_list'] },
          (res) => {
            if (chrome.runtime.lastError) return;
            const ok = !!res?.ok && !res?.nothing;
            const text = ok
              ? 'Digest toast sent — check the notification center or Windows taskbar.'
              : (res?.error || 'Digest preview failed.');
            showCardPreview(popupPreviewEl, text, ok);
          }
        );
      }
      prevPopupChecked = optPopupEl.checked;
      syncAdvTestStripIconButtons();
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
      STORE_NAMES.POPUP_THEME,
      STORE_NAMES.REGEX_FILTERS,
      STORE_NAMES.NOTIFIED_BY_HOST,
      STORE_NAMES.NOTIFICATION_MODE,
      STORE_NAMES.WARNING_PREFS,
      STORE_NAMES.BADGE_COLOR_SCHEME,
    ]),
    chrome.tabs.query({}),
  ]);

  applyPopupThemeFromStorageValue(stored[STORE_NAMES.POPUP_THEME]);

  const regexFilters = stored[STORE_NAMES.REGEX_FILTERS] || [];
  /** Kept in sync for storage listener + re-renders */
  let cachedRegexFilters = regexFilters;
  const notifiedByHost = stored[STORE_NAMES.NOTIFIED_BY_HOST] || {};
  const rawStoredMode = stored[STORE_NAMES.NOTIFICATION_MODE];
  const notificationMode =
    rawStoredMode === 'badge' ||
    rawStoredMode === 'popup' ||
    rawStoredMode === 'both' ||
    rawStoredMode === 'none'
      ? rawStoredMode
      : 'badge';
  const warningPrefs = { ...DEFAULT_WARNING_PREFS, ...(stored[STORE_NAMES.WARNING_PREFS] || {}) };

  warnPersistentEl.checked = warningPrefs.desktopPersistent !== false;
  warnSoundEl.checked = warningPrefs.desktopSound !== false;
  if (chimeNotifyModeEl) {
    chimeNotifyModeEl.value =
      warningPrefs.chimeNotifyMode === 'first' ? 'first' : 'every';
  }
  if (chimeSoundEl) {
    const sid = CHIME_SOUND_IDS.includes(warningPrefs.chimeSoundId)
      ? warningPrefs.chimeSoundId
      : 'soft';
    chimeSoundEl.value = sid;
  }
  if (chimeDurationEl) {
    const d = parseInt(warningPrefs.chimeDurationMs, 10);
    chimeDurationEl.value = String(
      Number.isFinite(d) && d >= 200 && d <= 1500 ? d : 500
    );
  }
  if (chimeVolumeEl) {
    const v = Number(warningPrefs.chimeVolume);
    const pct = Number.isFinite(v) ? Math.round(v * 100) : 85;
    chimeVolumeEl.value = String(Math.min(100, Math.max(5, pct)));
  }
  updateChimeDurationLabel();

  const badgeOn = notificationMode === 'badge' || notificationMode === 'both';
  const popupOn = notificationMode === 'popup' || notificationMode === 'both';
  if (optBadgeEl) optBadgeEl.checked = badgeOn;
  if (optPopupEl) optPopupEl.checked = popupOn;
  syncPopupSubState();
  syncSoundSubState();

  prevBadgeChecked = !!optBadgeEl?.checked;
  prevPopupChecked = !!optPopupEl?.checked;
  prevSoundChecked = !!warnSoundEl?.checked;
  syncAdvTestStripIconButtons();

  function highlightRegexMatches(text, regexPattern) {
    try {
      const regex = new RegExp(regexPattern, 'gi');
      return text.replace(regex, match => `<u><span class="match-highlight">${match}</span></u>`);
    } catch (e) {
      console.warn('Invalid regex:', regexPattern);
      return text;
    }
  }

  function pickBestTab(tabObjs) {
    if (!tabObjs.length) return null;
    return [...tabObjs].sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
  }

  /**
   * Refresh unread + matched lists when storage/tabs change without rebuilding Filters UI.
   * @param {Record<string, { since: number, tabIds: number[] }>} notifiedByHostMap
   * @param {Array<{ pattern: string, type: string }>} regexFiltersForMatch
   * @param {chrome.tabs.Tab[]} openTabs
   */
  function renderUnreadAndMatchedViews(notifiedByHostMap, regexFiltersForMatch, openTabs) {
    notificationList.replaceChildren();
    matchedList.replaceChildren();

    const notifiedTabIdSet = new Set();
    Object.values(notifiedByHostMap).forEach((entry) => {
      (entry.tabIds || []).forEach((id) => notifiedTabIdSet.add(id));
    });

    let foundNotification = false;
    let foundMatch = false;
    let matchedTabsQuantity = 0;
    const now = Date.now();

    for (const host of Object.keys(notifiedByHostMap)) {
      const entry = notifiedByHostMap[host];
      const tabObjs = (entry.tabIds || [])
        .map((id) => openTabs.find((t) => t.id === id))
        .filter(Boolean);
      const best = pickBestTab(tabObjs);
      const sampleTab = best || tabObjs[0];
      if (!sampleTab) continue;

      const matchedFilters = regexFiltersForMatch.filter((rule) => {
        const regex = new RegExp(rule.pattern, 'i');
        if (rule.type === 'url') return regex.test(sampleTab.url);
        if (rule.type === 'title') return regex.test(sampleTab.title);
        return false;
      });
      const matchesSomeFilter = matchedFilters.length > 0 ? matchedFilters[0] : { pattern: '.*' };

      const notificationItem = document.createElement('li');
      const favicon = faviconImgHtml(sampleTab);
      const tabCount = tabObjs.length;
      const tabNote = tabCount > 1 ? ` <small>(${tabCount} tabs)</small>` : '';
      notificationItem.innerHTML = `<div class="notification-item-stack"><div class="notification-item-line--host">${favicon} <span class="match-highlight-title">${host}</span>${tabNote}</div><div class="notification-item-line--meta"><span>${sampleTab.title || '(no title)'}</span> (<i>${UTILS.getTimeAsHuman(now - entry.since)}</i>)</div><div class="notification-item-line--url"><small>${highlightRegexMatches(sampleTab.url, matchesSomeFilter.pattern)}</small></div></div>`;
      notificationItem.style.cursor = 'pointer';
      notificationItem.tabIndex = 0;
      notificationItem.onclick = () => {
        if (!best) return;
        chrome.tabs.update(best.id, { active: true });
        chrome.windows.update(best.windowId, { focused: true });
      };
      notificationList.appendChild(notificationItem);
      foundNotification = true;
    }

    openTabs.forEach((tab) => {
      const matchedFilters = regexFiltersForMatch.filter((rule) => {
        const regex = new RegExp(rule.pattern, 'i');
        if (rule.type === 'url') return regex.test(tab.url);
        if (rule.type === 'title') return regex.test(tab.title);
        return false;
      });

      const matchesSomeFilter = matchedFilters.length > 0 ? matchedFilters[0] : null;
      const isNotified = notifiedTabIdSet.has(tab.id);

      if (!isNotified && !matchesSomeFilter) return;

      matchedTabsQuantity++;

      if (!isNotified && matchesSomeFilter) {
        const matchedItem = document.createElement('li');
        const favicon = faviconImgHtml(tab);
        matchedItem.innerHTML = `<div class="matched-item-stack"><div class="matched-item-line--title">${favicon} ${tab.title}</div><div class="matched-item-line--url"><small>${highlightRegexMatches(tab.url, matchesSomeFilter.pattern)}</small></div></div>`;
        matchedItem.style.opacity = 0.8;
        matchedItem.style.cursor = 'pointer';
        matchedItem.tabIndex = 0;
        matchedItem.onclick = () => {
          chrome.tabs.update(tab.id, { active: true });
          chrome.windows.update(tab.windowId, { focused: true });
        };
        matchedList.appendChild(matchedItem);
        foundMatch = true;
      }
    });

    if (tabWorkNoticeEl) {
      const hasFilters = regexFiltersForMatch.length > 0;
      const anyOpenMatch =
        hasFilters && openTabs.some((t) => tabMatchesFilters(t, regexFiltersForMatch));
      if (hasFilters && !anyOpenMatch) {
        tabWorkNoticeEl.textContent =
          'We only watch open tabs: each tab’s URL and title is checked against your filters, so the page must stay open for new activity to show up. No tab matches yet — open the site, then tap here for Filters (counts per rule, ↗ to open a URL).';
        tabWorkNoticeEl.classList.add('tab-work-notice--visible');
      } else {
        tabWorkNoticeEl.textContent = '';
        tabWorkNoticeEl.classList.remove('tab-work-notice--visible');
      }
    }

    const mtq = document.getElementById('matched-title-quantity');
    if (mtq) mtq.textContent = ` (${matchedTabsQuantity})`;

    const hasOpenTabMatchingFilters =
      regexFiltersForMatch.length > 0 &&
      openTabs.some((t) => tabMatchesFilters(t, regexFiltersForMatch));

    notificationsTitle.style.display = foundNotification ? 'block' : 'none';
    noNotifications.style.display =
      foundNotification || hasOpenTabMatchingFilters ? 'none' : 'block';
    clearBadgeButton.style.display = foundNotification ? 'inline-block' : 'none';
    syncSummaryNotificationButton();

    if (matchedTitle) {
      matchedTitle.style.display = foundMatch ? 'block' : 'none';
    }
    noMatched.style.display = foundMatch ? 'none' : 'block';
  }

  renderUnreadAndMatchedViews(notifiedByHost, cachedRegexFilters, tabs);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STORE_NAMES.NOTIFIED_BY_HOST]) return;
    const raw = changes[STORE_NAMES.NOTIFIED_BY_HOST].newValue;
    const next = raw && typeof raw === 'object' ? raw : {};
    chrome.tabs.query({}, (openTabs) => {
      renderUnreadAndMatchedViews(next, cachedRegexFilters, openTabs);
      updateFilterPartialNoticeBar(openTabs);
    });
  });

  [addRegexButton, saveRegexButton, clearBadgeButton, summaryNotifyButton].forEach((button) => {
    if (!button) return;
    button.style.cursor = 'pointer';
  });

  regexFilters.forEach((rule) => {
    const alreadyExists = DEFAULT_SUGGESTIONS.some(s => rule.pattern === s.pattern);
    if (!alreadyExists) createRegexRow(rule);
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
      createRegexRow(s);
      btn.remove();
      setTimeout(saveRegexRules, 100);
    };
    suggestionContainer.appendChild(btn);

    const alreadyExists = regexFilters.some(rule => rule.pattern === s.pattern);
    if (alreadyExists) {
      btn.click();
    }
  });

  regexList.parentNode.insertBefore(suggestionTitle, addRegexButton);
  regexList.parentNode.insertBefore(suggestionContainer, addRegexButton);

  function createRegexRow(prefill = {
    pattern: '',
    type: 'url',
    onRemove: null,
    editable: true
  }) {
    const container = document.createElement('div');
    container.className = 'regex-row';

    const pattern = document.createElement('input');
    pattern.type = 'text';
    pattern.placeholder = 'Regex pattern';
    pattern.value = prefill.pattern;
    pattern.title = 'Padrão regex';
    pattern.addEventListener('input', () => {
      saveRegexRules();
      scheduleRefreshFilterTabStatus();
    });

    const type = document.createElement('select');
    ['url', 'title'].forEach(opt => {
      const option = document.createElement('option');
      option.value = opt;
      option.text = opt;
      type.appendChild(option);
    });
    if (!prefill.editable) {
      type.disabled = true;
      pattern.disabled = true;
      pattern.readOnly = true;
    }
    type.classList.add('nodisplay');
    type.value = prefill.type;
    type.title = 'Tipo de regra';
    type.addEventListener('change', () => {
      saveRegexRules();
      scheduleRefreshFilterTabStatus();
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
      closeAllRegexOpenPanels();
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
      if (prefill.onRemove) prefill.onRemove();
      container.remove();
      saveRegexRules();
      scheduleRefreshFilterTabStatus();
    };

    container.appendChild(pattern);
    container.appendChild(type);
    container.appendChild(statusSpan);
    container.appendChild(helpBtn);
    container.appendChild(removeBtn);
    container.appendChild(panel);
    regexList.appendChild(container);
  }

  createRegexRow();

  refreshFilterTabStatus(tabs);

  async function saveRegexRules() {
    const containers = regexList.querySelectorAll('.regex-row');
    const newFilters = [];
    containers.forEach(c => {
      const pattern = c.querySelector('input[type="text"]')?.value.trim() ?? '';
      const type = c.querySelector('select')?.value ?? 'url';
      if (pattern) {
        try {
          new RegExp(pattern);
          newFilters.push({ pattern, type });
        } catch (e) {
          console.warn(`Regex inválido ignorado: ${pattern}`);
        }
      }
    });
    await chrome.storage.local.set({ [STORE_NAMES.REGEX_FILTERS]: newFilters });
    cachedRegexFilters = newFilters;
    const nbStore = await chrome.storage.local.get(STORE_NAMES.NOTIFIED_BY_HOST);
    const nb = nbStore[STORE_NAMES.NOTIFIED_BY_HOST] || {};
    const tabsFresh = await chrome.tabs.query({});
    renderUnreadAndMatchedViews(nb, newFilters, tabsFresh);
    refreshFilterTabStatus(tabsFresh);
    saveMessage.style.display = 'block';
    saveMessage.style.opacity = 1;
    saveMessage.style.transition = '';
    setTimeout(() => {
      saveMessage.style.transition = 'opacity 0.5s';
      saveMessage.style.opacity = 0;
      setTimeout(() => {
        saveMessage.style.display = 'none';
        saveMessage.style.opacity = 1;
        saveMessage.style.transition = '';
      }, 500);
    }, 2000);
  }

  addRegexButton.addEventListener('click', () => {
    createRegexRow();
    scheduleRefreshFilterTabStatus();
  });

  clearBadgeButton.addEventListener('click', async () => {
    await chrome.storage.local.set({ [STORE_NAMES.NOTIFIED_BY_HOST]: {} });
    chrome.runtime.sendMessage({ action: MESSAGE_NAMES.UPDATE_BADGE_NOW });
    const tabsAfter = await chrome.tabs.query({});
    renderUnreadAndMatchedViews({}, cachedRegexFilters, tabsAfter);
    clearMessage.style.display = 'block';
    setTimeout(() => clearMessage.style.display = 'none', 2000);
  });

  summaryNotifyButton.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: MESSAGE_NAMES.SHOW_DESKTOP_SUMMARY });
  });

  const colorSchemaDiv = document.getElementById('badge-color-schema');
  const schemeList = stored[STORE_NAMES.BADGE_COLOR_SCHEME];
  const colorItems = [];
  if (Array.isArray(schemeList)) {
    schemeList.forEach((colorItem) => {
      const colorSchemaItem = document.createElement('li');
      colorSchemaItem.innerHTML = `After <input type="number" name="number" value="${colorItem.threshold}" style="width:3rem;"/> minutes <input type="color" name="color" value="${colorItem.color}"/> `;
      colorSchemaDiv.appendChild(colorSchemaItem);
      colorItems.push(colorSchemaItem);
    });
  }
  if (colorItems.length > 0) {
    colorItems[0].querySelector('input[type="number"]').disabled = true;
    colorItems[colorItems.length - 1].querySelector('input[type="number"]').disabled = true;
  }

  const handleChange = debounce(async function handleChange(event) {
    const newColorScheme = Array.from(colorSchemaDiv.querySelectorAll("li")).map((colorItem) => {
      return {threshold: parseInt(colorItem.querySelector('input[type="number"]').value), color: colorItem.querySelector('input[type="color"]').value };
    });
    await chrome.storage.local.set({ [STORE_NAMES.BADGE_COLOR_SCHEME]: newColorScheme });
    chrome.runtime.sendMessage({ action: MESSAGE_NAMES.UPDATE_BADGE_NOW });
  }, 500);
  colorSchemaDiv.addEventListener('input', handleChange);
  colorSchemaDiv.addEventListener('change', handleChange);
});

function debounce(func, delay) {
  let timeoutId;

  return function (...args) {
    const context = this;

    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      func.apply(context, args);
    }, delay);
  };
}

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
