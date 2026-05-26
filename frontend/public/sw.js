// APTOGON Service Worker — Web Push notifications
// Handles push events and notification clicks even when the tab is closed.

self.addEventListener('push', function (event) {
  if (!event.data) return;

  let data = {};
  try { data = event.data.json(); } catch { data = { title: 'APTOGON', body: event.data.text() }; }

  const title   = data.title || 'APTOGON';
  const options = {
    body:    data.body  || '',
    icon:    '/icon-192.png',
    badge:   '/icon-72.png',
    tag:     data.tag   || 'aptogon-msg',
    renotify: true,
    data:    { url: data.url || '/chat' },
    vibrate: [200, 100, 200],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/chat';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      // Focus existing chat tab if open
      for (const client of list) {
        if (client.url.includes('/chat') && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open a new tab
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
