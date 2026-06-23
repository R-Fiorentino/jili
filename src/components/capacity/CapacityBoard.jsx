import React from "react";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Clock, AlertTriangle } from "lucide-react";
import { getPlannedEffortHours, isSchedulableTicket } from "../shared/priorityUtils";

export default function CapacityBoard({ developers, tickets }) {
  const devCapacity = developers.filter(d => d.active !== false).map(dev => {
    const assignedTickets = tickets.filter(
      (t) => t.assignee_id === dev.id && isSchedulableTicket(t)
    );
    const totalAllocated = assignedTickets.reduce((s, t) => s + getPlannedEffortHours(t), 0);
    const weeklyCapacity = (dev.daily_capacity || 8) * 5;
    const usagePercent = weeklyCapacity > 0 ? Math.min((totalAllocated / weeklyCapacity) * 100, 100) : 0;
    const isOverloaded = totalAllocated > weeklyCapacity;

    return {
      ...dev,
      assignedTickets,
      totalAllocated,
      weeklyCapacity,
      usagePercent,
      isOverloaded,
      available: Math.max(0, weeklyCapacity - totalAllocated),
    };
  }).sort((a, b) => b.available - a.available);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
      {devCapacity.map((dev) => (
        <Card
          key={dev.id}
          className={`app-hover-lift border-border/65 bg-card/95 p-6 ${
            dev.isOverloaded ? "ring-1 ring-red-300/55 dark:ring-red-500/40" : ""
          }`}
        >
          <div className="mb-5 flex items-center gap-3.5">
            <Avatar className="h-11 w-11 border border-border/60">
              <AvatarFallback className="bg-primary/15 text-sm font-semibold text-primary">
                {dev.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="truncate text-base font-semibold text-foreground">{dev.name}</p>
              <p className="text-xs text-muted-foreground">{dev.email}</p>
            </div>
            {dev.isOverloaded && (
              <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />
            )}
          </div>

          <div className="mb-4">
            <div className="mb-2 flex justify-between text-xs">
              <span className="font-medium text-muted-foreground">Weekly Capacity</span>
              <span className="font-semibold text-foreground">{dev.totalAllocated}h / {dev.weeklyCapacity}h</span>
            </div>
            <Progress
              value={dev.usagePercent}
              className="h-2.5"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <span className={`text-xs font-semibold ${dev.isOverloaded ? "text-red-600 dark:text-red-300" : "text-emerald-600 dark:text-emerald-300"}`}>
                {dev.available}h available
              </span>
            </div>
            <Badge variant="outline" className="border-border/60 bg-muted/70 text-[10px]">
              {dev.assignedTickets.length} tickets
            </Badge>
          </div>

          {dev.assignedTickets.length > 0 && (
            <div className="mt-4 space-y-2 border-t border-border/70 pt-4">
              {dev.assignedTickets.slice(0, 4).map((t) => (
                <div key={t.id} className="flex items-center justify-between text-xs">
                  <span className="mr-2 flex-1 truncate text-muted-foreground">{t.title}</span>
                  <span className="shrink-0 font-medium text-muted-foreground">{getPlannedEffortHours(t) || "?"}h</span>
                </div>
              ))}
              {dev.assignedTickets.length > 4 && (
                <p className="text-[11px] text-muted-foreground">+{dev.assignedTickets.length - 4} more</p>
              )}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
