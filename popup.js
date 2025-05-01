import { DEFAULT_SUGGESTIONS } from './suggestions.js';
import * as UTILS from "./utils.js";
import { MESSAGE_NAMES, STORE_NAMES } from "./utils.js";

// === popup.js ===
document.addEventListener('DOMContentLoaded', async () => {
  const notificationList = document.getElementById('notification-list');
  const matchedList = document.getElementById('matched-list');
  const regexList = document.getElementById('regex-list');

  const notificationsTitle = document.getElementById('notifications-title');
  const matchedTitle = document.getElementById('matched-title');
  const clearBadgeButton = document.getElementById('clear-badge');
  const noNotifications = document.getElementById('no-notifications');
  const noMatched = document.getElementById('no-matched');
  const clearMessage = document.getElementById('clear-message');
  const saveMessage = document.getElementById('save-message');

  const notificationSection = document.getElementById('notification-section');
  const filtersSection = document.getElementById('filters-section');

  const addRegexButton = document.getElementById('add-regex');
  const saveRegexButton = document.getElementById('save-regex');

  const testNotifDiv = document.getElementById('test-notif-tip');

  const storedDismiss = await chrome.storage.local.get(STORE_NAMES.HIDE_NOTIFICATION_TEST);
  if (storedDismiss[STORE_NAMES.HIDE_NOTIFICATION_TEST]) {
    testNotifDiv.style.display = 'none';
  }

  document.getElementById('run-notification-test').onclick = () => {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: 'Notification test',
      message: 'If you saw this message the notifications are enabled.',
      priority: 2
    }, () => {
      if (chrome.runtime.lastError) {
        alert('Error on showing the notification. Please check the system permissions.');
      }
    });
  };

  document.getElementById('dismiss-notification-test').onclick = async () => {
    testNotifDiv.style.display = 'none';
    await chrome.storage.local.set({ [STORE_NAMES.HIDE_NOTIFICATION_TEST]: true });
  };

  document.getElementById('show-notification').addEventListener('click', () => {
    activateOneTabOnly('notification');
    document.getElementById('show-notification').classList.add('active');
    document.getElementById('show-filters').classList.remove('active');
  });

  document.getElementById('show-filters').addEventListener('click', () => {
    activateOneTabOnly('filters');
    document.getElementById('show-filters').classList.add('active');
    document.getElementById('show-notification').classList.remove('active');
  });

  document.getElementById('show-advanced').addEventListener('click', () => {
    activateOneTabOnly('advanced');
  });

  noNotifications.addEventListener('click', () => document.getElementById('show-filters').click());
  noMatched.addEventListener('click', () => document.getElementById('show-filters').click());


  document.querySelectorAll('input[name="notification-type"]').forEach(radio => {
    radio.addEventListener('change', async () => {
      const selectedValue = document.querySelector('input[name="notification-type"]:checked').value;
      await chrome.storage.local.set({ [STORE_NAMES.NOTIFICATION_MODE]: selectedValue });
    });
  });

  document.querySelector('div.notification-options').addEventListener('change', async (event) => {
    await chrome.storage.local.set({ [STORE_NAMES.NOTIFICATION_MODE]: event.target.value });
    chrome.runtime.sendMessage({ action: MESSAGE_NAMES.UPDATE_BADGE_NOW });
  });

  const stored = await chrome.storage.local.get([STORE_NAMES.REGEX_FILTERS, STORE_NAMES.NOTIFIED_TABS, STORE_NAMES.NOTIFICATION_MODE]);
  const regexFilters = stored[STORE_NAMES.REGEX_FILTERS] || [];
  const notifiedTabs = stored[STORE_NAMES.NOTIFIED_TABS] || {};
  const notificationMode = stored[STORE_NAMES.NOTIFICATION_MODE] || 'badge';

  document.querySelectorAll('input[name="notification-type"]').forEach(radio => {
    radio.checked = radio.value === notificationMode;
  });

  notificationList.innerHTML = '';
  matchedList.innerHTML = '';

  const tabs = await chrome.tabs.query({});
  let foundNotification = false;
  let foundMatch = false;

  function highlightRegexMatches(text, regexPattern) {
    try {
      const regex = new RegExp(regexPattern, 'gi');
      return text.replace(regex, match => `<u><span class="match-highlight">${match}</span></u>`);
    } catch (e) {
      console.warn('Invalid regex:', regexPattern);
      return text;
    }
  }

  let matchedTabsQuantity = 0;
  tabs.forEach(tab => {
    const matchedFilters = regexFilters.filter(rule => {
      const regex = new RegExp(rule.pattern, 'i');
      if (rule.type === 'url') return regex.test(tab.url);
      if (rule.type === 'title') return regex.test(tab.title);
      return false;
    });

    const matchesSomeFilter = matchedFilters.length > 0 ? matchedFilters[0] : null;
    const tabWithNotification = notifiedTabs[tab.id];

    if (!tabWithNotification && !matchesSomeFilter) return;

    matchedTabsQuantity++;

    if (tabWithNotification) {
      const notificationItem = document.createElement('li');
      const favicon = tab.favIconUrl ? `<img src="${tab.favIconUrl}" alt="favicon" style="width:16px;height:16px;vertical-align:middle;margin-right:5px;border-radius:50%;">` : '';
      notificationItem.innerHTML = `${favicon} <span class="match-highlight-title">${tab.title}</span> (${UTILS.getTimeAsHuman(tabWithNotification)})<br><small>${highlightRegexMatches(tab.url, matchesSomeFilter.pattern)}</small>`;
      notificationItem.style.cursor = 'pointer';
      notificationItem.tabIndex = 0;
      notificationItem.onclick = () => {
        chrome.tabs.update(tab.id, { active: true });
        chrome.windows.update(tab.windowId, { focused: true });
      };
      notificationList.appendChild(notificationItem);
      foundNotification = true;
    } else if (matchesSomeFilter) {
      const matchedItem = document.createElement('li');
      const favicon = tab.favIconUrl ? `<img src="${tab.favIconUrl}" alt="favicon" style="width:16px;height:16px;vertical-align:middle;margin-right:5px;border-radius:50%;">` : '';
      matchedItem.innerHTML = `${favicon} ${tab.title}<br><small>${highlightRegexMatches(tab.url, matchesSomeFilter.pattern)}</small>`;
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

  document.getElementById('matched-title-quantity').innerHTML = ` (${matchedTabsQuantity})`;

  notificationsTitle.style.display = foundNotification ? 'block' : 'none';
  noNotifications.style.display = foundNotification ? 'none' : 'block';
  clearBadgeButton.style.display = foundNotification ? 'inline-block' : 'none';

  matchedTitle.style.display = foundMatch ? 'block' : 'none';
  noMatched.style.display = foundMatch ? 'none' : 'block';

  [addRegexButton, saveRegexButton, clearBadgeButton].forEach(button => {
    button.style.transition = 'background-color 0.3s, transform 0.2s';
    button.style.cursor = 'pointer';
    button.addEventListener('mouseenter', () => {
      button.style.backgroundColor = '#d0d0d0';
      button.style.transform = 'scale(1.02)';
    });
    button.addEventListener('mouseleave', () => {
      button.style.backgroundColor = '';
      button.style.transform = 'scale(1)';
    });
  });

  regexFilters.forEach((rule) => {
    const alreadyExists = DEFAULT_SUGGESTIONS.some(s => rule.pattern === s.pattern);
    if (!alreadyExists) createRegexRow(rule);
  });

  const suggestionTitle = document.createElement('h4');
  suggestionTitle.textContent = 'Quick Suggestions:';
  suggestionTitle.style.marginTop = '20px';

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
    pattern.addEventListener('input', saveRegexRules);

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
      pattern.readonly = true;
    }
    type.classList.add('nodisplay');
    type.value = prefill.type;
    type.title = 'Tipo de regra';
    type.addEventListener('change', saveRegexRules);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '🗑️';
    removeBtn.title = 'Remover filtro';
    removeBtn.onclick = () => {
      if (prefill.onRemove) prefill.onRemove();
      container.remove();
      saveRegexRules();
    };

    container.appendChild(pattern);
    container.appendChild(type);
    container.appendChild(removeBtn);
    regexList.appendChild(container);
  }

  createRegexRow();

  async function saveRegexRules() {
    const containers = regexList.querySelectorAll('div');
    const newFilters = [];
    containers.forEach(c => {
      const pattern = c.querySelector('input').value.trim();
      const type = c.querySelector('select').value;
      if (pattern) {
        try {
          new RegExp(pattern);
          newFilters.push({ pattern, type });
        } catch (e) {
          console.warn(`Regex inválido ignorado: ${pattern}`);
        }
      }
    });
    await chrome.storage.local.set({ [STORE_NAMES.REGEX_FILTERS]: newFilters});
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
  });

  clearBadgeButton.addEventListener('click', async () => {
    await chrome.storage.local.set({ [STORE_NAMES.NOTIFIED_TABS]: {} });
    chrome.action.setBadgeText({text: ''});
    notificationList.innerHTML = '';
    notificationsTitle.style.display = 'none';
    noNotifications.style.display = 'block';
    clearBadgeButton.style.display = 'none';
    clearMessage.style.display = 'block';
    setTimeout(() => clearMessage.style.display = 'none', 2000);
  });

  const colorSchemaDiv = document.getElementById('badge-color-schema');
  const storedScheme = await chrome.storage.local.get(STORE_NAMES.BADGE_COLOR_SCHEME);
  const colorItems = [];
  storedScheme[STORE_NAMES.BADGE_COLOR_SCHEME].forEach((colorItem) => {
    const colorSchemaItem = document.createElement('li');
    colorSchemaItem.innerHTML = `After <input type="number" name="number" value="${colorItem.threshold}" style="width:3rem;"/> minutes <input type="color" name="color" value="${colorItem.color}"/> `;
    colorSchemaDiv.appendChild(colorSchemaItem);
    colorItems.push(colorSchemaItem);
  });
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

function activateOneTabOnly(tabName) {
  Array.from(document.querySelectorAll('button.tab.active')).forEach((button) => {
    button.classList.remove('active');
  });

  Array.from(document.querySelectorAll('div.section.active')).forEach((div) => {
    div.classList.remove('active');
  });

  document.querySelector('button.tab.' + tabName).classList.add('active');
  document.querySelector('div.section.' + tabName).classList.add('active');
}
