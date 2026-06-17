import { useEffect, useMemo, useRef } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/firebaseClient";
import { useAuth } from "@/lib/AuthContext";
import {
  areBrowserNotificationsEnabled,
  getBrowserNotificationPermission,
  isBrowserNotificationSupported,
  showBrowserNotification,
} from "@/lib/browserNotifications";

const STORAGE_KEY_PREFIX = "browser_notification_seen_ids";

function getStorageKey(userId) {
  return `${STORAGE_KEY_PREFIX}_${userId || "anonymous"}`;
}

function readSeenIds(storageKey) {
  if (typeof window === "undefined") return new Set();

  try {
    const raw = window.sessionStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch (error) {
    return new Set();
  }
}

function writeSeenIds(storageKey, seenIds) {
  if (typeof window === "undefined") return;
  const trimmed = [...seenIds].slice(-200);
  window.sessionStorage.setItem(storageKey, JSON.stringify(trimmed));
}

function shouldDisplaySystemNotification() {
  const isDocumentHidden =
    typeof document !== "undefined" && document.visibilityState === "hidden";
  const hasWindowFocus =
    typeof document !== "undefined" && typeof document.hasFocus === "function"
      ? document.hasFocus()
      : true;

  return isDocumentHidden || !hasWindowFocus;
}

export default function BrowserNotificationBridge() {
  const { user, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const initializedRef = useRef(false);
  const seenIdsRef = useRef(new Set());

  const storageKey = useMemo(() => getStorageKey(user?.id), [user?.id]);

  useEffect(() => {
    initializedRef.current = false;
    seenIdsRef.current = readSeenIds(storageKey);
  }, [storageKey]);

  useEffect(() => {
    if (!user?.id || !isAuthenticated) return undefined;
    if (!isBrowserNotificationSupported()) return undefined;

    const notificationsQuery = query(
      collection(db, "notifications"),
      where("recipient_id", "==", user.id)
    );

    const unsubscribe = onSnapshot(notificationsQuery, (snapshot) => {
      const permission = getBrowserNotificationPermission();
      const snapshotNotifications = snapshot.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      }));

      queryClient.setQueryData(["notifications", user.id], snapshotNotifications);

      if (!initializedRef.current) {
        snapshot.docs.forEach((document) => {
          seenIdsRef.current.add(document.id);
        });
        writeSeenIds(storageKey, seenIdsRef.current);
        initializedRef.current = true;
        return;
      }

      const addedUnreadNotifications = snapshot.docChanges().filter(
        (change) =>
          change.type === "added" &&
          !seenIdsRef.current.has(change.doc.id) &&
          !change.doc.data()?.read
      );

      addedUnreadNotifications.forEach((change) => {
        const notification = { id: change.doc.id, ...change.doc.data() };
        seenIdsRef.current.add(notification.id);

        if (
          permission === "granted" &&
          areBrowserNotificationsEnabled(user.id) &&
          shouldDisplaySystemNotification()
        ) {
          showBrowserNotification({
            title: notification.title || "Nuova notifica",
            body: notification.body || notification.ticket_title || "",
            url: notification.link || "",
            tag: notification.id,
          }).catch(() => {});
        }
      });

      if (addedUnreadNotifications.length > 0) {
        writeSeenIds(storageKey, seenIdsRef.current);
      }
    });

    return () => unsubscribe();
  }, [isAuthenticated, queryClient, storageKey, user?.id]);

  return null;
}
