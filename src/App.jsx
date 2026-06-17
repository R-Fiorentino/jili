import { useEffect, useRef } from 'react';
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import LoginScreen from '@/components/auth/LoginScreen';
import RoleSetup from '@/components/shared/RoleSetup';
import BrowserNotificationBridge from '@/components/shared/BrowserNotificationBridge';
import { ThemeProvider } from "@/components/theme-provider";
import { appClient } from "@/api/appClient";
import { db } from "@/api/firebaseClient";
import { getHomePageForRole, isKnownAppRole, normalizeAppRole } from "@/utils";
import { buildWeeklyRebalanceUpdates, getDynamicRebalanceOptions } from "@/pages/DevPipeline";
import { calculatePriorityScore, isOpenStatus } from "@/components/shared/priorityUtils";
import { doc, runTransaction, serverTimestamp } from "firebase/firestore";

const { Pages, Layout } = pagesConfig;
const DAILY_PRIORITY_SYNC_MIN_HOUR = 9;
const DAILY_PRIORITY_SYNC_KEY_PREFIX = "daily_priority_sync_done_v1";
const DAILY_PRIORITY_SYNC_LOCK_COLLECTION = "dailySyncLocks";
const BATCH_SIZE = 25;

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

function getRomeDateTimeParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const dateKey = `${map.year}-${map.month}-${map.day}`;
  const hour = Number(map.hour) || 0;

  return { dateKey, hour };
}

function chunkArray(items = [], chunkSize = BATCH_SIZE) {
  const size = Math.max(1, Number(chunkSize) || BATCH_SIZE);
  const chunks = [];

  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }

  return chunks;
}

async function acquireDailyPrioritySyncLock(dateKey, user = null) {
  if (!dateKey) return false;

  const lockId = `priority_sync_${dateKey}`;
  const lockRef = doc(db, DAILY_PRIORITY_SYNC_LOCK_COLLECTION, lockId);
  const createdDate = new Date().toISOString();
  let acquired = false;

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(lockRef);
    if (snapshot.exists()) {
      acquired = false;
      return;
    }

    transaction.set(lockRef, {
      job: "daily_priority_sync",
      date_key: dateKey,
      created_date: createdDate,
      created_at: serverTimestamp(),
      actor_id: user?.id || null,
      actor_email: user?.email || null,
      actor_role: normalizeAppRole(user?.app_role || user?._app_role || user?.role),
    });
    acquired = true;
  });

  return acquired;
}

const AuthenticatedApp = () => {
  const { user: authUser, isLoadingAuth, isLoadingPublicSettings, authError, checkAppState } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const role = normalizeAppRole(authUser?.app_role || authUser?._app_role || authUser?.role);
  const hasKnownRole = isKnownAppRole(role);
  const homePage = getHomePageForRole(role);
  const isDailySyncRunningRef = useRef(false);

  useEffect(() => {
    if (isLoadingPublicSettings || isLoadingAuth || authError || role !== "analyst") return;

    const userKey = authUser?.id || authUser?.email || "analyst";
    const redirectKey = `entry_redirect_done_${userKey}`;
    const isFirstEntryThisSession = !window.sessionStorage.getItem(redirectKey);
    const shouldRedirectFromPath =
      location.pathname === "/" || location.pathname === "/DevPipeline" || location.pathname === "/Dashboard";

    if (isFirstEntryThisSession) {
      window.sessionStorage.setItem(redirectKey, "1");
      if (shouldRedirectFromPath && location.pathname !== `/${homePage}`) {
        navigate(`/${homePage}`, { replace: true });
      }
    }
  }, [
    authError,
    authUser?.email,
    authUser?.id,
    homePage,
    isLoadingAuth,
    isLoadingPublicSettings,
    location.pathname,
    navigate,
    role,
  ]);

  useEffect(() => {
    if (!authUser) return;

    const pathname = location.pathname;
    let pageName;

    if (pathname === '/' || pathname === '') {
      pageName = homePage ?? Object.keys(Pages)[0];
    } else {
      const pathSegment = pathname.replace(/^\//, '').split('/')[0];
      const matchedKey = Object.keys(Pages).find(
        (key) => key.toLowerCase() === pathSegment.toLowerCase()
      );
      pageName = matchedKey || null;
    }

    if (!pageName) return;

    if (pageName !== "TicketDetail") {
      window.sessionStorage.setItem("app_last_non_ticket_path", location.pathname + location.search);
      window.sessionStorage.setItem("app_last_non_ticket_page", pageName);
    }

    appClient.appLogs.logUserInApp(pageName).catch(() => {});
  }, [Pages, authUser, homePage, location.pathname, location.search]);

  useEffect(() => {
    if (isLoadingPublicSettings || isLoadingAuth || authError || !authUser || !hasKnownRole) return;
    if (role !== "admin" && role !== "analyst") return;
    if (isDailySyncRunningRef.current) return;

    const { dateKey, hour } = getRomeDateTimeParts();
    if (hour < DAILY_PRIORITY_SYNC_MIN_HOUR) return;

    const dailySyncKey = `${DAILY_PRIORITY_SYNC_KEY_PREFIX}:${dateKey}`;
    if (window.localStorage.getItem(dailySyncKey) === "1") return;

    isDailySyncRunningRef.current = true;

    const runDailyPrioritySync = async () => {
      try {
        const hasGlobalLock = await acquireDailyPrioritySyncLock(dateKey, authUser);
        if (!hasGlobalLock) {
          window.localStorage.setItem(dailySyncKey, "1");
          return;
        }

        const [tickets, clients, developers, priorityConfigs] = await Promise.all([
          appClient.entities.Ticket.list(),
          appClient.entities.Client.list(),
          appClient.entities.Developer.list(),
          appClient.entities.PriorityConfig.list("-updated_date", 1),
        ]);

        if (!Array.isArray(tickets) || tickets.length === 0) {
          window.localStorage.setItem(dailySyncKey, "1");
          return;
        }

        const priorityConfig = priorityConfigs?.[0] || {};
        const clientsById = new Map((clients || []).map((client) => [client.id, client]));

        const priorityUpdates = [];
        let workingTickets = tickets.map((ticket) => {
          if (!isOpenStatus(ticket?.status)) return ticket;
          const client = clientsById.get(ticket?.client_id) || null;
          const nextPriorityScore = calculatePriorityScore(ticket, client, priorityConfig);
          const currentPriorityScore = Number(ticket?.priority_score) || 0;

          if (nextPriorityScore !== currentPriorityScore) {
            priorityUpdates.push({ id: ticket.id, priority_score: nextPriorityScore });
            return { ...ticket, priority_score: nextPriorityScore };
          }

          return ticket;
        });

        for (const chunk of chunkArray(priorityUpdates)) {
          await Promise.all(
            chunk.map((entry) =>
              appClient.entities.Ticket.update(entry.id, { priority_score: entry.priority_score })
            )
          );
        }

        const activeDevelopers = (developers || []).filter((developer) => developer?.active !== false);
        const developerIdsWithOpenTickets = new Set(
          workingTickets
            .filter((ticket) => isOpenStatus(ticket?.status) && ticket?.assignee_id)
            .map((ticket) => ticket.assignee_id)
        );

        for (const developer of activeDevelopers) {
          if (!developerIdsWithOpenTickets.has(developer.id)) continue;

          const scheduleUpdates = buildWeeklyRebalanceUpdates(
            workingTickets,
            developer.id,
            developer,
            getDynamicRebalanceOptions({
              preserveWorkingDaysFromToday: 3,
            })
          );

          if (scheduleUpdates.length === 0) continue;

          for (const chunk of chunkArray(scheduleUpdates)) {
            await Promise.all(
              chunk.map((entry) => appClient.entities.Ticket.update(entry.id, entry.updates))
            );
          }

          const updatesById = new Map(scheduleUpdates.map((entry) => [entry.id, entry.updates]));
          workingTickets = workingTickets.map((ticket) =>
            updatesById.has(ticket.id)
              ? { ...ticket, ...updatesById.get(ticket.id) }
              : ticket
          );
        }

        window.localStorage.setItem(dailySyncKey, "1");
        await queryClientInstance.invalidateQueries({ queryKey: ["tickets"] });
      } catch (error) {
        console.error("Daily priority sync failed", error);
      } finally {
        isDailySyncRunningRef.current = false;
      }
    };

    runDailyPrioritySync();
  }, [
    authError,
    authUser,
    hasKnownRole,
    isLoadingAuth,
    isLoadingPublicSettings,
    role,
  ]);

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      return <LoginScreen />;
    }
  }

  if (authUser && !hasKnownRole) {
    return <RoleSetup onDone={checkAppState} />;
  }

  // Render the main app
  return (
    <Routes>
      <Route path="/" element={<Navigate to={`/${homePage}`} replace />} />
      {Object.entries(Pages).map(([path, Page]) => (
        <Route
          key={path}
          path={`/${path}`}
          element={
            path === "Dashboard" && role !== "admin" ? (
              <Navigate to={`/${homePage}`} replace />
            ) : (
              <LayoutWrapper currentPageName={path}>
                <Page />
              </LayoutWrapper>
            )
          }
        />
      ))}
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <AuthProvider>
        <QueryClientProvider client={queryClientInstance}>
          <BrowserNotificationBridge />
          <Router>
            <AuthenticatedApp />
          </Router>
          <Toaster />
        </QueryClientProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}

export default App
