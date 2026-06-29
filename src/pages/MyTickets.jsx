import React, { useMemo } from "react";
import { appClient } from "@/api/appClient";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Link } from "react-router-dom";
import { createPageUrl, createTicketDetailUrl, normalizeAppRole } from "@/utils";
import { Clock, ArrowRight, Calendar } from "lucide-react";
import {
  STATUS_CONFIG,
  DIFFICULTY_CONFIG,
  getActualEffortHours,
  getPlannedEffortHours,
  getTicketWorkflowStatus,
  isTicketClosed,
  compareTicketsByPriority,
} from "../components/shared/priorityUtils";
import { useCurrentUser } from "../components/shared/useCurrentUser";
import usePersistedState from "../components/shared/usePersistedState";
import BacklogTable from "../components/dashboard/BacklogTable";
import moment from "moment";

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeId(value) {
  return String(value || "").trim();
}

function collectTeamIds(client, fieldNames = []) {
  return fieldNames.flatMap((fieldName) => {
    const values = client?.[fieldName];
    if (!Array.isArray(values)) return [];

    return values
      .map((entry) => {
        if (entry && typeof entry === "object") {
          return normalizeId(entry.id || entry.user_id || entry.uid || entry.email);
        }
        return normalizeId(entry);
      })
      .filter(Boolean);
  });
}

function collectTeamNames(client, fieldNames = []) {
  return fieldNames.flatMap((fieldName) => {
    const values = client?.[fieldName];
    if (!Array.isArray(values)) return [];

    return values
      .flatMap((entry) => {
        if (entry && typeof entry === "object") {
          return [
            entry.full_name,
            entry.name,
            entry.email,
          ];
        }
        return [entry];
      })
      .map(normalizeText)
      .filter(Boolean);
  });
}

function analystBelongsToClient(client, user) {
  const userIds = [
    user?.id,
    user?.uid,
    user?.user_id,
    user?.firebase_uid,
  ].map(normalizeId).filter(Boolean);
  const userNames = [
    user?.email,
    user?.full_name,
    user?.name,
  ].map(normalizeText).filter(Boolean);

  const analystIds = collectTeamIds(client, [
    "analyst_team_ids",
    "analyst_ids",
    "analysts_ids",
    "analysts",
    "analyst_team",
  ]);
  const analystNames = collectTeamNames(client, [
    "analyst_team_names",
    "analyst_names",
    "analysts",
    "analyst_team",
  ]);

  return (
    userIds.some((id) => analystIds.includes(id)) ||
    userNames.some((name) => analystNames.includes(name))
  );
}

function normalizeTicketKind(ticket) {
  const normalized = String(ticket?.ticket_kind || "").trim().toLowerCase();
  return normalized || "main";
}

function sortByPriorityThenRecent(a, b) {
  const byPriority = compareTicketsByPriority(a, b);
  if (byPriority !== 0) return byPriority;
  const aTime = Date.parse(a?.updated_date || a?.created_date || "") || 0;
  const bTime = Date.parse(b?.updated_date || b?.created_date || "") || 0;
  return bTime - aTime;
}

export default function MyTickets() {
  const { user, loading: userLoading, isTechSupervisor: isTechSupervisorRole } = useCurrentUser();
  const [showOnlyMine, setShowOnlyMine] = usePersistedState("my-tickets:showOnlyMine", true);

  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ["tickets"],
    queryFn: () => appClient.entities.Ticket.list(),
    enabled: !!user?.email,
  });

  const { data: developers = [] } = useQuery({
    queryKey: ["developers"],
    queryFn: () => appClient.entities.Developer.list(),
    enabled: !!user?.email,
  });

  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: () => appClient.entities.Client.list(),
    enabled: !!user?.email,
  });

  const normalizedRole = normalizeAppRole(user?.app_role || user?._app_role || user?.role);
  const isDeveloper = normalizedRole === "developer";
  const isTechSupervisor = isTechSupervisorRole || normalizedRole === "tech_supervisor";
  const loggedDeveloperProfile = useMemo(
    () => developers.find((developer) => normalizeText(developer?.email) === normalizeText(user?.email)) || null,
    [developers, user?.email]
  );

  const scopedTickets = useMemo(() => {
    if (isDeveloper) return [];

    const base = tickets
      .filter((entry) => {
        if (normalizedRole !== "analyst") return true;
        const kind = normalizeTicketKind(entry);
        return kind !== "qa_review" && kind !== "qa_fix" && kind !== "live_ops" && kind !== "post_preview_change";
      })
      .sort(sortByPriorityThenRecent);
    if (!showOnlyMine) return base;

    const myClientIds = new Set();
    const myClientNames = new Set();

    clients.forEach((client) => {
      const inAnalystTeam = analystBelongsToClient(client, user);
      const loggedDeveloperId = String(loggedDeveloperProfile?.id || "").trim();
      const isClientSupervisorById =
        isTechSupervisor &&
        String(client.tech_supervisor_id || "").trim() &&
        (
          String(client.tech_supervisor_id || "").trim() === String(user?.id || "").trim() ||
          (loggedDeveloperId && String(client.tech_supervisor_id || "").trim() === loggedDeveloperId)
        );
      const normalizedSupervisorName = normalizeText(client.tech_supervisor_name);
      const normalizedSupervisorEmail = normalizeText(client.tech_supervisor_email);
      const isClientSupervisorByName =
        isTechSupervisor &&
        normalizedSupervisorName &&
        (
          normalizedSupervisorName === normalizeText(user?.full_name) ||
          normalizedSupervisorName === normalizeText(user?.email)
        );
      const isClientSupervisorByEmail =
        isTechSupervisor &&
        normalizedSupervisorEmail &&
        normalizedSupervisorEmail === normalizeText(user?.email);

      if (
        inAnalystTeam ||
        isClientSupervisorById ||
        isClientSupervisorByName ||
        isClientSupervisorByEmail
      ) {
        myClientIds.add(normalizeId(client.id));
        myClientNames.add(normalizeText(client.name));
      }
    });

    return base.filter((ticket) => {
      const byCreator = [ticket.created_by, ticket.created_by_email, ticket.created_by_name]
        .map(normalizeText)
        .some((creator) =>
          creator &&
          (
            creator === normalizeText(user?.email) ||
            creator === normalizeText(user?.full_name)
          )
        );
      const byClientId = ticket.client_id && myClientIds.has(normalizeId(ticket.client_id));
      const byClientName = myClientNames.has(normalizeText(ticket.client_name));
      return Boolean(byCreator || byClientId || byClientName);
    });
  }, [isDeveloper, isTechSupervisor, normalizedRole, tickets, showOnlyMine, clients, loggedDeveloperProfile?.id, user]);
  const analystSummary = useMemo(() => {
    return scopedTickets.reduce(
      (acc, ticket) => {
        const status = getTicketWorkflowStatus(ticket);
        if (status === "new") acc.new += 1;
        else if (status === "in_progress") acc.inProgress += 1;
        else if (status === "reported") acc.reported += 1;
        else if (status === "done" || status === "qa_review") acc.done += 1;
        return acc;
      },
      { new: 0, inProgress: 0, done: 0, reported: 0 }
    );
  }, [scopedTickets]);

  if (userLoading || isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-violet-600 border-t-transparent" />
      </div>
    );
  }

  if (isDeveloper) {
    const myTickets = tickets.filter(
      (ticket) => normalizeText(ticket.assignee_email) === normalizeText(user?.email)
    );
    const active = myTickets.filter((ticket) => !isTicketClosed(ticket));
    const done = myTickets.filter((ticket) => isTicketClosed(ticket));
    const myDeveloper = loggedDeveloperProfile;
    const slotManagerUrl = `${createPageUrl("Availability")}${myDeveloper?.id ? `?dev_id=${encodeURIComponent(myDeveloper.id)}` : ""}`;

    const TicketRow = ({ ticket }) => {
      const workflowStatus = getTicketWorkflowStatus(ticket);
      const status = STATUS_CONFIG[workflowStatus] || STATUS_CONFIG.new;
      const diff = DIFFICULTY_CONFIG[ticket.difficulty] || DIFFICULTY_CONFIG.medium;
      const plannedEffort = getPlannedEffortHours(ticket);
      const actualEffort = getActualEffortHours(ticket);
      const isUrgent = Boolean(ticket.urgent_requested_at);
      return (
        <Link to={createTicketDetailUrl(ticket.id, "my_tickets")}>
          <Card className="cursor-pointer border border-border bg-card shadow-sm transition-shadow hover:shadow-md">
            <CardContent className="flex items-center justify-between gap-4 p-4">
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Badge className={`${status.color} text-xs`}>{status.label}</Badge>
                  {isUrgent && (
                    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-xs font-semibold text-amber-700 dark:border-amber-500/35 dark:bg-amber-500/15 dark:text-amber-300">
                      Urgente
                    </Badge>
                  )}
                  <Badge variant="outline" className={`${diff.color} border-0 text-xs`}>{diff.label}</Badge>
                  {!plannedEffort && !isTicketClosed(ticket) && (
                    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-xs text-amber-700 dark:border-amber-500/35 dark:bg-amber-500/15 dark:text-amber-300">
                      Effort previsto mancante
                    </Badge>
                  )}
                </div>
                <p className="truncate font-medium text-foreground">{ticket.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{ticket.client_name} · {moment(ticket.created_date).fromNow()}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-sm text-muted-foreground">
                {isTicketClosed(ticket) && actualEffort > 0 && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />{actualEffort}h
                  </span>
                )}
                {!isTicketClosed(ticket) && plannedEffort > 0 && (
                  <span className="flex items-center gap-1 text-amber-600">
                    <Clock className="h-3.5 w-3.5" />~{plannedEffort}h
                  </span>
                )}
                <ArrowRight className="h-4 w-4" />
              </div>
            </CardContent>
          </Card>
        </Link>
      );
    };

    return (
      <div className="mx-auto max-w-3xl" data-tour="my-tickets-list">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
          <Link to={slotManagerUrl}>
            <Button variant="outline" className="h-9 w-full text-xs font-semibold sm:w-auto">
              <Calendar className="mr-1.5 h-3.5 w-3.5" />
              Disponibilita
            </Button>
          </Link>
        </div>

        {active.length === 0 && done.length === 0 && (
          <p className="py-16 text-center text-muted-foreground">Nessun ticket assegnato</p>
        )}

        {active.length > 0 && (
          <div className="mb-8">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">In lavorazione ({active.length})</h2>
            <div className="space-y-2">
              {active.map((ticket) => <TicketRow key={ticket.id} ticket={ticket} />)}
            </div>
          </div>
        )}

        {done.length > 0 && (
          <div>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Completati ({done.length})</h2>
            <div className="space-y-2">
              {done.map((ticket) => <TicketRow key={ticket.id} ticket={ticket} />)}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4" data-tour="my-tickets-page">
      <Card className="border border-border/70 shadow-sm" data-tour="my-tickets-scope">
        <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="app-kicker">Vista backlog</p>
            <p className="text-sm text-muted-foreground">Vista unica con filtro stato, cliente e toggle per limitare la lista ai ticket rilevanti per te.</p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card px-3 py-1.5">
            <Switch id="only-mine" checked={showOnlyMine} onCheckedChange={setShowOnlyMine} />
            <Label htmlFor="only-mine" className="cursor-pointer text-xs font-medium">
              Visualizza solo i miei
            </Label>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card className="border border-border/70 shadow-sm">
          <CardContent className="p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">New</p>
            <p className="mt-2 text-2xl font-semibold text-foreground">{analystSummary.new}</p>
            <p className="mt-1 text-xs text-muted-foreground">Ticket nuovi da prendere in carico</p>
          </CardContent>
        </Card>
        <Card className="border border-border/70 shadow-sm">
          <CardContent className="p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">In progress</p>
            <p className="mt-2 text-2xl font-semibold text-foreground">{analystSummary.inProgress}</p>
            <p className="mt-1 text-xs text-muted-foreground">Ticket aperti in lavorazione</p>
          </CardContent>
        </Card>
        <Card className="border border-border/70 shadow-sm">
          <CardContent className="p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Done</p>
            <p className="mt-2 text-2xl font-semibold text-foreground">{analystSummary.done}</p>
            <p className="mt-1 text-xs text-muted-foreground">Ticket chiusi senza report finale</p>
          </CardContent>
        </Card>
        <Card className="border border-border/70 shadow-sm">
          <CardContent className="p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Reported</p>
            <p className="mt-2 text-2xl font-semibold text-foreground">{analystSummary.reported}</p>
            <p className="mt-1 text-xs text-muted-foreground">Ticket con report salvato</p>
          </CardContent>
        </Card>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden" data-tour="my-tickets-list">
        <BacklogTable
          tickets={scopedTickets}
          clients={clients}
          developers={developers}
          showPriorityScore={false}
          fillHeight
          showTypeColumn={false}
          showPlanningStartColumn
          showDifficultyFilter={false}
          showLiveStateFilter
          defaultSortField="planning_start"
          defaultSortDir={1}
          detailFromPage="my_tickets"
        />
      </div>
    </div>
  );
}
