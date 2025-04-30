import { DEFAULT_SUGGESTIONS } from './suggestions.js';

// === background.js ===
let lastTitles = {};
let regexRules = [];

chrome.runtime.onInstalled.addListener(async () => {
  // Carrega regras existentes
  const stored = await chrome.storage.local.get('regexFilters');
  let regexFilters = stored.regexFilters || [];

  // Adiciona apenas se ainda não estiverem presentes
  DEFAULT_SUGGESTIONS.forEach(s => {
    const exists = regexFilters.some(r => r.pattern === s.pattern && r.type === s.type);
    if (!exists) regexFilters.push(s);
  });

  await chrome.storage.local.set({ regexFilters });
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return; // Nenhuma janela com foco

  const tabs = await chrome.tabs.query({ active: true, windowId });
  const tab = tabs[0];
  if (!tab) return;

  const notifiedTabs = await getNotifiedTabs();
  if (notifiedTabs[tab.id]) {
    delete notifiedTabs[tab.id];
    await chrome.storage.local.set({ notifiedTabs });
    updateBadge(notifiedTabs);
  }
});


// Utilities
async function getRegexRules() {
  const stored = await chrome.storage.local.get('regexFilters');
  return (stored.regexFilters || []).map(r => ({
    pattern: new RegExp(r.pattern, 'i'),
    type: r.type
  }));
}

async function getNotifiedTabs() {
  const stored = await chrome.storage.local.get('notifiedTabs');
  return stored.notifiedTabs || {};
}

async function updateBadge(notifiedTabs) {
  const count = Object.keys(notifiedTabs).length;
  chrome.action.setBadgeText({ text: count > 0 ? count.toString() : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#ff0000' });
}

// Load regex rules on install
chrome.runtime.onInstalled.addListener(async () => {
  regexRules = await getRegexRules();
});

// Update regex rules on change
chrome.storage.onChanged.addListener((changes) => {
  if (changes.regexFilters) {
    regexRules = changes.regexFilters.newValue.map(r => ({
      pattern: new RegExp(r.pattern, 'i'),
      type: r.type
    }));
  }
});

// Handle title changes
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.title && !tab.url) return;

  const newTitle = changeInfo.title || tab.title;
  const lastTitle = lastTitles[tabId];
  lastTitles[tabId] = newTitle;

  if (newTitle !== lastTitle) {
    try {
      const [tabInfo, windowInfo] = await Promise.all([
        chrome.tabs.get(tabId),
        chrome.windows.getLastFocused({ populate: false })
      ]);

      if (tabInfo.active && tabInfo.windowId === windowInfo.id && windowInfo.focused) {
        return; // Ignore if tab is active in focused window
      }

      const matchesRegex = regexRules.some(rule => {
        if (rule.type === 'url') {
          return rule.pattern.test(tab.url);
        } else if (rule.type === 'title') {
          return rule.pattern.test(newTitle);
        }
        return false;
      });

      if (!matchesRegex) {
        return; // Ignore if no regex matches
      }

      const notifiedTabs = await getNotifiedTabs();
      notifiedTabs[tabId] = true;
      await chrome.storage.local.set({ notifiedTabs });
      updateBadge(notifiedTabs);

    } catch (error) {
      console.warn(`Tab ${tabId} or window not accessible while checking title.`, error);
    }
  }
});

// Handle tab closed
chrome.tabs.onRemoved.addListener(async (tabId) => {
  delete lastTitles[tabId];
  const notifiedTabs = await getNotifiedTabs();
  if (notifiedTabs[tabId]) {
    delete notifiedTabs[tabId];
    await chrome.storage.local.set({ notifiedTabs });
    updateBadge(notifiedTabs);
  }
});

// Handle tab focused
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const notifiedTabs = await getNotifiedTabs();

  if (notifiedTabs[tabId]) {
    try {
      await chrome.tabs.get(tabId);
      delete notifiedTabs[tabId];
      await chrome.storage.local.set({ notifiedTabs });
      updateBadge(notifiedTabs);
    } catch (error) {
      console.warn(`Tab ${tabId} no longer exists during activation.`, error);
    }
  }
});

// Handle clicking extension icon (show unread tabs)
chrome.action.onClicked.addListener(async () => {
  const notifiedTabs = await getNotifiedTabs();
  const tabIds = Object.keys(notifiedTabs).map(id => parseInt(id, 10));

  if (tabIds.length === 0) return;

  const allTabs = await chrome.tabs.query({});
  const messages = allTabs
    .filter(tab => tabIds.includes(tab.id))
    .map(tab => `• ${tab.title}`);

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
});
