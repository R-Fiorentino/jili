import React from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import ClientSelect from "@/components/shared/ClientSelect";
import usePersistedState from "@/components/shared/usePersistedState";
import {
  getPriorityLevel,
  STATUS_CONFIG,
  DIFFICULTY_CONFIG,
  TYPE_CONFIG,
  getTicketWorkflowStatus,
  getActualEffortHours,
  compareTicketsByPriority,
  getEffectivePriorityScore,
  getPlannedEffortHours,
  isPriorityPaused,
  isTicketBlocked,
  isTicketClosed,
} from "../shared/priorityUtils";
import { Link } from "react-router-dom";
import { createTicketDetailUrl } from "@/utils";
import { Check, Clock, Search, ArrowUpDown, SlidersHorizontal, X } from "lucide-react";
import moment from "moment";

const LIVE_STATE_CONFIG = {
  not_live: {
    label: "Non live",
    color: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-500/15 dark:text-slate-200 dark:border-slate-500/35",
  },
  launch_requested: {
    label: "Live richiesta",
    color: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/35",
  },
  live: {
    label: "Live",
    color: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/35",
  },
  change_requested: {
    label: "Modifica richiesta",
    color: "bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/35",
  },
  stop_requested: {
    label: "Spegnimento richiesto",
    color: "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/35",
  },
  stopped: {
    label: "Spento",
    color: "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-500/15 dark:text-zinc-200 dark:border-zinc-500/35",
  },
};

function normalizeLiveState(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return LIVE_STATE_CONFIG[normalized] ? normalized : "not_live";
}

export default function BacklogTable({
  tickets,
  clients,
  developers,
  showPriorityScore = true,
  fillHeight = false,
  showTypeColumn = true,
  showPlanningStartColumn = false,
  showDifficultyFilter = true,
  showLiveStateFilter = false,
  defaultSortField,
  defaultSortDir,
  detailFromPage = "dashboard",
}) {
  const totalColumns = 6 + (showTypeColumn ? 1 : 0) + (showPlanningStartColumn ? 1 : 0);
  const persistenceKey = `backlog-table:${detailFromPage}:${showPriorityScore ? "score" : "workflow"}`;
  const [search, setSearch] = usePersistedState(`${persistenceKey}:search`, "");
  const [filterClient, setFilterClient] = usePersistedState(`${persistenceKey}:client`, "all");
  const [filterStatuses, setFilterStatuses] = usePersistedState(`${persistenceKey}:statuses`, () => {
    if (typeof window === "undefined") return [];
    try {
      const rawLegacyStatus = window.sessionStorage.getItem(`${persistenceKey}:status`);
      const legacyStatus = rawLegacyStatus ? JSON.parse(rawLegacyStatus) : "all";
      return legacyStatus && legacyStatus !== "all" && STATUS_CONFIG[legacyStatus] ? [legacyStatus] : [];
    } catch {
      return [];
    }
  });
  const [filterDifficulty, setFilterDifficulty] = usePersistedState(`${persistenceKey}:difficulty`, "all");
  const [filterLiveState, setFilterLiveState] = usePersistedState(`${persistenceKey}:liveState`, "all");
  const [sortField, setSortField] = usePersistedState(
    `${persistenceKey}:sortField`,
    () => defaultSortField || (showPriorityScore ? "priority_score" : "created_date")
  );
  const [sortDir, setSortDir] = usePersistedState(
    `${persistenceKey}:sortDir`,
    () => defaultSortDir ?? 1
  );

  const getPlanningStartTimestamp = React.useCallback((ticket) => {
    if (!ticket?.scheduled_date) return null;
    const planningStart = ticket.start_time
      ? `${ticket.scheduled_date}T${ticket.start_time}`
      : ticket.scheduled_date;
    const timestamp = Date.parse(planningStart);
    return Number.isNaN(timestamp) ? null : timestamp;
  }, []);

  React.useEffect(() => {
    if (filterClient === "all") return;
    const stillAvailable = clients.some((client) => client.id === filterClient);
    if (!stillAvailable) setFilterClient("all");
  }, [clients, filterClient, setFilterClient]);

  const selectedStatuses = React.useMemo(
    () => (Array.isArray(filterStatuses) ? filterStatuses.filter((status) => STATUS_CONFIG[status]) : []),
    [filterStatuses]
  );
  const selectedStatusSet = React.useMemo(() => new Set(selectedStatuses), [selectedStatuses]);

  React.useEffect(() => {
    if (Array.isArray(filterStatuses) && filterStatuses.length === selectedStatuses.length) return;
    setFilterStatuses(selectedStatuses);
  }, [filterStatuses, selectedStatuses, setFilterStatuses]);

  const toggleStatusFilter = (status) => {
    if (!STATUS_CONFIG[status]) return;
    setFilterStatuses((current) => {
      const currentStatuses = Array.isArray(current) ? current.filter((item) => STATUS_CONFIG[item]) : [];
      if (currentStatuses.includes(status)) {
        return currentStatuses.filter((item) => item !== status);
      }
      return [...currentStatuses, status];
    });
  };

  const filtered = tickets
    .filter(t => {
      if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterClient !== "all" && t.client_id !== filterClient) return false;
      if (selectedStatusSet.size > 0 && !selectedStatusSet.has(getTicketWorkflowStatus(t))) return false;
      if (showDifficultyFilter && filterDifficulty !== "all" && t.difficulty !== filterDifficulty) return false;
      if (showLiveStateFilter && filterLiveState !== "all" && normalizeLiveState(t.live_state) !== filterLiveState) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortField === "priority_score") {
        const byPriority = compareTicketsByPriority(a, b);
        return byPriority * sortDir;
      }

      if (sortField === "created_date") {
        const aTime = Date.parse(a.created_date || "") || 0;
        const bTime = Date.parse(b.created_date || "") || 0;
        return (bTime - aTime) * sortDir;
      }

      if (sortField === "planning_start") {
        const aTime = getPlanningStartTimestamp(a);
        const bTime = getPlanningStartTimestamp(b);
        if (aTime === null && bTime === null) return 0;
        if (aTime === null) return 1;
        if (bTime === null) return -1;
        return (aTime - bTime) * sortDir;
      }

      const aVal = a[sortField] || 0;
      const bVal = b[sortField] || 0;
      if (typeof aVal === "string" && typeof bVal === "string") {
        return aVal.localeCompare(bVal) * sortDir;
      }
      return (bVal - aVal) * sortDir;
    });

  const toggleSort = (field) => {
    if (sortField === field) setSortDir(d => d * -1);
    else { setSortField(field); setSortDir(1); }
  };

  return (
    <div
      className={`overflow-hidden rounded-2xl border border-border/65 bg-card/95 shadow-[var(--shadow-soft)] ${
        fillHeight ? "flex h-full min-h-0 flex-col" : ""
      }`}
    >
      <div className="border-b border-border/70 p-4">
        <div className="flex flex-col gap-3 md:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search tickets..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-10 border-border/70 bg-muted/55 pl-9 text-sm"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <ClientSelect
              clients={clients}
              value={filterClient}
              onValueChange={setFilterClient}
              placeholder="Client"
              searchPlaceholder="Search client..."
              allValue="all"
              allLabel="All Clients"
              triggerClassName="w-40 bg-muted/55 text-sm"
            />
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 w-44 justify-between rounded-xl bg-muted/55 px-3 text-sm font-normal"
                >
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <SlidersHorizontal className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">
                      {selectedStatuses.length > 0 ? `${selectedStatuses.length} status` : "All Status"}
                    </span>
                  </span>
                  {selectedStatuses.length > 0 ? (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                      {selectedStatuses.length}
                    </span>
                  ) : null}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-64 rounded-2xl border-border/70 bg-card/95 p-3 shadow-[var(--shadow-hover)]">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Status</p>
                  {selectedStatuses.length > 0 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => setFilterStatuses([])}
                    >
                      <X className="h-3 w-3" />
                      Reset
                    </Button>
                  ) : null}
                </div>
                <div className="space-y-1">
                  {Object.entries(STATUS_CONFIG).map(([key, value]) => {
                    const selected = selectedStatusSet.has(key);
                    return (
                      <button
                        key={key}
                        type="button"
                        className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm transition-colors hover:bg-muted/60"
                        onClick={() => toggleStatusFilter(key)}
                      >
                        <span className={`flex h-4 w-4 items-center justify-center rounded border ${selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background"}`}>
                          {selected ? <Check className="h-3 w-3" /> : null}
                        </span>
                        <Badge variant="outline" className={`${value.color} border-0 text-[10px]`}>
                          {value.label}
                        </Badge>
                      </button>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
            {showDifficultyFilter && (
              <Select value={filterDifficulty} onValueChange={setFilterDifficulty}>
                <SelectTrigger className="h-10 w-32 bg-muted/55 text-sm">
                  <SelectValue placeholder="Difficulty" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="easy">Easy</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="hard">Hard</SelectItem>
                </SelectContent>
              </Select>
            )}
            {showLiveStateFilter && (
              <Select value={filterLiveState} onValueChange={setFilterLiveState}>
                <SelectTrigger className="h-10 w-44 bg-muted/55 text-sm">
                  <SelectValue placeholder="Stato live" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tutti live/non live</SelectItem>
                  {Object.entries(LIVE_STATE_CONFIG).map(([key, value]) => (
                    <SelectItem key={key} value={key}>
                      {value.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
      </div>

      <div className={fillHeight ? "min-h-0 flex-1 overflow-auto" : "overflow-x-auto"}>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/45 hover:bg-muted/45">
              <TableHead
                className={`text-xs font-semibold text-muted-foreground ${showPriorityScore ? "cursor-pointer" : ""}`}
                onClick={showPriorityScore ? () => toggleSort("priority_score") : undefined}
              >
                <span className="flex items-center gap-1">
                  Priority
                  {showPriorityScore ? <ArrowUpDown className="h-3 w-3" /> : null}
                </span>
              </TableHead>
              <TableHead className="font-semibold text-xs text-muted-foreground">Ticket</TableHead>
              <TableHead className="font-semibold text-xs text-muted-foreground">Client</TableHead>
              {showTypeColumn ? (
                <TableHead className="font-semibold text-xs text-muted-foreground">Type</TableHead>
              ) : null}
              {showPlanningStartColumn ? (
                <TableHead className="cursor-pointer text-xs font-semibold text-muted-foreground" onClick={() => toggleSort("planning_start")}>
                  <span className="flex items-center gap-1">Inizio presa in carico <ArrowUpDown className="h-3 w-3" /></span>
                </TableHead>
              ) : null}
              <TableHead className="font-semibold text-xs text-muted-foreground">Status</TableHead>
              <TableHead className="font-semibold text-xs text-muted-foreground">Effort</TableHead>
              <TableHead className="font-semibold text-xs text-muted-foreground">Assignee</TableHead>
              <TableHead className="cursor-pointer text-xs font-semibold text-muted-foreground" onClick={() => toggleSort("created_date")}>
                <span className="flex items-center gap-1">Age <ArrowUpDown className="h-3 w-3" /></span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={totalColumns} className="py-12 text-center text-muted-foreground">No tickets found</TableCell>
              </TableRow>
            )}
            {filtered.map((ticket) => {
              const effectivePriority = getEffectivePriorityScore(ticket);
              const priority = getPriorityLevel(effectivePriority);
              const priorityPaused = isPriorityPaused(ticket);
              const status = STATUS_CONFIG[getTicketWorkflowStatus(ticket)] || STATUS_CONFIG.new;
              const diff = DIFFICULTY_CONFIG[ticket.difficulty] || DIFFICULTY_CONFIG.medium;
              const type = TYPE_CONFIG[ticket.type] || TYPE_CONFIG.other;
              const plannedEffort = getPlannedEffortHours(ticket);
              const actualEffort = getActualEffortHours(ticket);
              const ticketBlocked = isTicketBlocked(ticket);
              const scheduleSlipCount = Number(ticket.schedule_slip_count) || 0;
              const liveState = LIVE_STATE_CONFIG[normalizeLiveState(ticket.live_state)] || LIVE_STATE_CONFIG.not_live;
              return (
                <TableRow key={ticket.id} className="group cursor-pointer hover:bg-muted/30">
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className={`h-2.5 w-2.5 rounded-full ${ticketBlocked ? "bg-amber-500" : priority.color}`} />
                      {showPriorityScore ? (
                        <span className="text-sm font-bold text-foreground">{effectivePriority}</span>
                      ) : (
                        <span className="text-xs font-medium text-muted-foreground">
                          {ticketBlocked ? (priorityPaused ? "Mancano dati" : "In pausa") : priority.label}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Link to={createTicketDetailUrl(ticket.id, detailFromPage)} className="group-hover:text-blue-600 transition-colors">
                      <p className="line-clamp-1 text-sm font-semibold text-foreground">{ticket.title}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[10px] text-muted-foreground">#{ticket.id?.slice(-6)}</span>
                        {scheduleSlipCount > 0 ? (
                          <Badge variant="outline" className="border-amber-200 bg-amber-50 px-1.5 py-0 text-[10px] text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300">
                            Slittato {scheduleSlipCount}x
                          </Badge>
                        ) : null}
                        {showLiveStateFilter ? (
                          <Badge variant="outline" className={`${liveState.color} px-1.5 py-0 text-[10px]`}>
                            {liveState.label}
                          </Badge>
                        ) : null}
                      </div>
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{ticket.client_name || "—"}</TableCell>
                  {showTypeColumn ? (
                    <TableCell>
                      <Badge variant="outline" className={`${type.color} border-0 text-[10px]`}>{type.label}</Badge>
                    </TableCell>
                  ) : null}
                  {showPlanningStartColumn ? (
                    <TableCell className="text-xs text-muted-foreground">
                      {ticket.scheduled_date ? (
                        <div className="space-y-0.5">
                          <p className="font-medium text-foreground">
                            {moment(ticket.scheduled_date).format("DD MMM YYYY")}
                          </p>
                          <p>{ticket.start_time || "—"}</p>
                        </div>
                      ) : (
                        <span className="text-muted-foreground/60">Non pianificato</span>
                      )}
                    </TableCell>
                  ) : null}
                  <TableCell>
                    <Badge variant="outline" className={`${status.color} text-[10px]`}>{status.label}</Badge>
                  </TableCell>
                  <TableCell>
                    {isTicketClosed(ticket) && actualEffort > 0 ? (
                      <span className="flex items-center gap-1 text-sm font-medium"><Clock className="h-3 w-3 text-muted-foreground" />{actualEffort}h</span>
                    ) : plannedEffort > 0 ? (
                      <span className="flex items-center gap-1 text-sm text-amber-600"><Clock className="h-3 w-3" />~{plannedEffort}h</span>
                    ) : <span className="text-muted-foreground/60">—</span>}
                  </TableCell>
                  <TableCell>
                    {ticket.assignee_name ? (
                      <div className="flex items-center gap-1.5">
                        <Avatar className="h-5 w-5 border border-border/60">
                          <AvatarFallback className="bg-primary/15 text-[9px] font-semibold text-primary">
                            {ticket.assignee_name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-xs text-muted-foreground">{ticket.assignee_name}</span>
                      </div>
                    ) : <span className="text-muted-foreground/60">—</span>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{moment(ticket.created_date).fromNow()}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
