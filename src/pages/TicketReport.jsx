import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";
import { appClient } from "@/api/appClient";
import { createPageUrl, createTicketDetailUrl, getHomePageForRole } from "@/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import TestReportCard from "@/components/tickets/TestReportCard";
import { useCurrentUser } from "../components/shared/useCurrentUser";
import {
  DEFAULT_CONFIG,
  getIndustryOptions,
  hasTicketReportContent,
  isClosedStatus,
} from "../components/shared/priorityUtils";

export default function TicketReport() {
  const [hasUnsavedChanges, setHasUnsavedChanges] = React.useState(false);
  const [leaveAlertOpen, setLeaveAlertOpen] = React.useState(false);
  const [pendingNavigation, setPendingNavigation] = React.useState(null);
  const urlParams = new URLSearchParams(window.location.search);
  const ticketId = urlParams.get("id");
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();
  const navigate = useNavigate();
  const homePage = getHomePageForRole(user?.role);
  const historyGuardArmedRef = React.useRef(false);
  const skipNextPopStateRef = React.useRef(false);

  const { data: ticket, isLoading } = useQuery({
    queryKey: ["ticket", ticketId],
    queryFn: () => appClient.entities.Ticket.list().then((all) => all.find((row) => row.id === ticketId)),
    enabled: !!ticketId,
  });

  const { data: configList = [] } = useQuery({
    queryKey: ["priority_config"],
    queryFn: () => appClient.entities.PriorityConfig.list(),
  });

  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: () => appClient.entities.Client.list(),
    enabled: !!ticket?.client_id,
  });

  const config = configList[0] || DEFAULT_CONFIG;
  const industryOptions = getIndustryOptions(config);
  const allowedReportRoles = Array.isArray(config?.report_permissions?.edit_roles)
    ? config.report_permissions.edit_roles
    : DEFAULT_CONFIG.report_permissions.edit_roles;
  const normalizedAllowedReportRoles = allowedReportRoles
    .map((role) => String(role || "").trim().toLowerCase())
    .filter(Boolean);
  const canEditReport = normalizedAllowedReportRoles.includes(
    String(user?.role || "").trim().toLowerCase()
  );

  const updateMutation = useMutation({
    mutationFn: ({ data, auditAction, auditDetails }) => {
      const auditEntry = {
        timestamp: new Date().toISOString(),
        user: user?.email || user?.full_name || "user",
        action: auditAction,
        details: auditDetails,
      };
      return appClient.entities.Ticket.update(ticketId, {
        ...data,
        audit_log: [...(ticket?.audit_log || []), auditEntry],
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["ticket", ticketId] });
      await queryClient.invalidateQueries({ queryKey: ["tickets"] });
    },
  });

  const handlePersist = async (reportPayload, { generated = false } = {}) => {
    const nextStatus = hasTicketReportContent({ test_report: reportPayload })
      ? "reported"
      : (ticket?.status || "done");

    await updateMutation.mutateAsync({
      data: { test_report: reportPayload, status: nextStatus },
      auditAction: generated ? "test_report_generated" : "test_report_updated",
      auditDetails: generated
        ? `Test report generated from dedicated report workspace${nextStatus === "reported" ? "; status set to reported" : ""}`
        : `Test report updated from dedicated report workspace${nextStatus === "reported" ? "; status set to reported" : ""}`,
    });
  };

  const isReportAvailable = isClosedStatus(ticket?.status);
  const client = clients.find((row) => row.id === ticket?.client_id) || null;

  React.useEffect(() => {
    if (!hasUnsavedChanges) return undefined;

    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  React.useEffect(() => {
    if (!hasUnsavedChanges) {
      setLeaveAlertOpen(false);
      setPendingNavigation(null);
    }
  }, [hasUnsavedChanges]);

  React.useEffect(() => {
    if (!hasUnsavedChanges) return undefined;

    const handleDocumentClick = (event) => {
      if (event.defaultPrevented) return;
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!anchor) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      const rawHref = anchor.getAttribute("href");
      if (!rawHref || rawHref.startsWith("#")) return;

      const nextUrl = new URL(anchor.href, window.location.origin);
      const currentUrl = new URL(window.location.href);
      const isSameDestination =
        nextUrl.pathname === currentUrl.pathname &&
        nextUrl.search === currentUrl.search &&
        nextUrl.hash === currentUrl.hash;

      if (isSameDestination) return;

      event.preventDefault();
      setPendingNavigation({
        type: nextUrl.origin === window.location.origin ? "internal" : "external",
        to: `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`,
        href: nextUrl.href,
      });
      setLeaveAlertOpen(true);
    };

    document.addEventListener("click", handleDocumentClick, true);
    return () => document.removeEventListener("click", handleDocumentClick, true);
  }, [hasUnsavedChanges]);

  React.useEffect(() => {
    if (!hasUnsavedChanges) {
      historyGuardArmedRef.current = false;
      return undefined;
    }

    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (!historyGuardArmedRef.current) {
      window.history.pushState({ ticketReportGuard: true }, "", currentUrl);
      historyGuardArmedRef.current = true;
    }

    const handlePopState = () => {
      if (skipNextPopStateRef.current) {
        skipNextPopStateRef.current = false;
        return;
      }

      window.history.pushState({ ticketReportGuard: true }, "", currentUrl);
      setPendingNavigation({ type: "history-back" });
      setLeaveAlertOpen(true);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [hasUnsavedChanges]);

  const handleStayOnPage = () => {
    setLeaveAlertOpen(false);
    setPendingNavigation(null);
  };

  const handleLeaveWithoutSaving = () => {
    const nextNavigation = pendingNavigation;
    setLeaveAlertOpen(false);
    setPendingNavigation(null);

    if (!nextNavigation) return;

    skipNextPopStateRef.current = true;

    if (nextNavigation.type === "history-back") {
      setHasUnsavedChanges(false);
      window.history.back();
      return;
    }

    if (nextNavigation.type === "external") {
      setHasUnsavedChanges(false);
      window.location.href = nextNavigation.href;
      return;
    }

    setHasUnsavedChanges(false);
    navigate(nextNavigation.to);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">Ticket non trovato</p>
        <Link to={createPageUrl(homePage)} className="text-sm text-blue-600 mt-2 inline-block">
          ← Torna ai miei ticket
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Link
          to={createTicketDetailUrl(ticket.id, "ticket_report")}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Torna al ticket
        </Link>
      </div>

      {!isReportAvailable && (
        <div className="rounded-3xl border border-border/70 bg-card/80 px-5 py-4 text-sm text-muted-foreground shadow-sm">
          Il report è disponibile quando il ticket è in stato <strong>Done</strong> o <strong>QA / Review</strong>.
        </div>
      )}

      {isReportAvailable && (
        <TestReportCard
          ticket={ticket}
          client={client}
          industryOptions={industryOptions}
          canEdit={canEditReport}
          onPersist={handlePersist}
          actorName={user?.full_name || user?.email || ""}
          onDirtyChange={setHasUnsavedChanges}
        />
      )}

      <AlertDialog open={leaveAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Modifiche non salvate</AlertDialogTitle>
            <AlertDialogDescription>
              Hai modificato il report ma non l&apos;hai ancora salvato. Se esci ora perderai le modifiche non salvate.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleStayOnPage}>
              Resta nella pagina
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleLeaveWithoutSaving}>
              Esci senza salvare
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
