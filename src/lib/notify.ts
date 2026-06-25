// Lokale Benachrichtigungen via Service Worker (PWA). iOS: nur als installierte App ab 16.4.

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

export async function ensureNotifyPermission(): Promise<boolean> {
  if (!notificationsSupported()) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  try {
    const p = await Notification.requestPermission()
    return p === 'granted'
  } catch { return false }
}

export async function notify(title: string, body: string) {
  try {
    if (!notificationsSupported() || Notification.permission !== 'granted') return
    const opts: Record<string, unknown> = {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      vibrate: [300, 150, 300],
      tag: 'rest-timer',
      renotify: true,
      requireInteraction: false
    }
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready
      await reg.showNotification(title, opts as NotificationOptions)
    } else {
      // eslint-disable-next-line no-new
      new Notification(title, opts as NotificationOptions)
    }
  } catch { /* ignore */ }
}
