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

export const STORE_NAMES = {
  BADGE_COLOR_SCHEME : "badgeColorScheme",
  REGEX_FILTERS : 'regexFilters',
  NOTIFIED_TABS: 'notifiedTabs',
  NOTIFICATION_MODE: 'notificationMode',
  HIDE_NOTIFICATION_TEST: 'hideNotifTest'

}

export const MESSAGE_NAMES = {
  UPDATE_BADGE_NOW: 'updateBadgeNow'
}