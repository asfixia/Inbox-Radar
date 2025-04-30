import { DEFAULT_SUGGESTIONS } from './suggestions.js';
// === popup.js ===

document.addEventListener('DOMContentLoaded', async () => {
  const unreadList = document.getElementById('unread-list');
  const matchedList = document.getElementById('matched-list');
  const regexList = document.getElementById('regex-list');

  const notificationsTitle = document.getElementById('notifications-title');
  const matchedTitle = document.getElementById('matched-title');
  const clearBadgeButton = document.getElementById('clear-badge');
  const noNotifications = document.getElementById('no-notifications');
  const noMatched = document.getElementById('no-matched');
  const clearMessage = document.getElementById('clear-message');
  const saveMessage = document.getElementById('save-message');

  const unreadSection = document.getElementById('unread-section');
  const filtersSection = document.getElementById('filters-section');

  const addRegexButton = document.getElementById('add-regex');
  const saveRegexButton = document.getElementById('save-regex');

  document.getElementById('show-unread').addEventListener('click', () => {
    unreadSection.classList.add('active');
    filtersSection.classList.remove('active');
    document.getElementById('show-unread').classList.add('active');
    document.getElementById('show-filters').classList.remove('active');
  });

  document.getElementById('show-filters').addEventListener('click', () => {
    filtersSection.classList.add('active');
    unreadSection.classList.remove('active');
    document.getElementById('show-filters').classList.add('active');
    document.getElementById('show-unread').classList.remove('active');
  });

  noNotifications.style.cursor = 'pointer';
  noMatched.style.cursor = 'pointer';
  noNotifications.addEventListener('click', () => document.getElementById('show-filters').click());
  noMatched.addEventListener('click', () => document.getElementById('show-filters').click());

  const stored = await chrome.storage.local.get(['regexFilters', 'notifiedTabs']);
  const regexFilters = stored.regexFilters || [];
  const notifiedTabs = stored.notifiedTabs || {};

  unreadList.innerHTML = '';
  matchedList.innerHTML = '';

  const tabs = await chrome.tabs.query({});
  let foundNotification = false;
  let foundMatch = false;

  tabs.forEach(tab => {
    if (notifiedTabs[tab.id]) {
      const unreadItem = document.createElement('li');
      const favicon = tab.favIconUrl ? `<img src="${tab.favIconUrl}" style="width:16px;height:16px;vertical-align:middle;margin-right:5px;border-radius:50%;">` : '??';
      unreadItem.innerHTML = `${favicon} <strong>${tab.title}</strong><br><small>${tab.url}</small>`;
      unreadItem.style.cursor = 'pointer';
      unreadItem.onclick = () => {
        chrome.tabs.update(tab.id, { active: true });
        chrome.windows.update(tab.windowId, { focused: true });
      };
      unreadList.appendChild(unreadItem);
      foundNotification = true;
    }

    const matchesSomeFilter = regexFilters.some(rule => {
      const regex = new RegExp(rule.pattern, 'i');
      if (rule.type === 'url') return regex.test(tab.url);
      if (rule.type === 'title') return regex.test(tab.title);
      return false;
    });

    if (matchesSomeFilter) {
      const matchedItem = document.createElement('li');
      const favicon = tab.favIconUrl ? `<img src="${tab.favIconUrl}" style="width:16px;height:16px;vertical-align:middle;margin-right:5px;border-radius:50%;">` : '??';
      matchedItem.innerHTML = `${favicon} ${tab.title}`;
      matchedItem.style.opacity = 0.8;
      matchedItem.style.cursor = 'pointer';
      matchedItem.onclick = () => {
        chrome.tabs.update(tab.id, { active: true });
        chrome.windows.update(tab.windowId, { focused: true });
      };
      matchedList.appendChild(matchedItem);
      foundMatch = true;
    }

  });

  notificationsTitle.style.display = foundNotification ? 'block' : 'none';
  noNotifications.style.display = foundNotification ? 'none' : 'block';
  clearBadgeButton.style.display = foundNotification ? 'inline-block' : 'none';

  matchedTitle.style.display = foundMatch ? 'block' : 'none';
  noMatched.style.display = foundMatch ? 'none' : 'block';


  // Apply hover style to important buttons
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
      btn.innerHTML = `+ <img src="./icons/${s.title}.png" class="suggestion_icon" alt="Icon" /> ${s.pattern}`;
      btn.classList.add('regex_suggestion');
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
    type.value = prefill.type;
    type.addEventListener('change', saveRegexRules);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '🗑️';
    removeBtn.onclick = () => {
      if (prefill.onRemove) prefill.onRemove();
      container.remove();
      saveRegexRules();
    };

    container.appendChild(pattern);
    container.appendChild(type);
    container.appendChild(removeBtn);
    regexList.appendChild(container);
    //return container;
  }

  createRegexRow();

  async function saveRegexRules() {
    const containers = regexList.querySelectorAll('div');
    const newFilters = [];
    containers.forEach(c => {
      const pattern = c.querySelector('input').value.trim();
      const type = c.querySelector('select').value;
      if (pattern) newFilters.push({
        pattern,
        type
      });
    });
    await chrome.storage.local.set({regexFilters: newFilters});
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

  clearBadgeButton.addEventListener('click', async() => {
    await chrome.storage.local.set({notifiedTabs: {}});
    chrome.action.setBadgeText({text: ''});
    unreadList.innerHTML = '';
    notificationsTitle.style.display = 'none';
    noNotifications.style.display = 'block';
    clearBadgeButton.style.display = 'none';
    clearMessage.style.display = 'block';
    setTimeout(() => clearMessage.style.display = 'none', 2000);
  });
});
