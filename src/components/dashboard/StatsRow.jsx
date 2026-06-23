import React from "react";
import { Card } from "@/components/ui/card";
import { Ticket, Clock, Users, CheckCircle2, Search, Zap } from "lucide-react";
import {
  getEffectivePriorityScore,
  getTicketWorkflowStatus,
  isSchedulableTicket,
  isTicketClosed,
} from "../shared/priorityUtils";

export default function StatsRow({ tickets, developers, showPriorityScore = true }) {
  const openTickets = tickets.filter((t) => !isTicketClosed(t)).length;
  const inProgress = tickets.filter((t) => getTicketWorkflowStatus(t) === "in_progress").length;
  const qaReview = tickets.filter((t) => getTicketWorkflowStatus(t) === "qa_review").length;
  const doneThisWeek = tickets.filter(t => {
    if (!isTicketClosed(t)) return false;
    const updated = new Date(t.updated_date);
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    return updated >= weekAgo;
  }).length;
  const schedulableTickets = tickets.filter((t) => isSchedulableTicket(t));
  const avgScore = schedulableTickets.length > 0
    ? Math.round(
        schedulableTickets.reduce((s, t) => s + getEffectivePriorityScore(t), 0) / schedulableTickets.length
      )
    : 0;

  const stats = [
    { label: "Open Tickets", value: openTickets, icon: Ticket, color: "text-blue-600 dark:text-blue-300", bg: "bg-blue-100/80 dark:bg-blue-500/20" },
    { label: "In Progress", value: inProgress, icon: Zap, color: "text-violet-600 dark:text-violet-300", bg: "bg-violet-100/80 dark:bg-violet-500/20" },
    { label: "QA / Review", value: qaReview, icon: Search, color: "text-cyan-600 dark:text-cyan-300", bg: "bg-cyan-100/80 dark:bg-cyan-500/20" },
    { label: "Completed (7d)", value: doneThisWeek, icon: CheckCircle2, color: "text-emerald-600 dark:text-emerald-300", bg: "bg-emerald-100/80 dark:bg-emerald-500/20" },
    ...(showPriorityScore
      ? [{ label: "Avg Priority", value: avgScore, icon: Clock, color: "text-amber-600 dark:text-amber-300", bg: "bg-amber-100/80 dark:bg-amber-500/20" }]
      : []),
    { label: "Active Devs", value: developers.filter((d) => d.active !== false).length, icon: Users, color: "text-indigo-600 dark:text-indigo-300", bg: "bg-indigo-100/80 dark:bg-indigo-500/20" },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
      {stats.map((s) => (
        <Card key={s.label} className="app-hover-lift border-border/65 bg-card/95 p-5">
          <div className="flex items-center gap-4">
            <div className={`rounded-xl p-2.5 ${s.bg}`}>
              <s.icon className={`w-4 h-4 ${s.color}`} />
            </div>
            <div className="min-w-0">
              <p className="text-[28px] font-semibold leading-none tracking-tight">{s.value}</p>
              <p className="mt-1 text-xs font-medium text-muted-foreground">{s.label}</p>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
