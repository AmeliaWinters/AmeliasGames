/*
 * The whole reason there is a service worker in this project.
 *
 * Android Chrome refuses `new Notification()` from a page: the only way to
 * put a notification on a phone's shade from the web is
 * `registration.showNotification`, and a registration means a worker. So this
 * one caches nothing, intercepts no fetches, and exists to own two events.
 *
 * `skipWaiting`/`clients.claim` because a worker that waits for every tab to
 * close before activating would leave a player on the old copy for the rest
 * of the session, and the thing it is being updated for is the notification
 * they are waiting on.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

/*
 * Tapping the notification puts them back at the table, not at a second copy
 * of it. A tab already open on this origin is focused and steered to the room;
 * only if there is none do we open a window. Matching on origin rather than on
 * the full URL on purpose: the room code lives in the hash, and a tab sitting
 * on the lobby is still the tab they want.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((tabs) => {
      for (const tab of tabs) {
        if (new URL(tab.url).origin !== self.location.origin) continue;
        if (url && 'navigate' in tab) return tab.navigate(url).then((t) => (t || tab).focus());
        return tab.focus();
      }
      return url ? self.clients.openWindow(url) : undefined;
    }),
  );
});
