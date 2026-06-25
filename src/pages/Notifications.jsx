import React, { useEffect, useMemo, useState } from "react";
import { appClient } from "@/api/appClient";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "../components/shared/useCurrentUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { createPageUrl, createTicketDetailUrl } from "@/utils";
import { Bell, CheckCheck, MessageSquare, TicketCheck, UserPlus, AlertTriangle, Trash2 } from "lucide-react";
import {
  areBrowserNotificationsEnabled,
  getBrowserNotificationPermission,
  isBrowserNotificationSupported,
  requestBrowserNotificationPermission,
  setBrowserNotificationsEnabled,
  showBrowserNotification,
} from "@/lib/browserNotifications";
import { useToast } from "@/components/ui/use-toast";
import usePersistedState from "../components/shared/usePersistedState";
import moment from "moment";

const TYPE_META = {
  ticket_assigned: { label: "Assegnazione", icon: UserPlus, badge: "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300" },
  ticket_comment: { label: "Commento", icon: MessageSquare, badge: "bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300" },
  ticket_done: { label: "Completato", icon: TicketCheck, badge: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" },
  ticket_missing_data: { label: "Mancano dati", icon: AlertTriangle, badge: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" },
  ticket_client_update: { label: "Aggiornamento cliente", icon: Bell, badge: "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300" },
  ticket_watcher_added: { label: "Watcher", icon: Bell, badge: "bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300" },
  live_ops_completed: { label: "Live ops", icon: TicketCheck, badge: "bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300" },
  generic: { label: "Notifica", icon: Bell, badge: "bg-gray-50 text-gray-700 dark:bg-slate-500/15 dark:text-slate-200" },
};

const NOTIFICATION_FILTERS = [
  { key: "all", label: "Tutte", types: null },
  { key: "ticket_comment", label: "Commenti", types: ["ticket_comment"] },
  { key: "ticket_assigned", label: "Assegnazioni", types: ["ticket_assigned"] },
  { key: "ticket_done", label: "Completati", types: ["ticket_done"] },
  { key: "live_ops_completed", label: "Live ops", types: ["live_ops_completed"] },
  { key: "ticket_missing_data", label: "Mancano dati", types: ["ticket_missing_data"] },
  { key: "ticket_client_update", label: "Aggiornamenti cliente", types: ["ticket_client_update"] },
  { key: "ticket_watcher_added", label: "Watcher", types: ["ticket_watcher_added"] },
];

function getNotificationDate(notification) {
  return notification?.event_at || notification?.created_date || notification?.updated_date || "";
}

function withNotificationSource(link) {
  if (!link || !link.includes(createPageUrl("TicketDetail"))) return link;
  if (link.includes("from=")) return link;
  return `${link}${link.includes("?") ? "&" : "?"}from=notifications`;
}

export default function Notifications() {
  const { user, loading } = useCurrentUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeFilter, setActiveFilter] = usePersistedState("notifications:activeFilter", "all");
  const [browserPermission, setBrowserPermission] = useState(getBrowserNotificationPermission());
  const [browserNotificationsEnabled, setBrowserNotificationsEnabledState] = useState(
    areBrowserNotificationsEnabled(user?.id)
  );

  useEffect(() => {
    setBrowserPermission(getBrowserNotificationPermission());
    setBrowserNotificationsEnabledState(areBrowserNotificationsEnabled(user?.id));
  }, [user?.id]);

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ["notifications", user?.id],
    queryFn: () => appClient.entities.Notification.filter({ recipient_id: user.id }),
    enabled: !!user?.id,
    staleTime: Infinity,
  });

  const sortedNotifications = [...notifications].sort((a, b) => {
    const aDate = Date.parse(getNotificationDate(a)) || 0;
    const bDate = Date.parse(getNotificationDate(b)) || 0;
    return bDate - aDate;
  });

  const filteredNotifications = useMemo(() => {
    const selectedFilter = NOTIFICATION_FILTERS.find((item) => item.key === activeFilter);
    if (!selectedFilter || !selectedFilter.types) return sortedNotifications;
    return sortedNotifications.filter((item) => selectedFilter.types.includes(item.type));
  }, [activeFilter, sortedNotifications]);

  const unreadCount = sortedNotifications.filter((item) => !item.read).length;
  const unreadFilteredCount = filteredNotifications.filter((item) => !item.read).length;
  const readFilteredCount = filteredNotifications.filter((item) => item.read).length;
  const countByFilter = useMemo(() => {
    return NOTIFICATION_FILTERS.reduce((acc, filter) => {
      const count = filter.types
        ? sortedNotifications.filter((item) => filter.types.includes(item.type)).length
        : sortedNotifications.length;
      acc[filter.key] = count;
      return acc;
    }, {});
  }, [sortedNotifications]);

  const markAsReadMutation = useMutation({
    mutationFn: async (notificationId) =>
      appClient.entities.Notification.update(notificationId, {
        read: true,
        read_at: new Date().toISOString(),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications", user?.id] }),
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      const unread = filteredNotifications.filter((item) => !item.read);
      if (unread.length === 0) return;

      await Promise.all(
        unread.map((item) =>
          appClient.entities.Notification.update(item.id, {
            read: true,
            read_at: new Date().toISOString(),
          })
        )
      );
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications", user?.id] }),
  });

  const deleteNotificationMutation = useMutation({
    mutationFn: async (notificationId) => appClient.entities.Notification.delete(notificationId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications", user?.id] }),
  });

  const deleteReadMutation = useMutation({
    mutationFn: async () => {
      const readNotifications = filteredNotifications.filter((item) => item.read);
      if (readNotifications.length === 0) return;

      await Promise.all(readNotifications.map((item) => appClient.entities.Notification.delete(item.id)));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications", user?.id] }),
  });

  const markAsRead = async (notificationId) => {
    if (!notificationId) return;
    await markAsReadMutation.mutateAsync(notificationId);
  };

  const handleEnableBrowserNotifications = async () => {
    const nextPermission = await requestBrowserNotificationPermission();
    setBrowserPermission(nextPermission);
    if (nextPermission === "granted") {
      setBrowserNotificationsEnabled(user?.id, true);
      setBrowserNotificationsEnabledState(true);
    }
  };

  const handleDisableBrowserNotifications = () => {
    setBrowserNotificationsEnabled(user?.id, false);
    setBrowserNotificationsEnabledState(false);
  };

  const handleReEnableBrowserNotifications = () => {
    setBrowserNotificationsEnabled(user?.id, true);
    setBrowserNotificationsEnabledState(true);
  };

  const handleTestBrowserNotification = async () => {
    toast({
      title: "Test notifiche avviato",
      description: "Hai 3 secondi per minimizzare l'app o passare a un'altra finestra.",
    });

    window.setTimeout(() => {
      showBrowserNotification({
        title: "Notifica di prova",
        body: "Se vedi questo messaggio, le notifiche browser sono attive correttamente.",
        url: createPageUrl("Notifications"),
        tag: "browser-notification-test-delayed",
      }).then((shown) => {
        if (!shown) {
          toast({
            title: "Notifica non mostrata",
            description: "Il browser ha il permesso, ma il sistema non ha visualizzato la notifica.",
            variant: "destructive",
          });
        }
      });
    }, 3000);
  };

  if (loading || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-6 h-6 border-2 border-violet-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground mt-1">
            {unreadCount > 0 ? `${unreadCount} non lette` : "Tutte lette"}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            className="h-9 w-full text-xs font-semibold sm:w-auto"
            disabled={unreadFilteredCount === 0 || markAllReadMutation.isPending}
            onClick={() => markAllReadMutation.mutate()}
          >
            <CheckCheck className="mr-1.5 h-3.5 w-3.5" />
            Segna filtro come letto
          </Button>
          <Button
            variant="outline"
            className="h-9 w-full text-xs font-semibold sm:w-auto"
            disabled={readFilteredCount === 0 || deleteReadMutation.isPending}
            onClick={() => deleteReadMutation.mutate()}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Cancella lette
          </Button>
        </div>
      </div>

      {isBrowserNotificationSupported() && (
        <Card className="border border-border bg-card shadow-sm">
          <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">Notifiche browser</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Ricevi notifiche di sistema per nuovi eventi quando l'app e in background.
              </p>
            </div>
            {browserPermission === "granted" ? (
              <div className="flex items-center gap-2">
                <Badge
                  className={`border-0 ${
                    browserNotificationsEnabled
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                      : "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-200"
                  }`}
                >
                  {browserNotificationsEnabled ? "Attive" : "Disattivate"}
                </Badge>
                {browserNotificationsEnabled ? (
                  <>
                    <Button variant="outline" className="h-9 text-xs font-semibold" onClick={handleTestBrowserNotification}>
                      Invia test ritardato
                    </Button>
                    <Button variant="outline" className="h-9 text-xs font-semibold" onClick={handleDisableBrowserNotifications}>
                      Disattiva
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" className="h-9 text-xs font-semibold" onClick={handleReEnableBrowserNotifications}>
                    Riattiva
                  </Button>
                )}
              </div>
            ) : browserPermission === "denied" ? (
              <Badge className="border-0 bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
                Bloccate nel browser
              </Badge>
            ) : (
              <Button variant="outline" className="h-9 text-xs font-semibold" onClick={handleEnableBrowserNotifications}>
                Attiva notifiche browser
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        {NOTIFICATION_FILTERS.map((filter) => {
          const isActive = activeFilter === filter.key;
          const count = countByFilter[filter.key] || 0;
          return (
            <button
              key={filter.key}
              onClick={() => setActiveFilter(filter.key)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                isActive
                  ? "bg-violet-600 border-violet-600 text-white"
                  : "bg-card border-border text-muted-foreground hover:border-violet-300 dark:hover:border-violet-500/60"
              }`}
            >
              <span>{filter.label}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${isActive ? "bg-white/20 text-white" : "bg-muted text-muted-foreground"}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {filteredNotifications.length === 0 && (
        <Card className="border border-border bg-card shadow-sm">
          <CardContent className="py-16 text-center">
            <Bell className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">Nessuna notifica nel filtro selezionato</p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {filteredNotifications.map((notification) => {
          const typeMeta = TYPE_META[notification.type] || TYPE_META.generic;
          const Icon = typeMeta.icon;
          const detailLink =
            withNotificationSource(notification.link) ||
            (notification.ticket_id
              ? createTicketDetailUrl(notification.ticket_id, "notifications")
              : null);

          return (
            <Card
              key={notification.id}
              className={`border shadow-sm transition-colors ${
                notification.read
                  ? "border-border bg-card"
                  : "border-violet-200 bg-violet-50/30 dark:border-violet-500/40 dark:bg-violet-500/10"
              }`}
            >
              <CardHeader className="pb-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex items-start gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-card border border-border flex items-center justify-center mt-0.5">
                      <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                    </div>
                    <div>
                      <CardTitle className="text-sm font-semibold text-foreground">
                        {notification.title}
                      </CardTitle>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {moment(getNotificationDate(notification)).fromNow()}
                      </p>
                    </div>
                  </div>
                  <Badge className={`border-0 text-[10px] w-fit ${typeMeta.badge}`}>{typeMeta.label}</Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {notification.body && (
                  <p className="text-xs text-muted-foreground mb-3 whitespace-pre-wrap">{notification.body}</p>
                )}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  {detailLink ? (
                    <Link
                      to={detailLink}
                      className="text-xs font-medium text-violet-700 hover:text-violet-800"
                      onClick={() => {
                        if (!notification.read) {
                          markAsRead(notification.id).catch(() => {});
                        }
                      }}
                    >
                      Apri ticket
                    </Link>
                  ) : (
                    <span className="text-xs text-muted-foreground">Nessun link</span>
                  )}

                  <div className="flex items-center gap-3">
                    {!notification.read && (
                      <button
                        onClick={() => markAsRead(notification.id)}
                        className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
                      >
                        Segna come letta
                      </button>
                    )}
                    <button
                      onClick={() => deleteNotificationMutation.mutate(notification.id)}
                      disabled={deleteNotificationMutation.isPending}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Cancella
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
