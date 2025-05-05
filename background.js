import {DEFAULT_BADGE_COLORS, DEFAULT_SUGGESTIONS} from './suggestions.js';
import * as UTILS from "./utils.js";
import { MESSAGE_NAMES, STORE_NAMES } from "./utils.js";

// === background.js ===
let lastTitles = {};
let regexRules = [];
let timeoutId = null;

chrome.runtime.onInstalled.addListener(async () => {
  setUpdateTimeInterval();
  await onReload();
  onReload = () => {};
});


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === MESSAGE_NAMES.UPDATE_BADGE_NOW) {
    updateBadge(); // or pass notifiedTabs if needed
  }
});

chrome.windows.onFocusChanged.addListener(async function clearNotificationFromFocusedWindow(windowId){
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;

  const tabs = await chrome.tabs.query({ active: true, windowId });
  const tab = tabs[0];
  if (!tab) return;

  await clearNotification(tab.id);
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.regexFilters) {
    regexRules = changes.regexFilters.newValue.map(r => ({
      pattern: new RegExp(r.pattern, 'i'),
      type: r.type
    }));
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.title && !tab.url) return;

  const newTitle = changeInfo.title || tab.title;
  const lastTitle = lastTitles[tabId];
  lastTitles[tabId] = newTitle;

  if (newTitle === lastTitle) return;

  try {
    const [tabInfo, windowInfo] = await Promise.all([
      chrome.tabs.get(tabId),
      chrome.windows.getLastFocused({ populate: false })
    ]);

    if (tabInfo.active && tabInfo.windowId === windowInfo.id && windowInfo.focused) return;

    const matchesRegex = regexRules.some(rule => {
      if (rule.type === 'url') return rule.pattern.test(tab.url);
      if (rule.type === 'title') return rule.pattern.test(newTitle);
      return false;
    });

    if (!matchesRegex) return;

    const notifiedTabs = await getNotifiedTabs();
    const isTabNotified = notifiedTabs[tabId] !== undefined;
    notifiedTabs[tabId] = isTabNotified ? notifiedTabs[tabId] : Date.now();
    await chrome.storage.local.set({ [STORE_NAMES.NOTIFIED_TABS]: notifiedTabs });
    updateBadge(notifiedTabs);

    const mode = await getNotificationMode();
    if (!isTabNotified && (mode === 'popup' || mode === 'both')) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: 'New notification',
        message: `${tab.title}`,
        priority: 1
      }, () => {
        if (chrome.runtime.lastError) {
          console.error('Error creating the notification:', chrome.runtime.lastError);
        }
      });
    }
  } catch (error) {
    console.warn(`Error processing tab atualization ${tabId}:`, error);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  delete lastTitles[tabId];

  await clearNotification(tabId);
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await clearNotification(tabId);
});

chrome.action.onClicked.addListener(async () => {
  const notifiedTabs = await getNotifiedTabs();
  const tabIds = Object.keys(notifiedTabs).map(id => parseInt(id, 10));
  if (tabIds.length === 0) return;

  const allTabs = await chrome.tabs.query({});
  const messages = allTabs.filter(tab => tabIds.includes(tab.id)).map(tab => `• ${tab.title}`);

  const mode = await getNotificationMode();
  if (mode === 'popup' || mode === 'both') {
    chrome.notifications.create({
      type: 'list',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: 'Tabs with Unread Notifications',
      message: 'You have unread notifications:',
      items: messages.slice(0, 5).map(m => ({ title: m, message: '' })),
      priority: 2
    }, () => {
      if (chrome.runtime.lastError) {
        console.error('Notification error:', chrome.runtime.lastError);
      }
    });
  }
});

async function setDefaultColorSchema() {
    const stored = await chrome.storage.local.get(STORE_NAMES.BADGE_COLOR_SCHEME);

  if (stored[STORE_NAMES.BADGE_COLOR_SCHEME] === undefined) {
    await chrome.storage.local.set({ [STORE_NAMES.BADGE_COLOR_SCHEME]: DEFAULT_BADGE_COLORS });
  }
}

async function initRegexFilters() {
  const loadExistingRules = await chrome.storage.local.get(STORE_NAMES.REGEX_FILTERS);
  let regexFilters = loadExistingRules[STORE_NAMES.REGEX_FILTERS] || [];

  DEFAULT_SUGGESTIONS.forEach(s => {
    const exists = regexFilters.some(r => r.pattern === s.pattern && r.type === s.type);
    if (!exists) regexFilters.push(s);
  });

  await chrome.storage.local.set({ [STORE_NAMES.REGEX_FILTERS]: regexFilters });
  return await getRegexRules();
}

async function setUpdateTimeInterval() {
  clearInterval(timeoutId);
  updateBadge();
  timeoutId = setInterval(async () => {
    updateBadge();
  }, 60000); // atualiza a cada 60 segundos
}

// Utilities
async function getRegexRules() {
  const stored = await chrome.storage.local.get(STORE_NAMES.REGEX_FILTERS);
  return (stored[STORE_NAMES.REGEX_FILTERS] || []).map(r => ({
    pattern: new RegExp(r.pattern, 'i'),
    type: r.type
  }));
}

async function getNotifiedTabs() {
  const stored = await chrome.storage.local.get(STORE_NAMES.NOTIFIED_TABS);
  return stored[STORE_NAMES.NOTIFIED_TABS] || {};
}

async function clearNotification(tabId) {
  const notifiedTabs = await getNotifiedTabs();
  if (notifiedTabs[tabId]) {
    delete notifiedTabs[tabId];
    await chrome.storage.local.set({ [STORE_NAMES.NOTIFIED_TABS]: notifiedTabs });
    await updateBadge(notifiedTabs);
  }
}


async function updateBadge(notifiedTabs) {
  notifiedTabs = notifiedTabs || await getNotifiedTabs();
  const now = Date.now();
  const tabIds = Object.keys(notifiedTabs);
  if (tabIds.length === 0 || ((await getNotificationMode() !== 'both') && (await getNotificationMode() !== 'badge'))) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }

  const times = tabIds.map(id => now - notifiedTabs[id]);
  const oldest = Math.max(...times);

  const timeAsHuman = UTILS.getTimeAsHuman(oldest);
  const messageMinutes = UTILS.getTimeInMinutes(oldest);

  const stored = await chrome.storage.local.get(STORE_NAMES.BADGE_COLOR_SCHEME);
  const scheme = stored[STORE_NAMES.BADGE_COLOR_SCHEME] || DEFAULT_BADGE_COLORS;
  const selectedColor = scheme.findLast(s => s.threshold <= messageMinutes)?.color || 'red';

  chrome.action.setBadgeText({ text: timeAsHuman });
  chrome.action.setBadgeBackgroundColor({ color: selectedColor });
}

async function getNotificationMode() {
  const stored = await chrome.storage.local.get(STORE_NAMES.NOTIFICATION_MODE);
  return stored[STORE_NAMES.NOTIFICATION_MODE] || 'badge';
}

async function onReload() {
  await setDefaultColorSchema();
  regexRules = await initRegexFilters();
  await setUpdateTimeInterval();
}

onReload();
