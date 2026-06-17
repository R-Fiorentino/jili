import React from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Clock, MessageSquare, AlertTriangle } from "lucide-react";
import {
  getActualEffortHours,
  getPriorityLevel,
  DIFFICULTY_CONFIG,
  TYPE_CONFIG,
  getEffectivePriorityScore,
  getPlannedEffortHours,
  isPriorityPaused,
  isClosedStatus,
} from "./priorityUtils";
import { Link } from "react-router-dom";
import { createTicketDetailUrl } from "@/utils";
import moment from "moment";

export default function TicketCard({ ticket, isDragging, showPriorityScore = true, detailFromPage = "dashboard" }) {
  const effectivePriority = getEffectivePriorityScore(ticket);
  const priority = getPriorityLevel(effectivePriority);
  const diff = DIFFICULTY_CONFIG[ticket.difficulty] || DIFFICULTY_CONFIG.medium;
  const type = TYPE_CONFIG[ticket.type] || TYPE_CONFIG.other;
  const hasDeadline = ticket.deadline && moment(ticket.deadline).isBefore(moment().add(3, 'days'));
  const plannedEffort = getPlannedEffortHours(ticket);
  const actualEffort = getActualEffortHours(ticket);
  const priorityPaused = isPriorityPaused(ticket);

  return (
    <Link to={createTicketDetailUrl(ticket.id, detailFromPage)}>
      <Card
        className={`app-hover-lift group cursor-pointer overflow-hidden border-border/70 bg-card/95 p-4 ${
          isDragging ? "rotate-1 scale-[1.02] shadow-[var(--shadow-hover)]" : ""
        }`}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className={`${type.color} border-0 px-2 py-1 text-[10px] font-semibold`}>
              {type.label}
            </Badge>
            <Badge variant="outline" className={`${diff.color} border-0 px-2 py-1 text-[10px] font-semibold`}>
              {diff.label}
            </Badge>
          </div>
          <div
            className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${priorityPaused ? "bg-amber-500" : priority.color}`}
            title={priorityPaused ? "Mancano dati per procedere" : `Priority: ${priority.label}`}
          />
        </div>

        <h4 className="mb-1.5 line-clamp-2 text-sm font-semibold leading-tight text-foreground">
          {ticket.title}
        </h4>

        {ticket.client_name && (
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <p className="text-xs font-medium text-muted-foreground">{ticket.client_name}</p>
            {priorityPaused && (
              <Badge variant="outline" className="border-0 bg-amber-100/80 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                Mancano dati
              </Badge>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2.5 text-[11px] text-muted-foreground">
            {isClosedStatus(ticket.status) && actualEffort ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100/80 px-2 py-0.5 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                <Clock className="h-3 w-3" /> {actualEffort}h
              </span>
            ) : plannedEffort ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100/80 px-2 py-0.5 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                <Clock className="h-3 w-3" /> ~{plannedEffort}h
              </span>
            ) : null}
            {ticket.comments?.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <MessageSquare className="h-3 w-3" /> {ticket.comments.length}
              </span>
            )}
            {hasDeadline && (
              <span className="inline-flex items-center gap-1 text-red-500">
                <AlertTriangle className="h-3 w-3" />
              </span>
            )}
          </div>

          {ticket.assignee_name && (
            <Avatar className="h-6 w-6 border border-border/60">
              <AvatarFallback className="bg-primary/15 text-[9px] font-semibold text-primary">
                {ticket.assignee_name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
              </AvatarFallback>
            </Avatar>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-border/70 pt-2.5">
          <span className="font-mono text-[10px] text-muted-foreground">#{ticket.id?.slice(-6)}</span>
          {showPriorityScore && (
            <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${priority.bgLight} ${priority.textColor}`}>
              {effectivePriority} pts
            </span>
          )}
        </div>
      </Card>
    </Link>
  );
}
