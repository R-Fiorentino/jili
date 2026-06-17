const APP_NOTIFICATION_ICON = "/icons/icon-192.png";
const APP_NOTIFICATION_BADGE = "/favicon.png";
const BROWSER_NOTIFICATIONS_ENABLED_PREFIX = "browser_notifications_enabled";
const APP_TITLE = "J-ili | The Ultimate Planner";

function getBrowserNotificationsStorageKey(userId) {
  return `${BROWSER_NOTIFICATIONS_ENABLED_PREFIX}_${userId || "anonymous"}`;
}

export function isBrowserNotificationSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

export function isAppBadgeSupported() {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.setAppBadge === "function" &&
    typeof navigator.clearAppBadge === "function"
  );
}

export function getBrowserNotificationPermission() {
  if (!isBrowserNotificationSupported()) return "unsupported";
  return window.Notification.permission;
}

export function areBrowserNotificationsEnabled(userId) {
  if (typeof window === "undefined") return true;

  try {
    const rawValue = window.localStorage.getItem(getBrowserNotificationsStorageKey(userId));
    if (rawValue === null) return true;
    return rawValue === "true";
  } catch (error) {
    return true;
  }
}

export function setBrowserNotificationsEnabled(userId, enabled) {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(
    getBrowserNotificationsStorageKey(userId),
    enabled ? "true" : "false"
  );
  window.dispatchEvent(
    new CustomEvent("browser-notifications-preference-changed", {
      detail: {
        userId,
        enabled,
      },
    })
  );
}

export async function syncAppUnreadBadge(unreadCount) {
  const normalizedCount = Number.isFinite(unreadCount) ? Math.max(0, unreadCount) : 0;

  if (typeof document !== "undefined") {
    document.title =
      normalizedCount > 0 ? `(${normalizedCount}) ${APP_TITLE}` : APP_TITLE;
  }

  if (!isAppBadgeSupported()) return false;

  if (normalizedCount > 0) {
    await navigator.setAppBadge(normalizedCount);
  } else {
    await navigator.clearAppBadge();
  }

  return true;
}

export async function requestBrowserNotificationPermission() {
  if (!isBrowserNotificationSupported()) return "unsupported";
  return window.Notification.requestPermission();
}

export async function showBrowserNotification({
  title,
  body = "",
  url = "",
  tag = "",
}) {
  if (!isBrowserNotificationSupported()) return false;
  if (window.Notification.permission !== "granted") return false;

  const options = {
    body,
    icon: APP_NOTIFICATION_ICON,
    badge: APP_NOTIFICATION_BADGE,
    tag: tag || undefined,
    data: {
      url,
    },
  };

  try {
    const notification = new window.Notification(title, options);
    notification.onclick = () => {
      window.focus();
      if (url) {
        window.location.href = url;
      }
      notification.close();
    };

    return true;
  } catch (error) {
    // Fall back to the service worker path below.
  }

  if ("serviceWorker" in navigator) {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration?.showNotification) {
      await registration.showNotification(title, options);
      return true;
    }
  }

  return false;
}
