import React, { useMemo, useState } from "react";
import { appClient } from "@/api/appClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, Building2, X, BarChart3, Clock3, Ticket } from "lucide-react";
import { Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ComposedChart, Line } from "recharts";
import moment from "moment";
import { DEFAULT_CONFIG, getIndustryOptions, isOpenStatus, normalizeClientTier } from "../components/shared/priorityUtils";
import { useCurrentUser } from "../components/shared/useCurrentUser";
import { isTechSupervisorRole } from "@/utils";

const TIER_COLORS = {
  P1: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  P2: "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
  P3: "bg-yellow-100 text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-300",
};
const DEFAULT_CLIENT_COLOR = "#6366f1";
const RANGE_PRESETS = [
  { id: "30d", label: "30g", days: 30 },
  { id: "90d", label: "90g", days: 90 },
  { id: "180d", label: "180g", days: 180 },
  { id: "365d", label: "12m", days: 365 },
  { id: "custom", label: "Personalizzato", days: null },
];
const TIER_OPTIONS = ["P1", "P2", "P3"];
const CHART_TEXT_COLOR = "hsl(var(--foreground))";

function normalizeClientColor(value) {
  return /^#[0-9A-Fa-f]{6}$/.test(value || "") ? value : DEFAULT_CLIENT_COLOR;
}

function normalizeDate(value) {
  if (!value) return null;
  const strict = moment(value, "YYYY-MM-DD", true);
  if (strict.isValid()) return strict.format("YYYY-MM-DD");
  const parsed = moment(value);
  return parsed.isValid() ? parsed.format("YYYY-MM-DD") : null;
}

function timeToDecimal(value) {
  if (!value) return null;
  const [h, m] = String(value).split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h + m / 60;
}

function roundHalf(value) {
  return Math.round((Number(value) || 0) * 2) / 2;
}

function formatHours(value) {
  const rounded = Math.round((Number(value) || 0) * 10) / 10;
  if (Number.isInteger(rounded)) return `${rounded}h`;
  return `${rounded.toFixed(1)}h`;
}

function inDateRange(dateStr, from, to) {
  if (!dateStr) return false;
  return dateStr >= from && dateStr <= to;
}

function buildDateRange(rangePreset, customFrom, customTo) {
  const today = moment().format("YYYY-MM-DD");
  if (rangePreset === "custom") {
    const from = normalizeDate(customFrom);
    const to = normalizeDate(customTo);
    if (from && to && from <= to) return { from, to, valid: true };
    return { from: customFrom || today, to: customTo || today, valid: false };
  }

  const preset = RANGE_PRESETS.find((item) => item.id === rangePreset) || RANGE_PRESETS[1];
  const from = moment(today).subtract((preset.days || 90) - 1, "days").format("YYYY-MM-DD");
  return { from, to: today, valid: true };
}

function buildTicketSegments(ticket) {
  const segments = [];

  const append = (date, startTime, endTime) => {
    const normalizedDate = normalizeDate(date);
    const start = timeToDecimal(startTime);
    const end = timeToDecimal(endTime);
    if (!normalizedDate || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
    segments.push({
      date: normalizedDate,
      hours: roundHalf(end - start),
    });
  };

  append(ticket?.scheduled_date, ticket?.start_time, ticket?.end_time);
  (ticket?.continuation_schedule || []).forEach((segment) =>
    append(segment?.date, segment?.start_time, segment?.end_time)
  );

  return segments;
}

function shortClientName(name = "") {
  if (name.length <= 16) return name;
  return `${name.slice(0, 16)}…`;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function resolveDeveloperAppRole(developer, usersByEmail) {
  return developer?.app_role || developer?.role || usersByEmail.get(normalizeEmail(developer?.email))?.app_role || usersByEmail.get(normalizeEmail(developer?.email))?.role || "developer";
}

function FilterChip({ selected, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors ${
        selected
          ? "border-primary/35 bg-primary/15 text-foreground dark:border-primary/55 dark:bg-primary/20"
          : "border-border bg-background text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

export default function Clients() {
  const queryClient = useQueryClient();
  const { user, isAdmin, isAnalyst, isDeveloper, isTechSupervisor } = useCurrentUser();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [rangePreset, setRangePreset] = useState("90d");
  const [customFrom, setCustomFrom] = useState(moment().startOf("month").format("YYYY-MM-DD"));
  const [customTo, setCustomTo] = useState(moment().format("YYYY-MM-DD"));
  const [form, setForm] = useState({
    name: "",
    commessa: "",
    industry: "",
    priority_tier: "P3",
    color: DEFAULT_CLIENT_COLOR,
    notes: "",
    tech_supervisor_id: "",
    operations_ids: [],
    analyst_team_ids: [],
  });

  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: () => appClient.entities.Client.list(),
  });

  const { data: developers = [] } = useQuery({
    queryKey: ["developers"],
    queryFn: () => appClient.entities.Developer.list(),
  });

  const { data: users = [] } = useQuery({
    queryKey: ["users"],
    queryFn: () => appClient.entities.User.list(),
  });

  const { data: tickets = [] } = useQuery({
    queryKey: ["tickets"],
    queryFn: () => appClient.entities.Ticket.list(),
  });
  const { data: configList = [] } = useQuery({
    queryKey: ["priority_config"],
    queryFn: () => appClient.entities.PriorityConfig.list(),
  });
  const industryOptions = useMemo(
    () => getIndustryOptions(configList[0] || DEFAULT_CONFIG),
    [configList]
  );
  const industrySelectOptions = useMemo(() => {
    const current = String(form.industry || "").trim();
    return current && !industryOptions.includes(current)
      ? [...industryOptions, current]
      : industryOptions;
  }, [industryOptions, form.industry]);

  const analystUsers = useMemo(
    () =>
      users.filter((user) => {
        const role = user?.app_role || user?.role || "user";
        return role === "analyst" || role === "admin";
      }),
    [users]
  );
  const usersByEmail = useMemo(
    () => new Map(users.map((user) => [normalizeEmail(user.email), user])),
    [users]
  );
  const techSupervisorDevelopers = useMemo(() => {
    return developers.filter((developer) => {
      if (developer?.active === false) return false;
      return isTechSupervisorRole(resolveDeveloperAppRole(developer, usersByEmail));
    });
  }, [developers, usersByEmail]);
  const techSupervisorOptions = useMemo(() => {
    const currentSupervisorId = String(form.tech_supervisor_id || "").trim();
    if (!currentSupervisorId) return techSupervisorDevelopers;
    const legacyCurrentSupervisor = developers.find((developer) => developer.id === currentSupervisorId);
    if (!legacyCurrentSupervisor) return techSupervisorDevelopers;
    if (techSupervisorDevelopers.some((developer) => developer.id === currentSupervisorId)) return techSupervisorDevelopers;
    return [legacyCurrentSupervisor, ...techSupervisorDevelopers];
  }, [developers, form.tech_supervisor_id, techSupervisorDevelopers]);
  const canManageClients = isAdmin || isAnalyst || isTechSupervisor;
  const loggedDeveloperProfile = useMemo(
    () => developers.find((developer) => normalizeEmail(developer?.email) === normalizeEmail(user?.email)) || null,
    [developers, user?.email]
  );

  const dateRange = useMemo(
    () => buildDateRange(rangePreset, customFrom, customTo),
    [rangePreset, customFrom, customTo]
  );

  const visibleClients = useMemo(() => {
    if (canManageClients || isTechSupervisor) return clients;

    const myDeveloperId = String(loggedDeveloperProfile?.id || "").trim();
    const myEmail = normalizeEmail(user?.email);
    const myName = normalizeEmail(user?.full_name);
    const myDeveloperName = normalizeEmail(loggedDeveloperProfile?.name);

    if (isDeveloper) {
      return clients.filter((client) => {
        const operationIds = Array.isArray(client?.operations_ids)
          ? client.operations_ids.map((value) => String(value).trim())
          : [];
        const operationNames = Array.isArray(client?.operations_names)
          ? client.operations_names.map((value) => normalizeEmail(value))
          : [];

        return Boolean(
          (myDeveloperId && operationIds.includes(myDeveloperId)) ||
          operationNames.includes(myEmail) ||
          operationNames.includes(myName) ||
          operationNames.includes(myDeveloperName)
        );
      });
    }

    return [];
  }, [
    canManageClients,
    clients,
    isDeveloper,
    isTechSupervisor,
    loggedDeveloperProfile?.name,
    user?.email,
    user?.full_name,
  ]);
  const sortedClients = useMemo(
    () => [...visibleClients].sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || ""), "it")),
    [visibleClients]
  );
  const historicalStats = useMemo(() => {
    const byClient = new Map();
    visibleClients.forEach((client) => {
      byClient.set(client.id, {
        clientId: client.id,
        name: client.name,
        color: normalizeClientColor(client.color),
        totalTickets: 0,
        assignedTickets: 0,
        openTickets: 0,
        doneTickets: 0,
        devHours: 0,
      });
    });

    tickets.forEach((ticket) => {
      if (!ticket?.client_id || !byClient.has(ticket.client_id)) return;
      const clientStats = byClient.get(ticket.client_id);
      const createdDate = normalizeDate(ticket?.created_date);
      const segments = buildTicketSegments(ticket);
      const segmentsInRange = segments.filter((segment) =>
        inDateRange(segment.date, dateRange.from, dateRange.to)
      );

      const hasSegmentsInRange = segmentsInRange.length > 0;
      const createdInRange = inDateRange(createdDate, dateRange.from, dateRange.to);
      const fallbackHours =
        !hasSegmentsInRange && createdInRange
          ? Number(ticket.proposed_effort) || Number(ticket.effort_hours) || 0
          : 0;
      const ticketTouchesRange = hasSegmentsInRange || createdInRange || fallbackHours > 0;
      if (!ticketTouchesRange) return;

      clientStats.totalTickets += 1;
      if (ticket.assignee_id) clientStats.assignedTickets += 1;
      if (isOpenStatus(ticket.status)) clientStats.openTickets += 1;
      else clientStats.doneTickets += 1;

      const segmentHours = roundHalf(
        segmentsInRange.reduce((sum, segment) => sum + segment.hours, 0)
      );
      const totalHours = roundHalf(segmentHours + fallbackHours);
      clientStats.devHours = roundHalf(clientStats.devHours + totalHours);
    });

    const clientRows = visibleClients.map((client) => {
      const row = byClient.get(client.id);
      return row || {
        clientId: client.id,
        name: client.name,
        color: normalizeClientColor(client.color),
        totalTickets: 0,
        assignedTickets: 0,
        openTickets: 0,
        doneTickets: 0,
        devHours: 0,
      };
    });

    const sortedByHours = [...clientRows].sort((a, b) => b.devHours - a.devHours);
    const combinedChartData = sortedByHours
      .filter((row) => row.devHours > 0 || row.assignedTickets > 0)
      .map((row) => ({
        name: shortClientName(row.name),
        fullName: row.name,
        ore: row.devHours,
        tickets: row.assignedTickets,
        completedTickets: row.doneTickets,
        fill: row.color,
      }));

    const totalAssignedTickets = clientRows.reduce((sum, row) => sum + row.assignedTickets, 0);
    const totalDevHours = roundHalf(clientRows.reduce((sum, row) => sum + row.devHours, 0));
    const activeClients = clientRows.filter((row) => row.totalTickets > 0).length;
    const topClient = sortedByHours.find((row) => row.devHours > 0) || null;

    return {
      rowsByClient: clientRows,
      combinedChartData,
      totals: {
        totalAssignedTickets,
        totalDevHours,
        activeClients,
        topClientName: topClient?.name || "—",
      },
    };
  }, [tickets, visibleClients, dateRange.from, dateRange.to]);

  const statsByClientId = useMemo(
    () => new Map(historicalStats.rowsByClient.map((row) => [row.clientId, row])),
    [historicalStats.rowsByClient]
  );

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      const supervisor = developers.find((dev) => dev.id === data.tech_supervisor_id);
      const ops = developers.filter((dev) => (data.operations_ids || []).includes(dev.id));
      const analysts = analystUsers.filter((user) => (data.analyst_team_ids || []).includes(user.id));
      const resolvedTier = isAdmin
        ? normalizeClientTier(data.priority_tier)
        : normalizeClientTier(editing?.priority_tier);
      const payload = {
        ...data,
        commessa: String(data.commessa || "").trim(),
        industry: String(data.industry || "").trim(),
        priority_tier: resolvedTier,
        color: normalizeClientColor(data.color),
        tech_supervisor_name: supervisor?.name || "",
        tech_supervisor_email: supervisor?.email || "",
        operations_names: ops.map((dev) => dev.name),
        analyst_team_names: analysts.map((user) => user.full_name || user.email),
      };

      if (editing) {
        await appClient.entities.Client.update(editing.id, payload);
      } else {
        await appClient.entities.Client.create(payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      setOpen(false);
      setEditing(null);
      setForm({
        name: "",
        commessa: "",
        industry: "",
        priority_tier: "P3",
        color: DEFAULT_CLIENT_COLOR,
        notes: "",
        tech_supervisor_id: "",
        operations_ids: [],
        analyst_team_ids: [],
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      await appClient.entities.Client.delete(id);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["clients"] }),
  });

  const openEdit = (client) => {
    setEditing(client);
    setForm({
      name: client.name,
      commessa: client.commessa || "",
      industry: client.industry || "",
      priority_tier: normalizeClientTier(client.priority_tier),
      color: normalizeClientColor(client.color),
      notes: client.notes || "",
      tech_supervisor_id: client.tech_supervisor_id || "",
      operations_ids: client.operations_ids || [],
      analyst_team_ids: client.analyst_team_ids || [],
    });
    setOpen(true);
  };

  const openNew = () => {
    setEditing(null);
    setForm({
      name: "",
      commessa: "",
      industry: "",
      priority_tier: "P3",
      color: DEFAULT_CLIENT_COLOR,
      notes: "",
      tech_supervisor_id: "",
      operations_ids: [],
      analyst_team_ids: [],
    });
    setOpen(true);
  };

  const toggleMultiSelect = (field, id) => {
    setForm((prev) => {
      const current = prev[field] || [];
      return { ...prev, [field]: current.includes(id) ? current.filter((item) => item !== id) : [...current, id] };
    });
  };
  const tableColumnsCount = (isAdmin ? 10 : 9) - (canManageClients ? 0 : 1);

  const combinedChartMinWidth = Math.max(720, historicalStats.combinedChartData.length * 120);

  return (
    <div className="space-y-6" data-tour="clients-page">
      {isAdmin && (
        <Card className="border border-border/70 shadow-sm" data-tour="clients-overview">
          <CardContent className="p-5 space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground font-semibold">
                Storicita clienti
              </p>
              <h3 className="text-base font-semibold">Consumo tempo developer e ticket assegnati</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Periodo attivo: {dateRange.from} - {dateRange.to}
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
                <Input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground">A</Label>
                <Input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} className="h-9" />
              </div>
              {!dateRange.valid && (
                <p className="text-xs text-red-500">
                  Range non valido: imposta una data iniziale minore o uguale alla finale.
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-xl border border-border/70 bg-card px-3.5 py-3">
              <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                <Clock3 className="w-3.5 h-3.5" /> Ore dev totali
              </p>
              <p className="mt-1 text-xl font-semibold">{formatHours(historicalStats.totals.totalDevHours)}</p>
              <p className="text-[11px] text-muted-foreground">nel periodo selezionato</p>
            </div>
            <div className="rounded-xl border border-border/70 bg-card px-3.5 py-3">
              <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                <Ticket className="w-3.5 h-3.5" /> Ticket assegnati
              </p>
              <p className="mt-1 text-xl font-semibold">{historicalStats.totals.totalAssignedTickets}</p>
              <p className="text-[11px] text-muted-foreground">con developer assegnato</p>
            </div>
            <div className="rounded-xl border border-border/70 bg-card px-3.5 py-3">
              <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                <BarChart3 className="w-3.5 h-3.5" /> Clienti attivi
              </p>
              <p className="mt-1 text-xl font-semibold">{historicalStats.totals.activeClients}</p>
              <p className="text-[11px] text-muted-foreground">con attivita nel periodo</p>
            </div>
            <div className="rounded-xl border border-border/70 bg-card px-3.5 py-3">
              <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5" /> Cliente top
              </p>
              <p className="mt-1 text-xl font-semibold truncate">{historicalStats.totals.topClientName}</p>
              <p className="text-[11px] text-muted-foreground">per tempo dev consumato</p>
            </div>
          </div>

          <Card className="border border-border/70 shadow-none">
            <CardContent className="p-4">
                <div className="mb-4">
                  <p className="text-sm font-semibold text-foreground">Performance clienti</p>
                  <p className="text-xs text-muted-foreground">
                    Colonne = ore dev allocate, linee = ticket assegnati e ticket completati per cliente
                  </p>
                </div>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-1 text-xs font-medium text-muted-foreground">
                  <span className="h-2.5 w-2.5 rounded-sm bg-[#6366f1]" />
                  Ore dev allocate
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-1 text-xs font-medium text-muted-foreground">
                  <span className="relative inline-flex h-2.5 w-4 items-center">
                    <span className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-[#10b981]" />
                    <span className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-[#10b981]" />
                  </span>
                  Ticket assegnati
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-1 text-xs font-medium text-muted-foreground">
                  <span className="relative inline-flex h-2.5 w-4 items-center">
                    <span className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-[#f97316]" />
                    <span className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-[#f97316]" />
                  </span>
                  Ticket completati
                </span>
              </div>
              {historicalStats.combinedChartData.length === 0 ? (
                <div className="flex h-72 items-center justify-center rounded-xl border border-dashed border-border text-xs text-muted-foreground">
                  Nessun dato disponibile nel periodo selezionato.
                </div>
              ) : (
                <div className="overflow-x-auto pb-1">
                  <div style={{ minWidth: combinedChartMinWidth }}>
                    <ResponsiveContainer width="100%" height={320}>
                      <ComposedChart data={historicalStats.combinedChartData} margin={{ top: 12, right: 24, left: 8, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis
                          dataKey="name"
                          tickLine={false}
                          axisLine={false}
                          fontSize={11}
                          interval={0}
                          tick={{ fill: CHART_TEXT_COLOR, fontSize: 11 }}
                        />
                        <YAxis
                          yAxisId="left"
                          tickLine={false}
                          axisLine={false}
                          fontSize={11}
                          tick={{ fill: CHART_TEXT_COLOR, fontSize: 11 }}
                          tickFormatter={(value) => `${value}h`}
                          label={{
                            value: "Ore dev allocate",
                            angle: -90,
                            position: "insideLeft",
                            offset: -2,
                            style: { textAnchor: "middle", fill: CHART_TEXT_COLOR, fontSize: 11 },
                          }}
                        />
                        <YAxis
                          yAxisId="right"
                          orientation="right"
                          allowDecimals={false}
                          tickLine={false}
                          axisLine={false}
                          fontSize={11}
                          tick={{ fill: CHART_TEXT_COLOR, fontSize: 11 }}
                          label={{
                            value: "Ticket (assegnati/completati)",
                            angle: 90,
                            position: "insideRight",
                            offset: 2,
                            style: { textAnchor: "middle", fill: CHART_TEXT_COLOR, fontSize: 11 },
                          }}
                        />
                        <Tooltip
                          labelFormatter={(label, payload) => payload?.[0]?.payload?.fullName || label}
                          formatter={(value, name) => {
                            if (name === "Ore dev") return [`${value}h`, name];
                            if (name === "Ticket assegnati") return [`${value}`, name];
                            if (name === "Ticket completati") return [`${value}`, name];
                            return [value, name];
                          }}
                        />
                        <Bar yAxisId="left" dataKey="ore" name="Ore dev allocate" fill="#6366f1" radius={[10, 10, 0, 0]} maxBarSize={42}>
                          {historicalStats.combinedChartData.map((entry) => (
                            <Cell key={`combined-${entry.fullName}`} fill="#6366f1" />
                          ))}
                        </Bar>
                        <Line
                          yAxisId="right"
                          type="monotone"
                          dataKey="tickets"
                          name="Ticket assegnati"
                          stroke="#10b981"
                          strokeWidth={2.5}
                          dot={{ r: 4, fill: "#10b981", strokeWidth: 0 }}
                          activeDot={{ r: 5 }}
                        />
                        <Line
                          yAxisId="right"
                          type="monotone"
                          dataKey="completedTickets"
                          name="Ticket completati"
                          stroke="#f97316"
                          strokeWidth={2.5}
                          strokeDasharray="5 4"
                          dot={{ r: 4, fill: "#f97316", strokeWidth: 0 }}
                          activeDot={{ r: 5 }}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
          </CardContent>
        </Card>
      )}

      {canManageClients && (
        <div className="flex items-center justify-end">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button onClick={openNew} className="h-9 text-sm">
                <Plus className="w-4 h-4 mr-1.5" /> Add Client
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit Client" : "New Client"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-gray-600">Name *</Label>
                <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Client name" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-gray-600">Commessa (opzionale)</Label>
                <Input
                  value={form.commessa}
                  onChange={(event) => setForm({ ...form, commessa: event.target.value })}
                  placeholder="Es. CM-2026-014"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-gray-600">Industry</Label>
                <Select
                  value={form.industry || "none"}
                  onValueChange={(value) => setForm({ ...form, industry: value === "none" ? "" : value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select industry" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— None —</SelectItem>
                    {industrySelectOptions.map((industry) => (
                      <SelectItem key={industry} value={industry}>
                        {industry}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {isAdmin && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-gray-600">Tier priorita</Label>
                  <Select
                    value={normalizeClientTier(form.priority_tier)}
                    onValueChange={(value) => setForm({ ...form, priority_tier: normalizeClientTier(value) })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select tier" />
                    </SelectTrigger>
                    <SelectContent>
                      {TIER_OPTIONS.map((tier) => (
                        <SelectItem key={tier} value={tier}>
                          {tier}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-gray-600">Client Color</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="color"
                    value={normalizeClientColor(form.color)}
                    onChange={(event) => setForm({ ...form, color: event.target.value })}
                    className="h-9 w-14 p-1"
                  />
                  <Input
                    value={normalizeClientColor(form.color)}
                    onChange={(event) => setForm({ ...form, color: event.target.value })}
                    placeholder="#6366f1"
                    className="h-9"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-gray-600">Tech Supervisor</Label>
                <Select
                  value={form.tech_supervisor_id || "none"}
                  onValueChange={(value) => setForm({ ...form, tech_supervisor_id: value === "none" ? "" : value })}
                >
                  <SelectTrigger><SelectValue placeholder="Select developer..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— None —</SelectItem>
                    {techSupervisorOptions.map((dev) => (
                      <SelectItem key={dev.id} value={dev.id}>{dev.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-gray-600">Operations Team</Label>
                <div className="flex flex-wrap gap-1.5 p-2 border rounded-md min-h-[38px] bg-white">
                  {(form.operations_ids || []).map((id) => {
                    const dev = developers.find((item) => item.id === id);
                    return dev ? (
                      <span key={id} className="inline-flex items-center gap-1 bg-blue-100 text-blue-700 text-xs font-medium px-2 py-0.5 rounded-full">
                        {dev.name}
                        <button type="button" onClick={() => toggleMultiSelect("operations_ids", id)}>
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ) : null;
                  })}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {developers
                    .filter((dev) => dev.active !== false && !(form.operations_ids || []).includes(dev.id))
                    .map((dev) => (
                      <button
                        key={dev.id}
                        type="button"
                        onClick={() => toggleMultiSelect("operations_ids", dev.id)}
                        className="text-xs px-2.5 py-1 rounded-full border border-gray-200 text-gray-600 hover:border-blue-400 hover:text-blue-600 transition-colors"
                      >
                        + {dev.name}
                      </button>
                    ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-gray-600">Analyst Team</Label>
                <div className="flex flex-wrap gap-1.5 p-2 border rounded-md min-h-[38px] bg-white">
                  {(form.analyst_team_ids || []).map((id) => {
                    const analyst = analystUsers.find((item) => item.id === id);
                    return analyst ? (
                      <span key={id} className="inline-flex items-center gap-1 bg-violet-100 text-violet-700 text-xs font-medium px-2 py-0.5 rounded-full">
                        {analyst.full_name || analyst.email}
                        <button type="button" onClick={() => toggleMultiSelect("analyst_team_ids", id)}>
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ) : null;
                  })}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {analystUsers
                    .filter((analyst) => !(form.analyst_team_ids || []).includes(analyst.id))
                    .map((analyst) => (
                      <button
                        key={analyst.id}
                        type="button"
                        onClick={() => toggleMultiSelect("analyst_team_ids", analyst.id)}
                        className="text-xs px-2.5 py-1 rounded-full border border-gray-200 text-gray-600 hover:border-violet-400 hover:text-violet-600 transition-colors"
                      >
                        + {analyst.full_name || analyst.email}
                      </button>
                    ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-gray-600">Notes</Label>
                <Input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Optional notes" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button
                  onClick={() => saveMutation.mutate(form)}
                  disabled={!form.name || saveMutation.isPending}
                >
                  {editing ? "Update" : "Create"}
                </Button>
              </div>
            </div>
            </DialogContent>
          </Dialog>
        </div>
      )}

      <Card className="border-0 shadow-sm" data-tour="clients-table">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50">
                <TableHead className="font-semibold text-xs text-gray-500">Client</TableHead>
                {isAdmin && <TableHead className="font-semibold text-xs text-gray-500">Tier</TableHead>}
                <TableHead className="font-semibold text-xs text-gray-500">Commessa</TableHead>
                <TableHead className="font-semibold text-xs text-gray-500">Industry</TableHead>
                <TableHead className="font-semibold text-xs text-gray-500">Ticket assegnati</TableHead>
                <TableHead className="font-semibold text-xs text-gray-500">Ore dev</TableHead>
                <TableHead className="font-semibold text-xs text-gray-500">Tech Supervisor</TableHead>
                <TableHead className="font-semibold text-xs text-gray-500">Operations</TableHead>
                <TableHead className="font-semibold text-xs text-gray-500">Analysts</TableHead>
                {canManageClients && <TableHead className="font-semibold text-xs text-gray-500 w-20"></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedClients.length === 0 && (
                <TableRow>
                  <TableCell colSpan={tableColumnsCount} className="text-center py-12 text-gray-400">
                    No clients yet
                  </TableCell>
                </TableRow>
              )}
              {sortedClients.map((client) => {
                const statRow = statsByClientId.get(client.id) || {
                  assignedTickets: 0,
                  devHours: 0,
                };
                return (
                  <TableRow key={client.id} className="hover:bg-gray-50/50">
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div
                          className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center"
                          style={{ backgroundColor: `${normalizeClientColor(client.color)}20` }}
                        >
                          <Building2 className="w-4 h-4 text-gray-500" />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: normalizeClientColor(client.color) }} />
                          <span className="font-semibold text-sm">{client.name}</span>
                        </div>
                      </div>
                    </TableCell>
                    {isAdmin && (
                      <TableCell>
                        <Badge className={`${TIER_COLORS[normalizeClientTier(client.priority_tier)]} border-0 text-xs`}>
                          {normalizeClientTier(client.priority_tier)}
                        </Badge>
                      </TableCell>
                    )}
                    <TableCell className="text-sm text-gray-700">{client.commessa || "—"}</TableCell>
                    <TableCell className="text-sm text-gray-700">{client.industry || "—"}</TableCell>
                    <TableCell className="text-sm text-gray-700">
                      {statRow.assignedTickets}
                    </TableCell>
                    <TableCell className="text-sm text-gray-700">
                      {formatHours(statRow.devHours || 0)}
                    </TableCell>
                    <TableCell className="text-sm text-gray-600">{client.tech_supervisor_name || "—"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(client.operations_names || []).length > 0
                          ? client.operations_names.map((name, index) => (
                              <Badge key={index} className="bg-blue-50 text-blue-700 border-0 text-xs dark:bg-blue-500/15 dark:text-blue-300">
                                {name}
                              </Badge>
                            ))
                          : <span className="text-gray-400 text-sm">—</span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(client.analyst_team_names || []).length > 0
                          ? client.analyst_team_names.map((name, index) => (
                              <Badge key={index} className="bg-violet-50 text-violet-700 border-0 text-xs dark:bg-violet-500/15 dark:text-violet-300">
                                {name}
                              </Badge>
                            ))
                          : <span className="text-gray-400 text-sm">—</span>}
                      </div>
                    </TableCell>
                    {canManageClients && (
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(client)}>
                            <Pencil className="w-3.5 h-3.5 text-gray-400" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => deleteMutation.mutate(client.id)}>
                            <Trash2 className="w-3.5 h-3.5 text-gray-400 hover:text-red-500" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
