import React, { useMemo } from "react";
import { appClient } from "@/api/appClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LayoutGrid, List, Users, Ticket, Clock, Search, CheckCircle2, Zap } from "lucide-react";
import {
  compareTicketsByPriority,
  getEffectivePriorityScore,
  getTicketWorkflowStatus,
  isClosedStatus,
  isSchedulableTicket,
  isTicketClosed,
  normalizeTicketStatus,
} from "../components/shared/priorityUtils";

import BacklogTable from "../components/dashboard/BacklogTable";
import KanbanBoard from "../components/pipeline/KanbanBoard";
import CapacityBoard from "../components/capacity/CapacityBoard";
import { buildWeeklyRebalanceUpdates, getDynamicRebalanceOptions } from "./DevPipeline";
import moment from "moment";
import { useCurrentUser } from "../components/shared/useCurrentUser";
import usePersistedState from "../components/shared/usePersistedState";

const DAY_END = 18;

function roundHalf(value) {
  return Math.round(value * 2) / 2;
}

function ceilHalf(value) {
  return Math.ceil((Number(value) || 0) * 2) / 2;
}

function timeToDecimal(value) {
  if (!value) return null;
  const [h, m] = String(value).split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h + m / 60;
}

function decimalToTime(value) {
  const normalized = roundHalf(value);
  const h = Math.floor(normalized);
  const m = Math.round((normalized - h) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function compareSegments(a, b) {
  if (a.date !== b.date) return String(a.date).localeCompare(String(b.date));
  if (a.start !== b.start) return a.start - b.start;
  return a.end - b.end;
}

function normalizeSegments(segments = []) {
  if (!Array.isArray(segments) || segments.length === 0) return [];

  const groupedByDate = new Map();
  segments.forEach((segment) => {
    const date = String(segment?.date || "");
    const start = Number(segment?.start);
    const end = Number(segment?.end);
    if (!date || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
    if (!groupedByDate.has(date)) groupedByDate.set(date, []);
    groupedByDate.get(date).push({ start, end });
  });

  const normalized = [];
  [...groupedByDate.keys()]
    .sort((a, b) => a.localeCompare(b))
    .forEach((date) => {
      const items = groupedByDate.get(date).sort((a, b) => a.start - b.start);
      const merged = [];

      items.forEach((item) => {
        const last = merged[merged.length - 1];
        if (!last || item.start > last.end) {
          merged.push({ ...item });
          return;
        }
        last.end = Math.max(last.end, item.end);
      });

      merged.forEach((item) => {
        normalized.push({
          date,
          start: roundHalf(item.start),
          end: roundHalf(item.end),
        });
      });
    });

  return normalized.sort(compareSegments);
}

function getTicketSegments(ticket) {
  const segments = [];

  const append = (date, startTime, endTime) => {
    const start = timeToDecimal(startTime);
    const end = timeToDecimal(endTime);
    if (!date || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
    segments.push({ date: String(date), start: roundHalf(start), end: roundHalf(end) });
  };

  append(ticket?.scheduled_date, ticket?.start_time, ticket?.end_time);
  (ticket?.continuation_schedule || []).forEach((segment) =>
    append(segment?.date, segment?.start_time, segment?.end_time)
  );

  return normalizeSegments(segments);
}

function schedulePayloadFromSegments(segments = []) {
  const normalizedSegments = normalizeSegments(segments);
  if (!normalizedSegments.length) {
    return {
      scheduled_date: null,
      start_time: null,
      end_time: null,
      continuation_schedule: [],
    };
  }

  const [first, ...rest] = normalizedSegments;
  return {
    scheduled_date: first.date,
    start_time: decimalToTime(first.start),
    end_time: decimalToTime(first.end),
    continuation_schedule: rest.map((segment) => ({
      date: segment.date,
      start_time: decimalToTime(segment.start),
      end_time: decimalToTime(segment.end),
    })),
  };
}

function buildDoneScheduleSnapshot(ticket, completionDate, completionTime) {
  const completionDecimalRaw = timeToDecimal(completionTime);
  const completionDecimal = Number.isFinite(completionDecimalRaw)
    ? Math.min(DAY_END, ceilHalf(completionDecimalRaw))
    : null;
  if (!completionDate || !Number.isFinite(completionDecimal)) return null;

  const sourceSegments = getTicketSegments(ticket);
  if (sourceSegments.length === 0) return null;

  const completed = [];

  for (const segment of sourceSegments) {
    if (segment.date < completionDate) {
      completed.push(segment);
      continue;
    }
    if (segment.date > completionDate) break;
    if (completionDecimal <= segment.start) break;

    const cappedEnd = roundHalf(Math.min(segment.end, completionDecimal));
    if (cappedEnd > segment.start) {
      completed.push({ ...segment, end: cappedEnd });
    }
    if (completionDecimal < segment.end) break;
  }

  const completedSameDay = completed.filter((segment) => segment.date === completionDate);
  if (completedSameDay.length > 0) {
    const lastEnd = Math.max(...completedSameDay.map((segment) => segment.end));
    const extendedEnd = roundHalf(Math.min(DAY_END, completionDecimal));
    if (extendedEnd > lastEnd) {
      completed.push({
        date: completionDate,
        start: lastEnd,
        end: extendedEnd,
      });
    }
  }

  if (completed.length === 0) return null;

  const effort = roundHalf(completed.reduce((sum, segment) => sum + (segment.end - segment.start), 0));
  return {
    ...schedulePayloadFromSegments(completed),
    effort_hours: effort > 0 ? effort : undefined,
  };
}

function getNowInRome() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const time = `${byType.hour}:${byType.minute}`;
  const decimalRaw = timeToDecimal(time);
  const decimalRoundedUp = Number.isFinite(decimalRaw)
    ? Math.min(DAY_END, ceilHalf(decimalRaw))
    : null;
  return {
    date: `${byType.year}-${byType.month}-${byType.day}`,
    time,
    roundedTime: Number.isFinite(decimalRoundedUp) ? decimalToTime(decimalRoundedUp) : time,
    roundedDecimal: decimalRoundedUp,
  };
}

function SummaryChip({ icon: Icon, label, value }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/90 px-3 py-1.5 shadow-[var(--shadow-soft)]">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      <span className="text-xs font-semibold text-foreground">{value}</span>
    </div>
  );
}

export default function Dashboard() {
  const [activeTab, setActiveTab] = usePersistedState("dashboard:activeTab", "kanban");
  const queryClient = useQueryClient();
  const { isAdmin } = useCurrentUser();

  const { data: tickets = [] } = useQuery({
    queryKey: ["tickets"],
    queryFn: () =>
      appClient.entities.Ticket
        .list()
        .then((items) => [...items].sort(compareTicketsByPriority).slice(0, 200)),
  });

  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: () => appClient.entities.Client.list(),
  });

  const { data: developers = [] } = useQuery({
    queryKey: ["developers"],
    queryFn: () => appClient.entities.Developer.list(),
  });

  const dashboardMetrics = useMemo(() => {
    const openTickets = tickets.filter((t) => !isTicketClosed(t)).length;
    const inProgress = tickets.filter((t) => getTicketWorkflowStatus(t) === "in_progress").length;
    const qaReview = tickets.filter((t) => getTicketWorkflowStatus(t) === "qa_review").length;
    const doneThisWeek = tickets.filter((t) => {
      if (!isTicketClosed(t)) return false;
      const updated = new Date(t.updated_date);
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      return updated >= weekAgo;
    }).length;

    const schedulableTickets = tickets.filter((t) => isSchedulableTicket(t));
    const avgScore = schedulableTickets.length > 0
      ? Math.round(
          schedulableTickets.reduce((sum, t) => sum + getEffectivePriorityScore(t), 0) / schedulableTickets.length
        )
      : 0;

    const activeDevs = developers.filter((dev) => dev.active !== false).length;
    const activeWork = inProgress + qaReview;
    const occupancyPct = openTickets > 0 ? Math.round((activeWork / openTickets) * 100) : 0;

    return {
      openTickets,
      inProgress,
      qaReview,
      doneThisWeek,
      avgScore,
      activeDevs,
      activeWork,
      occupancyPct,
    };
  }, [tickets, developers]);

  const handleStatusChange = async (ticketId, newStatus, ticket) => {
    const previousStatus = normalizeTicketStatus(ticket.status);
    const auditEntry = {
      timestamp: new Date().toISOString(),
      user: "system",
      action: "status_change",
      details: `Status changed from ${previousStatus} to ${newStatus}`,
    };

    const isCompletion = isClosedStatus(newStatus);
    const nowInRome = isCompletion ? getNowInRome() : null;
    const doneSnapshot = isCompletion
      ? buildDoneScheduleSnapshot(ticket, nowInRome?.date, nowInRome?.roundedTime || nowInRome?.time)
      : null;

    let doneFallback = {};
    if (isCompletion && !doneSnapshot) {
      const nowDec = timeToDecimal(nowInRome?.time);
      const startDec = timeToDecimal(ticket.start_time);
      const effectiveNowDec = Number.isFinite(nowInRome?.roundedDecimal) ? nowInRome.roundedDecimal : nowDec;
      const rawEffort = Number.isFinite(effectiveNowDec) && Number.isFinite(startDec)
        ? roundHalf(effectiveNowDec - startDec)
        : null;
      doneFallback = {
        end_time: nowInRome?.roundedTime || nowInRome?.time || null,
        continuation_schedule: [],
        ...(rawEffort && rawEffort > 0 ? { effort_hours: rawEffort } : {}),
      };
    }

    await appClient.entities.Ticket.update(ticketId, {
      status: newStatus,
      ...(newStatus === "blocked"
        ? {
            scheduled_date: null,
            start_time: null,
            end_time: null,
            continuation_schedule: [],
          }
        : {}),
      ...(doneSnapshot || doneFallback),
      audit_log: [...(ticket.audit_log || []), auditEntry],
    });

    if (ticket.assignee_id) {
      const latestTickets = await appClient.entities.Ticket.list();
      const dev = developers.find((d) => d.id === ticket.assignee_id) || null;
      const rebalanceOptions = isCompletion
        ? getDynamicRebalanceOptions({
            includeTodayHoles: true,
            planningStartDate: moment().format("YYYY-MM-DD"),
            freezeCurrentWeekSegments: false,
            preserveTodaySegments: false,
          })
        : getDynamicRebalanceOptions();
      const updates = buildWeeklyRebalanceUpdates(
        latestTickets,
        ticket.assignee_id,
        dev,
        rebalanceOptions
      );
      if (updates.length > 0) {
        await Promise.all(
          updates.map((entry) => appClient.entities.Ticket.update(entry.id, entry.updates))
        );
      }
    }

    // Send email when ticket reaches a completion state.
    if (isCompletion && ticket.created_by) {
      appClient.integrations.Core.SendEmail({
        to: ticket.created_by,
        subject: `Ticket completato/review: ${ticket.title}`,
        body: `Il ticket "${ticket.title}" per ${ticket.client_name || "N/A"} è stato concluso con stato ${newStatus}.`,
      }).catch(() => {});
    }

    queryClient.invalidateQueries({ queryKey: ["tickets"] });
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-6" data-tour="dashboard-page">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 min-h-0 flex flex-col" data-tour="dashboard-workbench">
        <TabsList className="w-fit self-start" data-tour="dashboard-tabs">
          <TabsTrigger value="kanban" className="gap-1.5 text-xs">
            <LayoutGrid className="w-3.5 h-3.5" /> Pipeline
          </TabsTrigger>
          <TabsTrigger value="backlog" className="gap-1.5 text-xs">
            <List className="w-3.5 h-3.5" /> Backlog
          </TabsTrigger>
          <TabsTrigger value="capacity" className="gap-1.5 text-xs">
            <Users className="w-3.5 h-3.5" /> Capacity
          </TabsTrigger>
        </TabsList>
        <TabsContent value="kanban" className="mt-4 flex-1 min-h-0 overflow-hidden">
          <div className="flex h-full min-h-0 flex-col gap-4">
            <div className="app-surface bg-muted/35 p-3">
              <div className="flex flex-wrap gap-2.5">
                <SummaryChip icon={LayoutGrid} label="Occupazione" value={`${dashboardMetrics.occupancyPct}%`} />
                <SummaryChip icon={Ticket} label="Open" value={dashboardMetrics.openTickets} />
                <SummaryChip icon={Zap} label="In progress" value={dashboardMetrics.inProgress} />
                <SummaryChip icon={Search} label="QA / Review" value={dashboardMetrics.qaReview} />
                <SummaryChip icon={CheckCircle2} label="Done 7d" value={dashboardMetrics.doneThisWeek} />
                {isAdmin && <SummaryChip icon={Clock} label="Avg priority" value={dashboardMetrics.avgScore} />}
                <SummaryChip icon={Users} label="Dev attivi" value={dashboardMetrics.activeDevs} />
              </div>
            </div>

            <KanbanBoard tickets={tickets} onStatusChange={handleStatusChange} showPriorityScore={isAdmin} />
          </div>
        </TabsContent>
        <TabsContent value="backlog" className="mt-4 flex-1 min-h-0 overflow-auto">
          <BacklogTable tickets={tickets} clients={clients} developers={developers} showPriorityScore={isAdmin} detailFromPage="dashboard" />
        </TabsContent>
        <TabsContent value="capacity" className="mt-4 flex-1 min-h-0 overflow-auto">
          <CapacityBoard developers={developers} tickets={tickets} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
