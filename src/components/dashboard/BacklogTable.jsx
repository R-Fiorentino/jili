import React from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
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
  isClosedStatus,
} from "../shared/priorityUtils";
import { Link } from "react-router-dom";
import { createTicketDetailUrl } from "@/utils";
import { Clock, Search, ArrowUpDown } from "lucide-react";
import moment from "moment";

export default function BacklogTable({
  tickets,
  clients,
  developers,
  showPriorityScore = true,
  fillHeight = false,
  showTypeColumn = true,
  showPlanningStartColumn = false,
  defaultSortField,
  defaultSortDir,
  detailFromPage = "dashboard",
}) {
  const totalColumns = 6 + (showTypeColumn ? 1 : 0) + (showPlanningStartColumn ? 1 : 0);
  const [search, setSearch] = React.useState("");
  const [filterClient, setFilterClient] = React.useState("all");
  const [filterStatus, setFilterStatus] = React.useState("all");
  const [filterDifficulty, setFilterDifficulty] = React.useState("all");
  const [sortField, setSortField] = React.useState(() => defaultSortField || (showPriorityScore ? "priority_score" : "created_date"));
  const [sortDir, setSortDir] = React.useState(() => defaultSortDir ?? 1);

  const getPlanningStartTimestamp = React.useCallback((ticket) => {
    if (!ticket?.scheduled_date) return null;
    const planningStart = ticket.start_time
      ? `${ticket.scheduled_date}T${ticket.start_time}`
      : ticket.scheduled_date;
    const timestamp = Date.parse(planningStart);
    return Number.isNaN(timestamp) ? null : timestamp;
  }, []);

  const filtered = tickets
    .filter(t => {
      if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterClient !== "all" && t.client_id !== filterClient) return false;
      if (filterStatus !== "all" && getTicketWorkflowStatus(t) !== filterStatus) return false;
      if (filterDifficulty !== "all" && t.difficulty !== filterDifficulty) return false;
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
            <Select value={filterClient} onValueChange={setFilterClient}>
              <SelectTrigger className="h-10 w-40 bg-muted/55 text-sm">
                <SelectValue placeholder="Client" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Clients</SelectItem>
                {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="h-10 w-40 bg-muted/55 text-sm">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {Object.entries(STATUS_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
              </SelectContent>
            </Select>
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
              return (
                <TableRow key={ticket.id} className="group cursor-pointer hover:bg-muted/30">
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className={`h-2.5 w-2.5 rounded-full ${priorityPaused ? "bg-amber-500" : priority.color}`} />
                      {showPriorityScore ? (
                        <span className="text-sm font-bold text-foreground">{effectivePriority}</span>
                      ) : (
                        <span className="text-xs font-medium text-muted-foreground">
                          {priorityPaused ? "Mancano dati" : priority.label}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Link to={createTicketDetailUrl(ticket.id, detailFromPage)} className="group-hover:text-blue-600 transition-colors">
                      <p className="line-clamp-1 text-sm font-semibold text-foreground">{ticket.title}</p>
                      <p className="font-mono text-[10px] text-muted-foreground">#{ticket.id?.slice(-6)}</p>
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
                    {isClosedStatus(ticket.status) && actualEffort > 0 ? (
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
