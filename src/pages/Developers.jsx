import React, { useMemo, useState } from "react";
import { appClient } from "@/api/appClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Plus, Pencil, Trash2, Calendar, BarChart3, Briefcase, Users, ListTodo } from "lucide-react";
import { Link, Navigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { isOpenStatus } from "../components/shared/priorityUtils";
import moment from "moment";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/components/shared/useCurrentUser";
import {
  normalizeRecurringAvailabilityRule,
  recurringRuleMatchesDate,
} from "@/lib/recurringAvailability";

const WORK_DAY_START = 9;
const WORK_DAY_END = 18;
const DEFAULT_DAILY_CAPACITY = 8;
const BUSINESS_DAYS_PER_WEEK = 5;
const RANGE_PRESETS = [
  { id: "7d", label: "7g", days: 7 },
  { id: "30d", label: "30g", days: 30 },
  { id: "90d", label: "90g", days: 90 },
  { id: "180d", label: "180g", days: 180 },
  { id: "custom", label: "Personalizzato", days: null },
];
const DEVELOPER_ROLE_OPTIONS = [
  { value: "developer", label: "Developer" },
  { value: "tech_supervisor", label: "Tech supervisor" },
];

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeDeveloperAppRole(value) {
  return value === "tech_supervisor" ? "tech_supervisor" : "developer";
}

function getDeveloperRoleMeta(role) {
  if (normalizeDeveloperAppRole(role) === "tech_supervisor") {
    return {
      label: "Tech supervisor",
      badgeClass: "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/35",
    };
  }

  return {
    label: "Developer",
    badgeClass: "bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-500/15 dark:text-slate-200 dark:border-slate-500/35",
  };
}

function roundHalf(value) {
  return Math.round((Number(value) || 0) * 2) / 2;
}

function formatHours(value) {
  const rounded = Math.round((Number(value) || 0) * 10) / 10;
  if (Number.isInteger(rounded)) return `${rounded}`;
  return rounded.toFixed(1);
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "0%";
  return `${(Math.round(value * 10) / 10).toFixed(1)}%`;
}

function normalizeDate(value) {
  const parsed = moment(value, "YYYY-MM-DD", true);
  return parsed.isValid() ? parsed.format("YYYY-MM-DD") : null;
}

function timeToDecimal(value) {
  if (!value) return null;
  const [h, m] = String(value).split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h + m / 60;
}

function durationHours(start, end) {
  const safeStart = Number(start);
  const safeEnd = Number(end);
  if (!Number.isFinite(safeStart) || !Number.isFinite(safeEnd) || safeEnd <= safeStart) return 0;
  return roundHalf(safeEnd - safeStart);
}

function clipToWorkWindow(startRaw, endRaw) {
  const start = Math.max(WORK_DAY_START, Math.min(WORK_DAY_END, startRaw));
  const end = Math.max(WORK_DAY_START, Math.min(WORK_DAY_END, endRaw));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { start: roundHalf(start), end: roundHalf(end) };
}

function mergeIntervals(intervals = []) {
  const sorted = intervals
    .filter((slot) => Number.isFinite(slot.start) && Number.isFinite(slot.end) && slot.end > slot.start)
    .sort((a, b) => a.start - b.start);

  const merged = [];
  sorted.forEach((slot) => {
    const last = merged[merged.length - 1];
    if (!last || slot.start > last.end) {
      merged.push({ start: slot.start, end: slot.end });
      return;
    }
    last.end = Math.max(last.end, slot.end);
  });
  return merged;
}

function getBusinessDaysInRange(startDate, endDate) {
  const start = moment(startDate, "YYYY-MM-DD", true);
  const end = moment(endDate, "YYYY-MM-DD", true);
  if (!start.isValid() || !end.isValid() || start.isAfter(end, "day")) return [];

  const days = [];
  let cursor = start.clone();
  while (cursor.isSameOrBefore(end, "day")) {
    if (cursor.isoWeekday() <= 5) {
      days.push(cursor.format("YYYY-MM-DD"));
    }
    cursor.add(1, "day");
  }
  return days;
}

function toWeeklyAverage(totalValue, businessDaysCount) {
  const safeDays = Number(businessDaysCount) || 0;
  if (safeDays <= 0) return 0;
  const weeks = safeDays / BUSINESS_DAYS_PER_WEEK;
  if (!Number.isFinite(weeks) || weeks <= 0) return 0;
  return Number(totalValue || 0) / weeks;
}

function FilterChip({
  selected = false,
  onClick,
  children,
  className = "",
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-2 rounded-full border px-2.5 text-xs font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/80 focus-visible:ring-offset-2",
        selected
          ? "border-primary/35 bg-primary/15 text-foreground dark:border-primary/55 dark:bg-primary/20"
          : "border-border bg-background text-muted-foreground hover:border-border/80 hover:text-foreground",
        className
      )}
    >
      {children}
    </button>
  );
}

function getTicketSegments(ticket) {
  const segments = [];

  const appendSegment = (date, startTime, endTime) => {
    const normalizedDate = normalizeDate(date);
    const startRaw = timeToDecimal(startTime);
    const endRaw = timeToDecimal(endTime);
    const clipped = clipToWorkWindow(startRaw, endRaw);
    if (!normalizedDate || !clipped) return;
    segments.push({
      date: normalizedDate,
      start: clipped.start,
      end: clipped.end,
      hours: durationHours(clipped.start, clipped.end),
    });
  };

  appendSegment(ticket?.scheduled_date, ticket?.start_time, ticket?.end_time);
  (ticket?.continuation_schedule || []).forEach((slot) => {
    appendSegment(slot?.date, slot?.start_time, slot?.end_time);
  });

  return segments.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.start !== b.start) return a.start - b.start;
    return a.end - b.end;
  });
}

function buildRangeFromPreset(presetId, customFrom, customTo) {
  const today = moment().format("YYYY-MM-DD");
  if (presetId === "custom") {
    const from = normalizeDate(customFrom);
    const to = normalizeDate(customTo);
    if (from && to && from <= to) {
      return { from, to, isCustomValid: true };
    }
    return { from: customFrom || today, to: customTo || today, isCustomValid: false };
  }

  const preset = RANGE_PRESETS.find((item) => item.id === presetId) || RANGE_PRESETS[1];
  const from = moment(today).subtract((preset.days || 30) - 1, "days").format("YYYY-MM-DD");
  return { from, to: today, isCustomValid: true };
}

function getUnavailableHoursForDeveloper(dev, startDate, endDate, dailyCapacity) {
  const businessDays = getBusinessDaysInRange(startDate, endDate);
  if (businessDays.length === 0) return 0;

  const intervalsByDate = {};
  businessDays.forEach((date) => {
    intervalsByDate[date] = [];
  });

  if (Array.isArray(dev?.absences)) {
    dev.absences.forEach((absence) => {
      const date = normalizeDate(absence?.date);
      if (!date || !intervalsByDate[date]) return;
      intervalsByDate[date].push({ start: WORK_DAY_START, end: WORK_DAY_END });
    });
  }

  if (Array.isArray(dev?.unavailable_slots)) {
    dev.unavailable_slots.forEach((slot) => {
      const date = normalizeDate(slot?.date);
      if (!date || !intervalsByDate[date]) return;
      const startRaw = timeToDecimal(slot?.start_time);
      const endRaw = timeToDecimal(slot?.end_time);
      const clipped = clipToWorkWindow(startRaw, endRaw);
      if (!clipped) return;
      intervalsByDate[date].push({ start: clipped.start, end: clipped.end });
    });
  }

  const recurringSlots = Array.isArray(dev?.recurring_unavailable_slots) ? dev.recurring_unavailable_slots : [];
  if (recurringSlots.length > 0) {
    businessDays.forEach((date) => {
      recurringSlots.forEach((rule, index) => {
        const normalizedRule = normalizeRecurringAvailabilityRule(rule, index, {
          dayStart: WORK_DAY_START,
          dayEnd: WORK_DAY_END,
        });
        if (!normalizedRule || normalizedRule.active === false) return;
        if (!recurringRuleMatchesDate(normalizedRule, date)) return;

        const clipped = clipToWorkWindow(normalizedRule.start, normalizedRule.end);
        if (!clipped) return;
        intervalsByDate[date].push({ start: clipped.start, end: clipped.end });
      });
    });
  }

  return roundHalf(
    businessDays.reduce((sum, date) => {
      const merged = mergeIntervals(intervalsByDate[date] || []);
      const blocked = merged.reduce((total, slot) => total + durationHours(slot.start, slot.end), 0);
      return sum + Math.min(dailyCapacity, blocked);
    }, 0)
  );
}

export default function Developers() {
  const { isAdmin, isTechSupervisor } = useCurrentUser();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", email: "", daily_capacity: 8, active: true, app_role: "developer" });
  const [rangePreset, setRangePreset] = useState("30d");
  const [customFrom, setCustomFrom] = useState(moment().startOf("month").format("YYYY-MM-DD"));
  const [customTo, setCustomTo] = useState(moment().format("YYYY-MM-DD"));
  const [selectedDeveloperId, setSelectedDeveloperId] = useState(null);
  const canManageDevelopers = isAdmin;

  const { data: developers = [] } = useQuery({
    queryKey: ["developers"],
    queryFn: () => appClient.entities.Developer.list(),
  });

  const { data: tickets = [] } = useQuery({
    queryKey: ["tickets"],
    queryFn: () => appClient.entities.Ticket.list(),
  });

  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: () => appClient.entities.Client.list(),
  });
  const { data: users = [] } = useQuery({
    queryKey: ["users"],
    queryFn: () => appClient.entities.User.list(),
  });

  const usersByEmail = useMemo(
    () => new Map(users.map((user) => [normalizeEmail(user.email), user])),
    [users]
  );
  const getDeveloperAppRole = (dev) =>
    normalizeDeveloperAppRole(dev?.app_role || dev?.role || usersByEmail.get(normalizeEmail(dev?.email))?.app_role || usersByEmail.get(normalizeEmail(dev?.email))?.role);

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      const appRole = normalizeDeveloperAppRole(data.app_role);
      const payload = {
        ...data,
        app_role: appRole,
        role: appRole,
        daily_capacity: parseFloat(data.daily_capacity) || 8,
      };

      const savedDeveloper = editing
        ? await appClient.entities.Developer.update(editing.id, payload)
        : await appClient.entities.Developer.create(payload);

      const linkedUser = usersByEmail.get(normalizeEmail(data.email));
      if (linkedUser?.id) {
        await appClient.entities.User.update(linkedUser.id, {
          app_role: appRole,
          role: appRole,
        });
      }

      return savedDeveloper;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["developers"] });
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setOpen(false);
      setEditing(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => appClient.entities.Developer.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["developers"] }),
  });

  const dateRange = useMemo(
    () => buildRangeFromPreset(rangePreset, customFrom, customTo),
    [rangePreset, customFrom, customTo]
  );

  const ticketSegmentsById = useMemo(() => {
    const map = new Map();
    tickets.forEach((ticket) => {
      map.set(ticket.id, getTicketSegments(ticket));
    });
    return map;
  }, [tickets]);

  const rangeBusinessDays = useMemo(
    () => getBusinessDaysInRange(dateRange.from, dateRange.to),
    [dateRange.from, dateRange.to]
  );

  const rangeBusinessDaysCount = rangeBusinessDays.length;

  const assignedClientsByDeveloper = useMemo(() => {
    const map = new Map();
    developers.forEach((dev) => {
      map.set(dev.id, new Set());
    });

    clients.forEach((client) => {
      const clientLabel = client?.name || client?.id || "Cliente";

      const supervisorId = String(client?.tech_supervisor_id || "").trim();
      if (supervisorId && map.has(supervisorId)) {
        map.get(supervisorId).add(clientLabel);
      }

      const operationsIds = Array.isArray(client?.operations_ids) ? client.operations_ids : [];
      operationsIds.forEach((devId) => {
        if (map.has(devId)) {
          map.get(devId).add(clientLabel);
        }
      });
    });

    return map;
  }, [clients, developers]);

  const developerStats = useMemo(() => {
    return developers.map((dev) => {
      const assignedTickets = tickets.filter((ticket) => ticket.assignee_id === dev.id);
      const openTickets = assignedTickets.filter((ticket) => isOpenStatus(ticket.status));
      const closedTickets = assignedTickets.filter((ticket) => !isOpenStatus(ticket.status));

      let plannedHoursInRange = 0;
      let closedHoursInRange = 0;
      let scheduledTicketsInRange = 0;
      const clientsInRange = new Set();
      const assignedClients = assignedClientsByDeveloper.get(dev.id) || new Set();

      assignedTickets.forEach((ticket) => {
        const segments = ticketSegmentsById.get(ticket.id) || [];
        const inRangeSegments = segments.filter(
          (segment) => segment.date >= dateRange.from && segment.date <= dateRange.to
        );

        if (inRangeSegments.length > 0) {
          scheduledTicketsInRange += 1;
          clientsInRange.add(ticket.client_name || ticket.client_id || "Senza cliente");
          plannedHoursInRange += inRangeSegments.reduce((sum, segment) => sum + segment.hours, 0);
        }

        if (!isOpenStatus(ticket.status) && inRangeSegments.length > 0) {
          closedHoursInRange += inRangeSegments.reduce((sum, segment) => sum + segment.hours, 0);
        }
      });

      const dailyCapacity = Number(dev.daily_capacity) > 0 ? Number(dev.daily_capacity) : DEFAULT_DAILY_CAPACITY;
      const grossCapacity = roundHalf(rangeBusinessDaysCount * dailyCapacity);
      const unavailableHours = getUnavailableHoursForDeveloper(dev, dateRange.from, dateRange.to, dailyCapacity);
      const netCapacity = roundHalf(Math.max(0, grossCapacity - unavailableHours));

      const occupancy = netCapacity > 0 ? (plannedHoursInRange / netCapacity) * 100 : 0;
      const weeklyCapacity = roundHalf(dailyCapacity * BUSINESS_DAYS_PER_WEEK);
      const plannedHoursWeekly = roundHalf(toWeeklyAverage(plannedHoursInRange, rangeBusinessDaysCount));
      const unavailableHoursWeekly = roundHalf(toWeeklyAverage(unavailableHours, rangeBusinessDaysCount));
      const netCapacityWeekly = roundHalf(Math.max(0, weeklyCapacity - unavailableHoursWeekly));

      return {
        ...dev,
        openTicketsCount: openTickets.length,
        closedTicketsCount: closedTickets.length,
        scheduledTicketsInRange,
        plannedHoursInRange: roundHalf(plannedHoursInRange),
        closedHoursInRange: roundHalf(closedHoursInRange),
        grossCapacity,
        unavailableHours,
        netCapacity,
        weeklyCapacity,
        plannedHoursWeekly,
        unavailableHoursWeekly,
        netCapacityWeekly,
        occupancyPct: occupancy,
        occupancyBar: Math.max(0, Math.min(100, occupancy)),
        assignedClientsCount: assignedClients.size,
        clientsInRangeCount: clientsInRange.size,
        assignedClients: Array.from(assignedClients),
      };
    });
  }, [developers, tickets, ticketSegmentsById, dateRange.from, dateRange.to, rangeBusinessDaysCount, assignedClientsByDeveloper]);

  const visibleDeveloperStats = useMemo(() => {
    if (!selectedDeveloperId) return developerStats;
    return developerStats.filter((dev) => dev.id === selectedDeveloperId);
  }, [developerStats, selectedDeveloperId]);

  const teamStats = useMemo(() => {
    const totals = {
      netCapacity: 0,
      plannedHours: 0,
      unavailable: 0,
      openTickets: 0,
      scheduledTickets: 0,
    };
    const teamClients = new Set();

    visibleDeveloperStats.forEach((dev) => {
      if (dev.active !== false) {
        totals.netCapacity += dev.netCapacity;
        totals.plannedHours += dev.plannedHoursInRange;
        totals.unavailable += dev.unavailableHours;
      }
      totals.openTickets += dev.openTicketsCount;
      totals.scheduledTickets += dev.scheduledTicketsInRange;
      (dev.assignedClients || []).forEach((clientName) => teamClients.add(clientName));
    });

    const occupancyPct = totals.netCapacity > 0 ? (totals.plannedHours / totals.netCapacity) * 100 : 0;
    const activeDevs = visibleDeveloperStats.filter((dev) => dev.active !== false).length;

    return {
      activeDevs,
      occupancyPct,
      plannedHours: roundHalf(totals.plannedHours),
      plannedHoursWeekly: roundHalf(toWeeklyAverage(totals.plannedHours, rangeBusinessDaysCount)),
      netCapacity: roundHalf(totals.netCapacity),
      netCapacityWeekly: roundHalf(toWeeklyAverage(totals.netCapacity, rangeBusinessDaysCount)),
      unavailableHours: roundHalf(totals.unavailable),
      unavailableHoursWeekly: roundHalf(toWeeklyAverage(totals.unavailable, rangeBusinessDaysCount)),
      openTickets: totals.openTickets,
      projects: teamClients.size,
      scheduledTickets: totals.scheduledTickets,
    };
  }, [visibleDeveloperStats, rangeBusinessDaysCount]);

  const selectedDeveloper = useMemo(
    () => developers.find((dev) => dev.id === selectedDeveloperId) || null,
    [developers, selectedDeveloperId]
  );

  const openEdit = (dev) => {
    setEditing(dev);
    setForm({
      name: dev.name,
      email: dev.email,
      daily_capacity: dev.daily_capacity || 8,
      active: dev.active !== false,
      app_role: getDeveloperAppRole(dev),
    });
    setOpen(true);
  };

  const openNew = () => {
    setEditing(null);
    setForm({ name: "", email: "", daily_capacity: 8, active: true, app_role: "developer" });
    setOpen(true);
  };

  if (!isAdmin && !isTechSupervisor) {
    return <Navigate to={createPageUrl("DevPipeline")} replace />;
  }

  return (
    <div className="space-y-6">
      <Card className="border border-border/70 shadow-sm">
        <CardContent className="p-5 space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground font-semibold">Statistiche developer</p>
              <h3 className="text-base font-semibold">
                {selectedDeveloper ? `Focus: ${selectedDeveloper.name}` : "Occupazione team e progetti assegnati"}
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                Range attivo: {dateRange.from} - {dateRange.to} ({rangeBusinessDaysCount} gg lavorativi)
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {RANGE_PRESETS.map((preset) => (
                <FilterChip
                  key={preset.id}
                  selected={rangePreset === preset.id}
                  onClick={() => setRangePreset(preset.id)}
                >
                  {preset.label}
                </FilterChip>
              ))}
            </div>
          </div>

          {rangePreset === "custom" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[180px_180px_1fr] gap-3 items-end">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground">Da</Label>
                <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground">A</Label>
                <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-9" />
              </div>
              {!dateRange.isCustomValid && (
                <p className="text-xs text-red-500">
                  Range non valido: imposta una data iniziale minore o uguale alla data finale.
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-xl border border-border/70 bg-card px-3.5 py-3">
              <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                <BarChart3 className="w-3.5 h-3.5" /> Occupazione media
              </p>
              <p className="mt-1 text-xl font-semibold">{formatPercent(teamStats.occupancyPct)}</p>
              <p className="text-[11px] text-muted-foreground">
                {formatHours(teamStats.plannedHoursWeekly)}h / {formatHours(teamStats.netCapacityWeekly)}h settimana
              </p>
            </div>

            <div className="rounded-xl border border-border/70 bg-card px-3.5 py-3">
              <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                <Briefcase className="w-3.5 h-3.5" /> Clienti assegnati
              </p>
              <p className="mt-1 text-xl font-semibold">{teamStats.projects}</p>
              <p className="text-[11px] text-muted-foreground">da supervisor + operations</p>
            </div>

            <div className="rounded-xl border border-border/70 bg-card px-3.5 py-3">
              <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                <ListTodo className="w-3.5 h-3.5" /> Ticket pianificati
              </p>
              <p className="mt-1 text-xl font-semibold">{teamStats.scheduledTickets}</p>
              <p className="text-[11px] text-muted-foreground">nel range selezionato</p>
            </div>

            <div className="rounded-xl border border-border/70 bg-card px-3.5 py-3">
              <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" /> Team attivo
              </p>
              <p className="mt-1 text-xl font-semibold">{teamStats.activeDevs}</p>
              <p className="text-[11px] text-muted-foreground">{formatHours(teamStats.unavailableHoursWeekly)}h indisponibili settimana</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <FilterChip
              selected={!selectedDeveloper}
              onClick={() => setSelectedDeveloperId(null)}
            >
              Tutti i developer
            </FilterChip>
            {developers.map((dev) => (
              <FilterChip
                key={`dev-filter-${dev.id}`}
                selected={selectedDeveloperId === dev.id}
                onClick={() => setSelectedDeveloperId(dev.id)}
              >
                {dev.name}
              </FilterChip>
            ))}
          </div>
        </CardContent>
      </Card>

      {canManageDevelopers && (
        <div className="flex items-center justify-end">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button onClick={openNew} className="h-9 text-sm">
                <Plus className="w-4 h-4 mr-1.5" /> Aggiungi
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editing ? "Modifica developer" : "Nuovo developer"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-gray-600">Nome *</Label>
                  <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Nome completo" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-gray-600">Email *</Label>
                  <Input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="dev@company.com" type="email" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-gray-600">Capacita giornaliera (ore)</Label>
                  <Input type="number" value={form.daily_capacity} onChange={e => setForm({ ...form, daily_capacity: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-gray-600">Ruolo app</Label>
                  <Select value={normalizeDeveloperAppRole(form.app_role)} onValueChange={(value) => setForm({ ...form, app_role: normalizeDeveloperAppRole(value) })}>
                    <SelectTrigger className="h-10">
                      <SelectValue placeholder="Seleziona ruolo" />
                    </SelectTrigger>
                    <SelectContent>
                      {DEVELOPER_ROLE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    Il tech supervisor puo vedere tutte le pipeline dev e gestire i ticket dei clienti che supervisiona.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Switch checked={form.active} onCheckedChange={v => setForm({ ...form, active: v })} />
                  <Label className="text-sm">Attivo</Label>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setOpen(false)}>Annulla</Button>
                  <Button onClick={() => saveMutation.mutate(form)} disabled={!form.name || !form.email || saveMutation.isPending}>
                    {editing ? "Salva" : "Crea"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {developerStats.map((dev) => {
          const isFilteredOut = selectedDeveloperId && selectedDeveloperId !== dev.id;
          const loadLabel = `${formatHours(dev.plannedHoursWeekly)}h / ${formatHours(dev.netCapacityWeekly)}h`;
          const roleMeta = getDeveloperRoleMeta(getDeveloperAppRole(dev));
          const activeBadgeClass = dev.active !== false
            ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/35"
            : "bg-muted text-muted-foreground border-border";

          return (
            <Card
              key={dev.id}
              onClick={() => setSelectedDeveloperId((current) => (current === dev.id ? null : dev.id))}
              className={`border border-border/70 shadow-sm hover:shadow-md transition-all cursor-pointer ${dev.active === false ? "opacity-60" : ""} ${selectedDeveloperId === dev.id ? "ring-2 ring-violet-400/60" : ""} ${isFilteredOut ? "opacity-45" : ""}`}
            >
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <Avatar className="w-10 h-10">
                      <AvatarFallback className="text-sm font-bold bg-gradient-to-br from-violet-500 to-purple-600 text-white">
                        {dev.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-semibold text-sm">{dev.name}</p>
                      <p className="text-[11px] text-muted-foreground">{dev.email}</p>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Link to={`${createPageUrl("Availability")}?dev_id=${encodeURIComponent(dev.id)}`} onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Disponibilita" onClick={(e) => e.stopPropagation()}>
                        <Calendar className="w-3 h-3 text-muted-foreground" />
                      </Button>
                    </Link>
                    {canManageDevelopers && (
                      <>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); openEdit(dev); }}>
                          <Pencil className="w-3 h-3 text-muted-foreground" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(dev.id); }}>
                          <Trash2 className="w-3 h-3 text-muted-foreground" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="outline" className={`text-[10px] ${roleMeta.badgeClass}`}>
                      {roleMeta.label}
                    </Badge>
                    <Badge variant="outline" className={`text-[10px] ${activeBadgeClass}`}>
                      {dev.active !== false ? "Attivo" : "Inattivo"}
                    </Badge>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-muted-foreground">Occupazione media settimana</span>
                    <span className="font-semibold">{loadLabel}</span>
                  </div>
                  <Progress value={dev.occupancyBar} className="h-1.5" />
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{formatPercent(dev.occupancyPct)}</span>
                    {dev.occupancyPct > 100 ? (
                      <span className="text-red-500 font-medium">Overbooked</span>
                    ) : (
                      <span>{formatHours(dev.unavailableHoursWeekly)}h bloccate settimana</span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div className="rounded-lg border border-border/70 bg-muted/40 px-2.5 py-2">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Clienti</p>
                      <p className="text-sm font-semibold">{dev.assignedClientsCount}</p>
                    </div>
                    <div className="rounded-lg border border-border/70 bg-muted/40 px-2.5 py-2">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Open ticket</p>
                      <p className="text-sm font-semibold">{dev.openTicketsCount}</p>
                    </div>
                    <div className="rounded-lg border border-border/70 bg-muted/40 px-2.5 py-2">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Pianificati</p>
                      <p className="text-sm font-semibold">{dev.scheduledTicketsInRange}</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {developers.length === 0 && (
          <Card className="col-span-full border border-border/70 shadow-sm">
            <CardContent className="py-12 text-center text-muted-foreground">Nessun developer presente. Inizia con il primo.</CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
