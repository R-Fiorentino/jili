import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { useQuery } from "@tanstack/react-query";
import { appClient } from "@/api/appClient";
import { cn } from "@/lib/utils";
import {
  BarChart2,
  BarChart3,
  Ticket,
  Building2,
  Users,
  Settings,
  Bell,
  Menu,
  X,
  CalendarDays,
  Workflow,
  LogOut,
  BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import RoleSetup from "./components/shared/RoleSetup";
import RoleGate from "./components/shared/RoleGate";
import { useAuth } from "@/lib/AuthContext";
import ThemeToggle from "./components/shared/ThemeToggle";
import { getHomePageForRole, isDeveloperLikeRole, isKnownAppRole } from "@/utils";
import { syncAppUnreadBadge } from "@/lib/browserNotifications";
import AppTutorial, { hasSeenTutorial, markTutorialSeen } from "./components/shared/AppTutorial";

const ALL_NAV_ITEMS = [
  { label: "I miei ticket", page: "MyTickets", icon: Ticket, roles: ["developer", "tech_supervisor", "analyst", "admin"] },
  { label: "Nuovo ticket", page: "CreateTicket", icon: Ticket, roles: ["admin", "analyst", "tech_supervisor"] },
  { label: "Pipeline dev", page: "DevPipeline", icon: Workflow, roles: ["admin", "analyst", "developer", "tech_supervisor"] },
  { label: "Disponibilita", page: "Availability", icon: CalendarDays, roles: ["admin", "developer", "tech_supervisor"] },
  { label: "Test riportati", page: "ReportedTests", icon: BarChart3, roles: ["admin", "analyst", "developer", "tech_supervisor"] },
  { label: "Notifiche", page: "Notifications", icon: Bell, roles: ["admin", "analyst", "developer", "tech_supervisor"] },
  { label: "Clienti", page: "Clients", icon: Building2, roles: ["admin", "analyst", "developer", "tech_supervisor"] },
  { label: "Analyst", page: "Analysts", icon: BarChart2, roles: ["admin"] },
  { label: "Developer", page: "Developers", icon: Users, roles: ["admin", "tech_supervisor"] },
  { label: "Impostazioni", page: "Settings", icon: Settings, roles: ["admin"] },
];
const PAGE_LABEL_FALLBACK = {
  Dashboard: "Dashboard",
  TicketDetail: "Dettaglio ticket",
  TicketReport: "Report test",
};
const APP_ICON_URL = "/icons/app-icon-source.png";

function normalizeRole(role) {
  return String(role || "user").trim().toLowerCase();
}

function orderNavItemsByRole(items, role) {
  if (role === "analyst") {
    const analystOrder = [
      "MyTickets",
      "CreateTicket",
      "DevPipeline",
      "ReportedTests",
      "Clients",
      "Notifications",
    ];
    const orderMap = new Map(analystOrder.map((page, index) => [page, index]));
    return [...items].sort((a, b) => {
      const aIndex = orderMap.has(a.page) ? orderMap.get(a.page) : Number.MAX_SAFE_INTEGER;
      const bIndex = orderMap.has(b.page) ? orderMap.get(b.page) : Number.MAX_SAFE_INTEGER;
      if (aIndex !== bIndex) return aIndex - bIndex;
      return a.label.localeCompare(b.label, "it", { sensitivity: "base" });
    });
  }

  if (role === "admin") {
    const adminOrder = [
      "MyTickets",
      "CreateTicket",
      "DevPipeline",
      "ReportedTests",
      "Clients",
      "Analysts",
      "Developers",
      "Notifications",
      "Settings",
    ];
    const orderMap = new Map(adminOrder.map((page, index) => [page, index]));
    return [...items].sort((a, b) => {
      const aIndex = orderMap.has(a.page) ? orderMap.get(a.page) : Number.MAX_SAFE_INTEGER;
      const bIndex = orderMap.has(b.page) ? orderMap.get(b.page) : Number.MAX_SAFE_INTEGER;
      if (aIndex !== bIndex) return aIndex - bIndex;
      return a.label.localeCompare(b.label, "it", { sensitivity: "base" });
    });
  }

  return items;
}

export default function Layout({ children, currentPageName }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const { user: authUser, isLoadingAuth, logout, checkAppState } = useAuth();
  const role = normalizeRole(authUser?.app_role || authUser?._app_role || authUser?.role);
  const user = authUser ? { ...authUser, role } : null;
  const tutorialCheckRef = useRef("");
  const { data: myNotifications = [] } = useQuery({
    queryKey: ["notifications", user?.id],
    queryFn: () => appClient.entities.Notification.filter({ recipient_id: user.id }),
    enabled: !!user?.id,
    staleTime: Infinity,
  });
  const unreadNotifications = myNotifications.filter((item) => !item.read).length;

  useEffect(() => {
    syncAppUnreadBadge(unreadNotifications).catch(() => {});
  }, [unreadNotifications]);

  useEffect(() => {
    if (!user?.id || !isKnownAppRole(user.role)) return;

    const checkKey = `${user.id}:${user.role}`;
    if (tutorialCheckRef.current === checkKey) return;
    tutorialCheckRef.current = checkKey;

    if (!hasSeenTutorial(user.id, user.role)) {
      setTutorialOpen(true);
    }
  }, [user?.id, user?.role]);

  if (isLoadingAuth) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (user && !isKnownAppRole(user.role)) {
    return <RoleSetup onDone={checkAppState} />;
  }

  const NAV_ITEMS = orderNavItemsByRole(
    ALL_NAV_ITEMS.filter((item) => user && item.roles.includes(user.role)),
    user?.role
  );
  const secondaryPages = new Set(["Notifications", "Settings"]);
  const primaryNavItems = NAV_ITEMS.filter((item) => !secondaryPages.has(item.page));
  const secondaryNavItems = NAV_ITEMS.filter((item) => secondaryPages.has(item.page));
  const homePage = getHomePageForRole(user?.role);
  const currentPageLabel =
    NAV_ITEMS.find((item) => item.page === currentPageName)?.label ||
    PAGE_LABEL_FALLBACK[currentPageName] ||
    "Workspace";
  const isDevPipelinePage = currentPageName === "DevPipeline";
  const canCreateTicket = NAV_ITEMS.some((item) => item.page === "CreateTicket");
  const hasNotificationsPage = NAV_ITEMS.some((item) => item.page === "Notifications");
  const userInitials = String(user?.full_name || user?.email || "U")
    .split(" ")
    .filter(Boolean)
    .map((chunk) => chunk[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const handleTutorialOpenChange = (nextOpen) => {
    if (!nextOpen && user?.id && isKnownAppRole(user.role)) {
      markTutorialSeen(user.id, user.role);
    }
    setTutorialOpen(nextOpen);
  };

  return (
    <div className="app-shell bg-background text-foreground">
      <div className="relative h-full w-full overflow-hidden">
        <div className="lg:hidden absolute inset-x-0 top-0 z-50 h-16 border-b border-border/70 bg-background/95 px-4 backdrop-blur-xl">
          <div className="flex h-full items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl border border-border/60 bg-card shadow-[var(--shadow-soft)]">
                <img src={APP_ICON_URL} alt="J-ili" className="h-full w-full object-cover" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold tracking-tight">{currentPageLabel}</p>
                <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Workspace</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9"
              onClick={() => setSidebarOpen((prev) => !prev)}
            >
              {sidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {sidebarOpen && (
          <div
            className="absolute inset-0 z-40 bg-slate-950/35 backdrop-blur-[2px] lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <aside
          className={cn(
            "absolute left-0 top-0 z-50 h-full w-[202px] border-r border-border/70 bg-background/95 backdrop-blur-xl transition-transform duration-200 lg:translate-x-0 xl:w-[218px]",
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <div className="flex h-full flex-col">
            <div className="px-4 pb-3 pt-5">
              <Link
                to={createPageUrl(homePage)}
                onClick={() => setSidebarOpen(false)}
                className="inline-flex items-center gap-3"
              >
                <span className="inline-flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl border border-border/60 bg-card shadow-[var(--shadow-soft)]">
                  <img src={APP_ICON_URL} alt="J-ili" className="h-full w-full object-cover" />
                </span>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Workspace</p>
                  <p className="text-xl font-semibold tracking-tight text-foreground">J-ili</p>
                </div>
              </Link>
            </div>

            <nav className="flex-1 overflow-y-auto px-3 py-3">
              <div className="space-y-1.5">
                {primaryNavItems.map((item) => {
                  const isActive = currentPageName === item.page;
                  return (
                    <Link
                      key={item.page}
                      to={createPageUrl(item.page)}
                      onClick={() => setSidebarOpen(false)}
                      data-tour={`nav-${item.page}`}
                      className={cn(
                        "group flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-[background-color,color,border-color,box-shadow]",
                        isActive
                          ? "border border-border/75 bg-card text-foreground shadow-[var(--shadow-soft)]"
                          : "border border-transparent text-muted-foreground hover:border-border/60 hover:bg-card/70 hover:text-foreground"
                      )}
                    >
                      <item.icon className="h-4 w-4 shrink-0 stroke-[1.9]" />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  );
                })}
              </div>

              {secondaryNavItems.length > 0 && (
                <>
                  <div className="my-4 border-t border-border/70" />
                  <p className="px-3 pb-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Sistema</p>
                  <div className="space-y-1.5">
                    {secondaryNavItems.map((item) => {
                      const isActive = currentPageName === item.page;
                      return (
                        <Link
                          key={item.page}
                          to={createPageUrl(item.page)}
                          onClick={() => setSidebarOpen(false)}
                          data-tour={`nav-${item.page}`}
                          className={cn(
                            "group flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-[background-color,color,border-color,box-shadow]",
                            isActive
                              ? "border border-border/75 bg-card text-foreground shadow-[var(--shadow-soft)]"
                              : "border border-transparent text-muted-foreground hover:border-border/60 hover:bg-card/70 hover:text-foreground"
                          )}
                        >
                          <item.icon className="h-4 w-4 shrink-0 stroke-[1.9]" />
                          <span className="truncate">{item.label}</span>
                          {item.page === "Notifications" && unreadNotifications > 0 && (
                            <span className="ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                              {unreadNotifications > 99 ? "99+" : unreadNotifications}
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                </>
              )}
            </nav>

            <div className="px-3 pb-4 pt-2">
              <div className="app-surface p-2">
                <div className="flex items-center gap-2">
                  <ThemeToggle compact className="!h-9 !w-9 rounded-xl border-0 bg-muted/70" />
                  <button
                    type="button"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-muted/70 text-xs font-semibold text-muted-foreground"
                    title={user?.full_name || user?.email || "Profilo"}
                  >
                    {userInitials.slice(0, 1)}
                  </button>
                  <button
                    onClick={() => logout()}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-muted/70 text-muted-foreground"
                    title="Esci"
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
                </div>
                {isDeveloperLikeRole(user?.role) && (
                  <Link
                    to={createPageUrl("Availability")}
                    onClick={() => setSidebarOpen(false)}
                    className="mt-2 inline-flex h-8 w-full items-center justify-center rounded-lg bg-muted/70 text-xs font-medium text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
                  >
                    Disponibilita
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setSidebarOpen(false);
                    setTutorialOpen(true);
                  }}
                  className="mt-2 inline-flex h-8 w-full items-center justify-center gap-2 rounded-lg bg-muted/70 text-xs font-medium text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  Rivedi tutorial
                </button>
              </div>
            </div>
          </div>
        </aside>

        <main className="flex h-full min-h-0 flex-col pt-16 lg:ml-[202px] lg:pt-0 xl:ml-[218px]">
          <header className={cn("hidden items-center justify-between lg:flex h-20 px-6 xl:px-8")}>
            <div className="min-w-0">
              <p className="app-kicker">Workspace</p>
              <h1 className={cn("truncate font-semibold tracking-tight", isDevPipelinePage ? "text-[26px]" : "text-[30px]")}>{currentPageLabel}</h1>
            </div>
            <div className="flex items-center gap-2">
              {canCreateTicket && (
                <Link to={createPageUrl("CreateTicket")}>
                  <Button className="h-10 rounded-full px-5" data-tour="topbar-new-ticket">Nuovo ticket</Button>
                </Link>
              )}

              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-10 w-10 rounded-full"
                onClick={() => setTutorialOpen(true)}
                title="Apri tutorial"
                data-tour="topbar-tutorial"
              >
                <BookOpen className="h-4 w-4" />
              </Button>

              {hasNotificationsPage && (
                <Link to={createPageUrl("Notifications")} className="relative">
                  <Button variant="outline" size="icon" className="h-10 w-10 rounded-full">
                    <Bell className="h-4 w-4" />
                  </Button>
                  {unreadNotifications > 0 && (
                    <span className="absolute -right-1 -top-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                      {unreadNotifications > 99 ? "99+" : unreadNotifications}
                    </span>
                  )}
                </Link>
              )}

              <Avatar className="h-10 w-10 border border-border/80 shadow-[var(--shadow-soft)]">
                <AvatarFallback className="bg-primary/15 text-[11px] font-semibold text-primary">
                  {userInitials}
                </AvatarFallback>
              </Avatar>
            </div>
          </header>

          <div className={cn("flex-1 min-h-0 overflow-hidden px-3 pb-3 lg:px-6 lg:pb-6 xl:px-8")}>
            <div className="h-full min-h-0 rounded-2xl border border-border/70 bg-card/90 p-4 shadow-[var(--shadow-soft)] backdrop-blur-sm md:p-5 lg:p-6">
              <div className={cn("h-full min-h-0 pr-1", isDevPipelinePage ? "overflow-hidden" : "overflow-y-auto")}>
                {children}
              </div>
            </div>
          </div>
        </main>
      </div>

      <AppTutorial open={tutorialOpen} onOpenChange={handleTutorialOpenChange} user={user} currentPageName={currentPageName} />
      <RoleGate />
    </div>
  );
}
