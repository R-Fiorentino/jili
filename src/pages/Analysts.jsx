import React, { useMemo, useState } from "react";
import { appClient } from "@/api/appClient";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Plus, UserCheck, UserX, Ticket, Building2, Pencil, Users, BarChart3 } from "lucide-react";
import { useCurrentUser } from "@/components/shared/useCurrentUser";
import { isOpenStatus } from "@/components/shared/priorityUtils";
import { cn } from "@/lib/utils";

function resolveRole(user) {
  return user?.app_role || user?.role || "user";
}

function displayName(user) {
  return user?.full_name || user?.email || "Unnamed user";
}

export default function Analysts() {
  const { isAdmin, loading } = useCurrentUser();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [form, setForm] = useState({
    user_id: "",
    full_name: "",
    active: true,
  });

  const { data: users = [] } = useQuery({
    queryKey: ["users"],
    queryFn: () => appClient.entities.User.list(),
  });

  const { data: tickets = [] } = useQuery({
    queryKey: ["tickets"],
    queryFn: () => appClient.entities.Ticket.list(),
  });

  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: () => appClient.entities.Client.list(),
  });

  const analysts = useMemo(
    () => users.filter((user) => resolveRole(user) === "analyst"),
    [users]
  );

  const promotableUsers = useMemo(
    () =>
      users.filter((user) => {
        const role = resolveRole(user);
        return role !== "analyst" && role !== "admin";
      }),
    [users]
  );

  function getOpenTicketsCreated(email) {
    return tickets.filter(
      (ticket) =>
        ticket.created_by === email && isOpenStatus(ticket.status)
    ).length;
  }

  function getAssignedClients(userId) {
    return clients.filter((client) => (client.analyst_team_ids || []).includes(userId)).length;
  }

  const analystMetrics = useMemo(() => {
    const activeCount = analysts.filter((analyst) => analyst.active !== false).length;
    const openCreated = analysts.reduce(
      (sum, analyst) => sum + getOpenTicketsCreated(analyst.email),
      0
    );
    const uniqueClientIds = new Set();
    analysts.forEach((analyst) => {
      clients.forEach((client) => {
        if ((client.analyst_team_ids || []).includes(analyst.id)) {
          uniqueClientIds.add(client.id);
        }
      });
    });
    return {
      total: analysts.length,
      active: activeCount,
      openCreated,
      assignedClients: uniqueClientIds.size,
    };
  }, [analysts, clients, tickets]);

  const visibleAnalysts = useMemo(() => {
    if (statusFilter === "active") return analysts.filter((analyst) => analyst.active !== false);
    if (statusFilter === "inactive") return analysts.filter((analyst) => analyst.active === false);
    return analysts;
  }, [analysts, statusFilter]);

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      const normalizedName = data.full_name.trim();

      if (editing) {
        return appClient.entities.User.update(editing.id, {
          full_name: normalizedName || displayName(editing),
          active: data.active !== false,
          app_role: "analyst",
          role: "analyst",
        });
      }

      const selected = users.find((user) => user.id === data.user_id);
      if (!selected) {
        throw new Error("Seleziona un utente da promuovere.");
      }

      return appClient.entities.User.update(selected.id, {
        full_name: normalizedName || displayName(selected),
        active: data.active !== false,
        app_role: "analyst",
        role: "analyst",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      setOpen(false);
      setEditing(null);
    },
  });

  const demoteMutation = useMutation({
    mutationFn: async (userId) => {
      await appClient.entities.User.update(userId, {
        app_role: "user",
        role: "user",
      });

      const latestUsers = await appClient.entities.User.list();
      const latestAnalysts = latestUsers.filter((user) => {
        const role = resolveRole(user);
        return role === "analyst" || role === "admin";
      });

      const latestClients = await appClient.entities.Client.list();
      const impacted = latestClients.filter((client) =>
        (client.analyst_team_ids || []).includes(userId)
      );

      if (impacted.length > 0) {
        await Promise.all(
          impacted.map((client) => {
            const nextIds = (client.analyst_team_ids || []).filter((id) => id !== userId);
            const nextNames = nextIds
              .map((id) => latestAnalysts.find((user) => user.id === id))
              .filter(Boolean)
              .map((user) => displayName(user));

            return appClient.entities.Client.update(client.id, {
              analyst_team_ids: nextIds,
              analyst_team_names: nextNames,
            });
          })
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["clients"] });
    },
  });

  const openEdit = (analyst) => {
    setEditing(analyst);
    setForm({
      user_id: analyst.id,
      full_name: analyst.full_name || "",
      active: analyst.active !== false,
    });
    setOpen(true);
  };

  const openNew = () => {
    setEditing(null);
    setForm({
      user_id: "",
      full_name: "",
      active: true,
    });
    setOpen(true);
  };

  const onSelectUser = (userId) => {
    const selected = promotableUsers.find((user) => user.id === userId);
    setForm((prev) => ({
      ...prev,
      user_id: userId,
      full_name: selected?.full_name || "",
      active: selected?.active !== false,
    }));
  };

  if (loading) {
    return (
      <div className="min-h-[200px] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-violet-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="py-12 text-center text-gray-500">
          Access denied. This page is visible only to admin users.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-border/65 bg-card/95 shadow-[var(--shadow-soft)]">
        <CardContent className="space-y-4 p-4 md:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <p className="app-kicker">Team analyst</p>
              <p className="text-sm text-muted-foreground">Gestione utenti analyst e workload clienti.</p>
            </div>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button onClick={openNew} className="h-9 text-sm">
                  <Plus className="mr-1.5 h-4 w-4" /> Aggiungi analyst
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{editing ? "Modifica analyst" : "Promuovi utente ad analyst"}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  {!editing && (
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-muted-foreground">Utente registrato *</Label>
                      <Select value={form.user_id} onValueChange={onSelectUser}>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleziona utente" />
                        </SelectTrigger>
                        <SelectContent>
                          {promotableUsers.map((user) => (
                            <SelectItem key={user.id} value={user.id}>
                              {displayName(user)} ({user.email})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {promotableUsers.length === 0 && (
                        <p className="text-xs text-muted-foreground">Nessun utente promuovibile disponibile.</p>
                      )}
                    </div>
                  )}

                  {editing && (
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-muted-foreground">Email</Label>
                      <Input value={editing.email || ""} disabled />
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-muted-foreground">Nome visualizzato *</Label>
                    <Input
                      value={form.full_name}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, full_name: event.target.value }))
                      }
                      placeholder="Nome completo"
                    />
                  </div>

                  <div className="flex items-center gap-3">
                    <Switch
                      checked={form.active}
                      onCheckedChange={(value) =>
                        setForm((prev) => ({ ...prev, active: value }))
                      }
                    />
                    <Label className="text-sm">Attivo</Label>
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="outline" onClick={() => setOpen(false)}>
                      Annulla
                    </Button>
                    <Button
                      onClick={() => saveMutation.mutate(form)}
                      disabled={
                        saveMutation.isPending ||
                        !form.full_name.trim() ||
                        (!editing && !form.user_id)
                      }
                    >
                      {editing ? "Salva" : "Promuovi"}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-border/70 bg-card px-3.5 py-3">
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Users className="h-3.5 w-3.5" /> Analyst totali
              </p>
              <p className="mt-1 text-xl font-semibold">{analystMetrics.total}</p>
            </div>
            <div className="rounded-xl border border-border/70 bg-card px-3.5 py-3">
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <UserCheck className="h-3.5 w-3.5" /> Analyst attivi
              </p>
              <p className="mt-1 text-xl font-semibold">{analystMetrics.active}</p>
            </div>
            <div className="rounded-xl border border-border/70 bg-card px-3.5 py-3">
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Ticket className="h-3.5 w-3.5" /> Open ticket creati
              </p>
              <p className="mt-1 text-xl font-semibold">{analystMetrics.openCreated}</p>
            </div>
            <div className="rounded-xl border border-border/70 bg-card px-3.5 py-3">
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <BarChart3 className="h-3.5 w-3.5" /> Clienti coperti
              </p>
              <p className="mt-1 text-xl font-semibold">{analystMetrics.assignedClients}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setStatusFilter("all")}
              className={cn(
                "inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors",
                statusFilter === "all"
                  ? "border-primary/35 bg-primary/15 text-foreground dark:border-primary/55 dark:bg-primary/20"
                  : "border-border bg-background text-muted-foreground hover:text-foreground"
              )}
            >
              Tutti ({analysts.length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("active")}
              className={cn(
                "inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors",
                statusFilter === "active"
                  ? "border-primary/35 bg-primary/15 text-foreground dark:border-primary/55 dark:bg-primary/20"
                  : "border-border bg-background text-muted-foreground hover:text-foreground"
              )}
            >
              Attivi ({analystMetrics.active})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("inactive")}
              className={cn(
                "inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors",
                statusFilter === "inactive"
                  ? "border-primary/35 bg-primary/15 text-foreground dark:border-primary/55 dark:bg-primary/20"
                  : "border-border bg-background text-muted-foreground hover:text-foreground"
              )}
            >
              Inattivi ({Math.max(0, analystMetrics.total - analystMetrics.active)})
            </button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visibleAnalysts.map((analyst) => {
          const openTickets = getOpenTicketsCreated(analyst.email);
          const assignedClients = getAssignedClients(analyst.id);
          const isActive = analyst.active !== false;
          const activeBadgeClass = isActive
            ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/35"
            : "bg-muted text-muted-foreground border-border";

          return (
            <Card
              key={analyst.id}
              className={cn(
                "border border-border/70 shadow-sm app-hover-lift bg-card/95",
                isActive ? "" : "opacity-65"
              )}
            >
              <CardContent className="p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar className="w-10 h-10">
                      <AvatarFallback className="text-sm font-bold bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white">
                        {displayName(analyst)
                          .split(" ")
                          .map((part) => part[0])
                          .join("")
                          .slice(0, 2)
                          .toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate">{displayName(analyst)}</p>
                      <p className="text-[11px] text-gray-500 truncate">{analyst.email}</p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => openEdit(analyst)}
                  >
                    <Pencil className="w-3 h-3 text-muted-foreground" />
                  </Button>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/35 px-2.5 py-2 text-xs">
                    <span className="inline-flex items-center gap-1">
                      <Ticket className="w-3.5 h-3.5" />
                      Open ticket creati
                    </span>
                    <span className="font-semibold">{openTickets}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/35 px-2.5 py-2 text-xs">
                    <span className="inline-flex items-center gap-1">
                      <Building2 className="w-3.5 h-3.5" />
                      Clienti assegnati
                    </span>
                    <span className="font-semibold">{assignedClients}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <Badge
                    variant="outline"
                    className={`text-[10px] border ${activeBadgeClass}`}
                  >
                    {isActive ? "Attivo" : "Inattivo"}
                  </Badge>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[11px] text-amber-700 hover:bg-amber-50 hover:text-amber-800 dark:text-amber-300 dark:hover:bg-amber-500/10"
                    onClick={() => demoteMutation.mutate(analyst.id)}
                    disabled={demoteMutation.isPending}
                  >
                    <UserX className="w-3 h-3 mr-1" />
                    Rimuovi
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {visibleAnalysts.length === 0 && (
          <Card className="col-span-full border border-border/70 shadow-sm bg-card/95">
            <CardContent className="py-12 text-center text-muted-foreground">
              <UserCheck className="mx-auto mb-2 h-8 w-8 text-muted-foreground/70" />
              Nessun analyst in questa vista. Promuovi un utente registrato.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
