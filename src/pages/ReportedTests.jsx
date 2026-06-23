import React, { useMemo } from "react";
import { appClient } from "@/api/appClient";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { createTicketDetailUrl } from "@/utils";
import { BarChart3, Trophy, TrendingDown, MinusCircle, Building2 } from "lucide-react";
import {
  ResponsiveContainer,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ComposedChart,
  Bar,
  Line,
} from "recharts";
import moment from "moment";
import ClientSelect from "../components/shared/ClientSelect";
import usePersistedState from "../components/shared/usePersistedState";
import {
  DEFAULT_CONFIG,
  getIndustryOptions,
  getTicketReportedOutcome,
  getTicketWorkflowStatus,
} from "../components/shared/priorityUtils";

const OUTCOME_META = {
  winner: {
    label: "Winner",
    color: "#10b981",
    badge: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/35 dark:bg-emerald-500/15 dark:text-emerald-300",
    icon: Trophy,
  },
  loser: {
    label: "Loser",
    color: "#ef4444",
    badge: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/35 dark:bg-rose-500/15 dark:text-rose-300",
    icon: TrendingDown,
  },
  not_significant: {
    label: "Not Significant",
    color: "#f59e0b",
    badge: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/35 dark:bg-amber-500/15 dark:text-amber-300",
    icon: MinusCircle,
  },
};
const CHART_TEXT_COLOR = "hsl(var(--foreground))";

function normalizeDate(value) {
  if (!value) return null;
  const strict = moment(value, "YYYY-MM-DD", true);
  if (strict.isValid()) return strict.format("YYYY-MM-DD");
  const parsed = moment(value);
  return parsed.isValid() ? parsed.format("YYYY-MM-DD") : null;
}

function formatPercent(value) {
  return `${Math.round((Number(value) || 0) * 10) / 10}%`;
}

function shortName(value = "", max = 18) {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

function inDateRange(date, from, to) {
  if (!date || !from || !to) return false;
  return date >= from && date <= to;
}

function SummaryCard({ title, value, description, icon: Icon, tone = "default" }) {
  const toneClass = {
    default: "bg-primary/10 text-primary",
    success: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
    danger: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
    warning: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  }[tone];

  return (
    <Card className="border border-border/70 shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">{title}</p>
            <p className="mt-3 text-3xl font-semibold tracking-tight text-foreground">{value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          </div>
          <span className={`inline-flex h-10 w-10 items-center justify-center rounded-2xl ${toneClass}`}>
            <Icon className="h-4 w-4" />
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ReportedTests() {
  const [selectedIndustry, setSelectedIndustry] = usePersistedState("reported-tests:industry", "all");
  const [selectedClientId, setSelectedClientId] = usePersistedState("reported-tests:client", "all");
  const [dateFrom, setDateFrom] = usePersistedState("reported-tests:dateFrom", "");
  const [dateTo, setDateTo] = usePersistedState("reported-tests:dateTo", "");

  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ["tickets"],
    queryFn: () => appClient.entities.Ticket.list(),
  });

  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: () => appClient.entities.Client.list(),
  });
  const { data: configList = [] } = useQuery({
    queryKey: ["priority_config"],
    queryFn: () => appClient.entities.PriorityConfig.list(),
  });
  const industryOptions = useMemo(
    () => getIndustryOptions(configList[0] || DEFAULT_CONFIG),
    [configList]
  );

  const reportedRows = useMemo(() => {
    return tickets
      .filter((ticket) => getTicketWorkflowStatus(ticket) === "reported")
      .map((ticket) => {
        const client = clients.find((entry) => entry.id === ticket.client_id) || null;
        const goLiveDate = normalizeDate(ticket.reported_at || ticket.updated_date);
        const outcome = getTicketReportedOutcome(ticket);

        return {
          id: ticket.id,
          title: ticket.title || "—",
          clientId: ticket.client_id || "",
          clientName: ticket.client_name || client?.name || "—",
          clientColor: client?.color || "#6366f1",
          industry: ticket.reported_industry || client?.industry || "—",
          outcome,
          primaryMetric: "—",
          goLiveDate,
          goLiveDateLabel: goLiveDate ? moment(goLiveDate).format("DD MMM YYYY") : "—",
          link: createTicketDetailUrl(ticket.id, "reported_tests"),
        };
      })
      .sort((a, b) => {
        const aTime = Date.parse(a.goLiveDate || "") || 0;
        const bTime = Date.parse(b.goLiveDate || "") || 0;
        return bTime - aTime;
      });
  }, [tickets, clients]);

  const availableClients = useMemo(() => {
    const sourceClients = selectedIndustry === "all"
      ? clients
      : clients.filter((client) => String(client.industry || "").trim() === selectedIndustry);

    return [...sourceClients].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  }, [clients, selectedIndustry]);

  React.useEffect(() => {
    if (selectedClientId === "all") return;
    const stillVisible = availableClients.some((client) => client.id === selectedClientId);
    if (!stillVisible) setSelectedClientId("all");
  }, [availableClients, selectedClientId]);

  const filteredRows = useMemo(() => {
    return reportedRows.filter((row) => {
      if (selectedIndustry !== "all" && row.industry !== selectedIndustry) return false;
      if (selectedClientId !== "all" && row.clientId !== selectedClientId) return false;
      if (dateFrom && (!row.goLiveDate || row.goLiveDate < dateFrom)) return false;
      if (dateTo && (!row.goLiveDate || row.goLiveDate > dateTo)) return false;
      return true;
    });
  }, [reportedRows, selectedIndustry, selectedClientId, dateFrom, dateTo]);

  const kpis = useMemo(() => {
    const total = filteredRows.length;
    const winnerCount = filteredRows.filter((row) => row.outcome === "winner").length;
    const loserCount = filteredRows.filter((row) => row.outcome === "loser").length;
    const notSignificantCount = filteredRows.filter((row) => row.outcome === "not_significant").length;
    const testedClients = new Set(filteredRows.map((row) => row.clientId || row.clientName).filter(Boolean)).size;

    return {
      total,
      winnerCount,
      loserCount,
      notSignificantCount,
      testedClients,
      winRate: total > 0 ? (winnerCount / total) * 100 : 0,
      loseRate: total > 0 ? (loserCount / total) * 100 : 0,
      notSignificantRate: total > 0 ? (notSignificantCount / total) * 100 : 0,
    };
  }, [filteredRows]);

  const clientPerformanceData = useMemo(() => {
    const grouped = new Map();

    filteredRows.forEach((row) => {
      const key = row.clientId || row.clientName;
      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          clientName: row.clientName,
          shortName: shortName(row.clientName, 22),
          tests: 0,
          winners: 0,
        });
      }
      const entry = grouped.get(key);
      entry.tests += 1;
      if (row.outcome === "winner") entry.winners += 1;
    });

    return [...grouped.values()]
      .sort((a, b) => b.tests - a.tests || a.clientName.localeCompare(b.clientName))
      .map((entry) => ({
        ...entry,
        winRate: entry.tests > 0 ? Math.round((entry.winners / entry.tests) * 1000) / 10 : 0,
      }));
  }, [filteredRows]);

  const chartMinWidth = Math.max(0, clientPerformanceData.length * 110);

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-violet-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-tour="reported-page">
      <Card className="border border-border/70 shadow-sm" data-tour="reported-filters">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[240px_240px_minmax(0,1fr)]">
            <Select value={selectedIndustry} onValueChange={setSelectedIndustry}>
              <SelectTrigger className="bg-background">
                <SelectValue placeholder="Industry" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutte le industry</SelectItem>
                {industryOptions.map((industry) => (
                  <SelectItem key={industry} value={industry}>
                    {industry}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <ClientSelect
              clients={availableClients}
              value={selectedClientId}
              onValueChange={setSelectedClientId}
              placeholder="Client"
              allValue="all"
              allLabel="Tutti i clienti"
              triggerClassName="bg-background"
            />

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                className="flex h-10 w-full rounded-xl border border-input/85 bg-background/85 px-3.5 py-2 text-sm"
              />
              <input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
                className="flex h-10 w-full rounded-xl border border-input/85 bg-background/85 px-3.5 py-2 text-sm"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-5">
        <SummaryCard
          title="Test reported"
          value={kpis.total}
          description="Ticket con stato Reported"
          icon={BarChart3}
        />
        <SummaryCard
          title="Win Rate"
          value={formatPercent(kpis.winRate)}
          description={`${kpis.winnerCount} test winner`}
          icon={OUTCOME_META.winner.icon}
          tone="success"
        />
        <SummaryCard
          title="Lose Rate"
          value={formatPercent(kpis.loseRate)}
          description={`${kpis.loserCount} test loser`}
          icon={OUTCOME_META.loser.icon}
          tone="danger"
        />
        <SummaryCard
          title="Not Significant"
          value={formatPercent(kpis.notSignificantRate)}
          description={`${kpis.notSignificantCount} test non significativi`}
          icon={OUTCOME_META.not_significant.icon}
          tone="warning"
        />
        <SummaryCard
          title="Clienti testati"
          value={kpis.testedClients}
          description="Clienti con almeno un test reported"
          icon={Building2}
        />
      </div>

      <Card className="border border-border/70 shadow-sm" data-tour="reported-chart">
        <CardContent className="p-4">
          <div className="mb-4">
            <p className="text-sm font-semibold text-foreground">Client performance</p>
            <p className="mt-1 text-xs text-muted-foreground">Colonne = numero test reported, linea = win rate per cliente.</p>
          </div>

          <div className="overflow-x-auto">
            <div
              className="w-full"
              style={{
                minWidth: chartMinWidth > 0 ? `${chartMinWidth}px` : "100%",
                height: 360,
              }}
            >
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={clientPerformanceData} margin={{ top: 12, right: 36, left: 12, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" />
                  <XAxis
                    dataKey="shortName"
                    tickLine={false}
                    axisLine={false}
                    fontSize={12}
                    interval={0}
                    angle={0}
                    height={52}
                    tick={{ fill: CHART_TEXT_COLOR, fontSize: 12 }}
                  />
                  <YAxis
                    yAxisId="left"
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                    fontSize={12}
                    tick={{ fill: CHART_TEXT_COLOR, fontSize: 12 }}
                    label={{
                      value: "Number of tests",
                      angle: -90,
                      position: "insideLeft",
                      style: { textAnchor: "middle", fill: CHART_TEXT_COLOR },
                    }}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    domain={[0, 100]}
                    tickLine={false}
                    axisLine={false}
                    fontSize={12}
                    tick={{ fill: CHART_TEXT_COLOR, fontSize: 12 }}
                    tickFormatter={(value) => `${value}%`}
                    label={{
                      value: "Win Rate %",
                      angle: 90,
                      position: "insideRight",
                      style: { textAnchor: "middle", fill: CHART_TEXT_COLOR },
                    }}
                  />
                  <Tooltip
                    formatter={(value, name) => {
                      if (name === "Reported tests") return [`${value} test`, name];
                      return [`${value}%`, name];
                    }}
                  />
                  <Bar yAxisId="left" dataKey="tests" name="Reported tests" fill="#6366f1" radius={[10, 10, 0, 0]} maxBarSize={42} />
                  <Line yAxisId="right" type="monotone" dataKey="winRate" name="Win Rate" stroke="#10b981" strokeWidth={2.5} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border border-border/70 shadow-sm" data-tour="reported-table">
        <CardContent className="p-0">
          <div className="border-b border-border/70 px-4 py-3">
            <p className="text-sm font-semibold text-foreground">Tests table</p>
            <p className="mt-1 text-xs text-muted-foreground">Elenco dei test reportati ordinati per Go Live Date decrescente.</p>
          </div>

          <div className="px-4 pb-4 pt-3">
            <div className="rounded-2xl border border-border/70 bg-card/60">
              <Table className="min-w-full">
              <TableHeader>
                <TableRow className="bg-muted/45 hover:bg-muted/45">
                  <TableHead className="text-xs font-semibold text-muted-foreground">Test Title</TableHead>
                  <TableHead className="text-xs font-semibold text-muted-foreground">Client</TableHead>
                  <TableHead className="text-xs font-semibold text-muted-foreground">Industry</TableHead>
                  <TableHead className="text-xs font-semibold text-muted-foreground">Outcome</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-12 text-center text-muted-foreground">
                      Nessun test reported per i filtri selezionati.
                    </TableCell>
                  </TableRow>
                )}

                {filteredRows.map((row) => {
                  const outcomeMeta = OUTCOME_META[row.outcome] || OUTCOME_META.not_significant;
                  return (
                    <TableRow key={row.id} className="group hover:bg-muted/25">
                      <TableCell>
                        <Link to={row.link} className="block">
                          <p className="line-clamp-1 text-sm font-semibold text-foreground transition-colors group-hover:text-primary">
                            {row.title}
                          </p>
                          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">#{row.id?.slice(-6)}</p>
                        </Link>
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: row.clientColor }} />
                          {row.clientName}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{row.industry}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] ${outcomeMeta.badge}`}>
                          {outcomeMeta.label}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
