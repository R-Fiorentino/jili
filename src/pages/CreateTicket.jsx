import React, { useMemo, useState } from "react";
import { appClient } from "@/api/appClient";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
import { ArrowLeft, Plus, X, Loader2 } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { createPageUrl, getHomePageForRole, hasTechSupervisorCapability, normalizeAppRole } from "@/utils";
import {
  calculatePriorityScore,
  DEFAULT_CONFIG,
  getPlannedEffortHours,
  isSchedulableTicket,
} from "../components/shared/priorityUtils";
import {
  buildWeeklyRebalanceUpdates,
  findOptimalSchedule,
  getDynamicRebalanceOptions,
} from "./DevPipeline";
import { useCurrentUser } from "../components/shared/useCurrentUser";
import ClientSelect from "../components/shared/ClientSelect";
import { notifyClientTicketUpdate, notifyTicketAssigned } from "@/lib/notificationService";
import { buildReferenceLinksPayload, normalizeReferenceLinks } from "../components/shared/ticketReferenceLinks";
import MarkdownEditor from "../components/shared/MarkdownEditor";

export default function CreateTicket() {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const [form, setForm] = useState({
    title: "",
    description: "",
    required_tracking: "",
    client_id: "",
    type: "ab_test",
    proposed_effort: "",
    reference_links: [""],
    no_reference_needed: false,
    deadline: "",
  });

  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: () => appClient.entities.Client.list(),
  });

  const { data: developers = [] } = useQuery({
    queryKey: ["developers"],
    queryFn: () => appClient.entities.Developer.list(),
  });

  const { data: tickets = [] } = useQuery({
    queryKey: ["tickets"],
    queryFn: () => appClient.entities.Ticket.list(),
  });

  const resolveOperationsDevelopers = (client, developerList) => {
    if (!client) return [];

    const activeDevelopers = developerList.filter((developer) => developer.active !== false);
    const byId = new Map(activeDevelopers.map((developer) => [developer.id, developer]));
    const uniqueDevelopers = [];
    const seenIds = new Set();

    (client.operations_ids || []).forEach((id) => {
      const developer = byId.get(id);
      if (developer && !seenIds.has(developer.id)) {
        seenIds.add(developer.id);
        uniqueDevelopers.push(developer);
      }
    });

    if (uniqueDevelopers.length > 0) return uniqueDevelopers;

    const normalizedOperationNames = (client.operations_names || [])
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean);

    if (normalizedOperationNames.length === 0) return [];

    return activeDevelopers.filter((developer) => {
      const normalizedName = String(developer.name || "").trim().toLowerCase();
      const normalizedEmail = String(developer.email || "").trim().toLowerCase();
      return (
        normalizedOperationNames.includes(normalizedName) ||
        normalizedOperationNames.includes(normalizedEmail)
      );
    });
  };

  const pickBestOperationsDeveloper = (client, developerList, ticketList) => {
    const candidates = resolveOperationsDevelopers(client, developerList);
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    const devLoad = {};
    candidates.forEach((developer) => {
      devLoad[developer.id] = 0;
    });

    ticketList
      .filter((ticket) => isSchedulableTicket(ticket))
      .forEach((ticket) => {
        if (devLoad[ticket.assignee_id] !== undefined) {
          devLoad[ticket.assignee_id] += getPlannedEffortHours(ticket);
        }
      });

    return [...candidates].sort((a, b) => {
      const weeklyCapacityA = (Number(a.daily_capacity) || 8) * 5;
      const weeklyCapacityB = (Number(b.daily_capacity) || 8) * 5;
      const availableA = weeklyCapacityA - (devLoad[a.id] || 0);
      const availableB = weeklyCapacityB - (devLoad[b.id] || 0);

      if (availableB !== availableA) return availableB - availableA;

      const loadA = devLoad[a.id] || 0;
      const loadB = devLoad[b.id] || 0;
      if (loadA !== loadB) return loadA - loadB;

      return String(a.name || "").localeCompare(String(b.name || ""));
    })[0];
  };

  const selectedClient = clients.find(c => c.id === form.client_id);
  const roleHomePage = getHomePageForRole(normalizeAppRole(user?.app_role || user?._app_role || user?.role));
  const isTechSupervisor = hasTechSupervisorCapability(user);
  const homePageUrl = createPageUrl(roleHomePage);
  const plannedEffort = Number(form.proposed_effort);
  const hasValidPlannedEffort = Number.isFinite(plannedEffort) && plannedEffort > 0;
  const normalizedReferenceLinks = normalizeReferenceLinks(form.reference_links);
  const hasValidLink = form.no_reference_needed || normalizedReferenceLinks.length > 0;
  const hasValidDeadline = form.deadline.trim().length > 0;
  const suggestedAssignee = useMemo(
    () => pickBestOperationsDeveloper(selectedClient, developers, tickets),
    [selectedClient, developers, tickets]
  );

  const handleClientChange = (clientId) => {
    const client = clients.find(c => c.id === clientId);
    if (!client) {
      return setForm((prev) => ({
        ...prev,
        client_id: clientId,
        assignee_id: "",
        assignee_name: "",
        assignee_email: "",
      }));
    }

    const opsDev = pickBestOperationsDeveloper(client, developers, tickets);

    setForm(prev => ({
      ...prev,
      client_id: clientId,
      assignee_id: opsDev?.id || "",
      assignee_name: opsDev?.name || "",
      assignee_email: opsDev?.email || "",
    }));
  };

  const { data: configList = [] } = useQuery({
    queryKey: ["priority_config"],
    queryFn: () => appClient.entities.PriorityConfig.list(),
  });

  const config = configList[0] || DEFAULT_CONFIG;

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const normalizedEffort = Number(data.proposed_effort);
      const referencePayload = buildReferenceLinksPayload(data.reference_links);
      if (!Number.isFinite(normalizedEffort) || normalizedEffort <= 0) {
        throw new Error("Inserisci un effort previsto valido.");
      }
      if (!data.deadline?.trim()) {
        throw new Error("Inserisci una deadline.");
      }
      if (!data.no_reference_needed && referencePayload.reference_links.length === 0) {
        throw new Error("Inserisci almeno un link di reference oppure indica che non serve.");
      }

      const client = clients.find(c => c.id === data.client_id);
      const latestTickets = await appClient.entities.Ticket.list();
      const autoAssignedDeveloper = pickBestOperationsDeveloper(client, developers, latestTickets);
      const ticketDifficulty = "medium";
      const priorityScore = calculatePriorityScore(
        { ...data, difficulty: ticketDifficulty, created_date: new Date().toISOString() },
        client,
        config
      );

      const ticketData = {
        ...data,
        ...referencePayload,
        difficulty: ticketDifficulty,
        client_name: client?.name || "",
        status: "new",
        assignee_id: autoAssignedDeveloper?.id || "",
        assignee_name: autoAssignedDeveloper?.name || "",
        assignee_email: autoAssignedDeveloper?.email || "",
        proposed_effort: normalizedEffort,
        deadline: data.deadline,
        priority_score: priorityScore,
        audit_log: [{
          timestamp: new Date().toISOString(),
          user: "analyst",
          action: "created",
          details: "Ticket created",
        }],
        comments: [],
      };

      // Remove helper fields not in schema
      delete ticketData.assignee_id_temp;
      delete ticketData.no_reference_needed;
      delete ticketData.reference_links_temp;
      const createdTicket = await appClient.entities.Ticket.create(ticketData);

      // Rebuild pipeline for assigned developer in dynamic mode (gap-free).
      if (createdTicket.assignee_id) {
        const dev = developers.find(d => d.id === createdTicket.assignee_id);
        if (isTechSupervisor) {
          const reviewSafeSlots = findOptimalSchedule(
            latestTickets,
            createdTicket.assignee_id,
            normalizedEffort,
            dev?.daily_capacity || 8,
            dev
          );

          if (reviewSafeSlots.length > 0) {
            const [first, ...rest] = reviewSafeSlots;
            await appClient.entities.Ticket.update(createdTicket.id, {
              scheduled_date: first.date,
              start_time: first.start_time,
              end_time: first.end_time,
              continuation_schedule: rest.map((segment) => ({
                date: segment.date,
                start_time: segment.start_time,
                end_time: segment.end_time,
              })),
            });
          }
        } else {
          const nextTickets = [...latestTickets, createdTicket];
          const updates = buildWeeklyRebalanceUpdates(
            nextTickets,
            createdTicket.assignee_id,
            dev,
            getDynamicRebalanceOptions({
              preserveWorkingDaysFromToday: 3,
            })
          );

          if (updates.length > 0) {
            await Promise.all(
              updates.map((entry) => appClient.entities.Ticket.update(entry.id, entry.updates))
            );
          }
        }

        await notifyTicketAssigned({
          ticket: createdTicket,
          actor: user,
        }).catch(() => {});
      }

      if (client) {
        await notifyClientTicketUpdate({
          ticket: createdTicket,
          actor: user,
          client,
          title: "Nuovo ticket cliente",
          body: `${createdTicket.title}${createdTicket.assignee_name ? ` · assegnato a ${createdTicket.assignee_name}` : ""}`,
          metadata: {
            reason: "ticket_created",
          },
        }).catch(() => {});
      }

      return createdTicket;
    },
    onSuccess: () => {
      navigate(homePageUrl);
    },
    onError: (error) => {
      const rawMessage = String(error?.message || "");
      const isPermissionError = /insufficient permissions|missing or insufficient permissions|permission/i.test(rawMessage);
      toast({
        title: isPermissionError ? "Permessi insufficienti" : "Compila i campi obbligatori",
        description: isPermissionError
          ? "Il tuo profilo non e ancora allineato ai permessi richiesti. Esci e rientra una volta, poi riprova. Se sul deploy continua, aggiorna anche le Firestore rules."
          : error?.message || "Verifica effort previsto, link/reference e deadline prima di creare il ticket.",
        variant: "destructive",
      });
    },
  });

  const update = (field, value) => setForm(prev => ({ ...prev, [field]: value }));
  const updateReferenceLink = (index, value) => {
    setForm((prev) => ({
      ...prev,
      reference_links: prev.reference_links.map((link, linkIndex) => (linkIndex === index ? value : link)),
    }));
  };
  const addReferenceLink = () => {
    setForm((prev) => ({
      ...prev,
      reference_links: [...prev.reference_links, ""],
    }));
  };
  const removeReferenceLink = (index) => {
    setForm((prev) => {
      const nextLinks = prev.reference_links.filter((_, linkIndex) => linkIndex !== index);
      return {
        ...prev,
        reference_links: nextLinks.length > 0 ? nextLinks : [""],
      };
    });
  };

  return (
    <div className="mx-auto max-w-5xl" data-tour="create-ticket-page">
      <Link
        to={homePageUrl}
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-4 sm:mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Torna indietro
      </Link>

      <Card className="border-0 shadow-lg">
        <CardContent className="space-y-8 pt-6">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Nuovo ticket</p>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Imposta contesto, richiesta e materiali del test</h1>
            <p className="text-sm text-muted-foreground">
              Il ticket viene assegnato automaticamente al team operations del cliente e pianificato in pipeline con priority score, deadline ed effort previsto.
            </p>
          </div>

          <section className="space-y-4 rounded-3xl border border-border/65 bg-card/70 p-5 shadow-[var(--shadow-soft)]" data-tour="create-ticket-brief">
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Brief del test</p>
              <h2 className="text-lg font-semibold text-foreground">Cosa deve essere sviluppato</h2>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-gray-600">Titolo *</Label>
              <Input
                value={form.title}
                onChange={e => update("title", e.target.value)}
                placeholder="Es. Test CTA hero PDP"
                className="h-10"
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-gray-600">Descrizione *</Label>
                <MarkdownEditor
                  value={form.description}
                  onChange={value => update("description", value)}
                  placeholder="Spiega obiettivo del test, cambi richiesti, contesto e aspettative operative..."
                  minHeightClass="min-h-[180px]"
                  label="descrizione del ticket"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-gray-600">Tracciamenti richiesti</Label>
                <MarkdownEditor
                  value={form.required_tracking}
                  onChange={value => update("required_tracking", value)}
                  placeholder="Elenca eventi, naming, parametri, dataLayer, check analytics o controlli di tracking..."
                  minHeightClass="min-h-[180px]"
                  label="tracciamenti richiesti"
                />
              </div>
            </div>
          </section>

          <section className="space-y-4 rounded-3xl border border-border/65 bg-card/70 p-5 shadow-[var(--shadow-soft)]" data-tour="create-ticket-context">
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Contesto operativo</p>
              <h2 className="text-lg font-semibold text-foreground">Cliente, tipo test e pianificazione</h2>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="space-y-1.5 xl:col-span-2">
                <Label className="text-xs font-semibold text-gray-600">Cliente *</Label>
                <ClientSelect
                  clients={clients}
                  value={form.client_id}
                  onValueChange={handleClientChange}
                  placeholder="Seleziona cliente"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-gray-600">Tipo</Label>
                <Select value={form.type} onValueChange={v => update("type", v)}>
                  <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ab_test">A/B Test</SelectItem>
                    <SelectItem value="cro">CRO</SelectItem>
                    <SelectItem value="tracking">Tracking</SelectItem>
                    <SelectItem value="ui_change">UI Change</SelectItem>
                    <SelectItem value="bug_fix">Bug Fix</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-gray-600">Deadline *</Label>
                <Input
                  type="date"
                  value={form.deadline}
                  onChange={e => update("deadline", e.target.value)}
                  className="h-10"
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_320px]">
              {selectedClient && (selectedClient.tech_supervisor_name || (selectedClient.operations_names || []).length > 0 || (selectedClient.analyst_team_names || []).length > 0) ? (
                <div className="rounded-2xl border border-border/65 bg-muted/30 p-4 text-xs">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Team cliente</p>
                  <div className="mt-3 flex flex-wrap gap-3 text-muted-foreground">
                    {selectedClient.tech_supervisor_name && (
                      <div className="flex items-center gap-1.5">
                        <span>Supervisor:</span>
                        <span className="font-medium text-foreground">{selectedClient.tech_supervisor_name}</span>
                      </div>
                    )}
                    {(selectedClient.operations_names || []).length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span>Operations:</span>
                        {selectedClient.operations_names.map((n, i) => (
                          <span key={i} className="rounded-full bg-blue-50 px-2 py-0.5 font-medium text-blue-700">{n}</span>
                        ))}
                      </div>
                    )}
                    {(selectedClient.analyst_team_names || []).length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span>Analyst:</span>
                        {selectedClient.analyst_team_names.map((n, i) => (
                          <span key={i} className="rounded-full bg-violet-50 px-2 py-0.5 font-medium text-violet-700">{n}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  {suggestedAssignee ? (
                    <p className="mt-3 text-[11px] text-muted-foreground">
                      Assegnazione automatica: <strong className="text-foreground">{suggestedAssignee.name}</strong>{" "}
                      ({(selectedClient?.operations_ids || []).length > 1 || (selectedClient?.operations_names || []).length > 1
                        ? "operations piu libero"
                        : "operations cliente"})
                    </p>
                  ) : (
                    <p className="mt-3 text-[11px] text-amber-600">
                      Nessun developer operations attivo trovato per questo cliente: il ticket verra creato senza assegnazione.
                    </p>
                  )}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-border/65 bg-muted/20 p-4 text-sm text-muted-foreground">
                  Seleziona un cliente per vedere il team assegnato e l&apos;assignee automatico del ticket.
                </div>
              )}

              <div className="space-y-1.5 rounded-2xl border border-border/65 bg-muted/30 p-4">
                <Label className="text-xs font-semibold text-gray-600">Effort previsto (h) *</Label>
                <Input
                  type="number"
                  min="0.5"
                  step="0.5"
                  value={form.proposed_effort}
                  onChange={e => update("proposed_effort", e.target.value)}
                  placeholder="Es. 4"
                  className="h-10"
                />
                <p className="text-[11px] text-muted-foreground">
                  Obbligatorio. Usa step da 0.5h e inserisci la stima richiesta per schedulare correttamente la pipeline.
                </p>
              </div>
            </div>
          </section>

          <section className="space-y-4 rounded-3xl border border-border/65 bg-card/70 p-5 shadow-[var(--shadow-soft)]" data-tour="create-ticket-reference">
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Reference e materiali</p>
              <h2 className="text-lg font-semibold text-foreground">Link utili per il team</h2>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-gray-600">
                  Reference links {form.no_reference_needed ? "" : "*"}
                </Label>
                <div className="space-y-2">
                  {form.reference_links.map((referenceLink, index) => (
                    <div key={index} className="flex gap-2">
                      <Input
                        value={referenceLink}
                        onChange={(e) => updateReferenceLink(index, e.target.value)}
                        placeholder={
                          index === 0
                            ? "https://figma.com/... oppure URL pagina, brief o immagine"
                            : "Aggiungi un altro link utile"
                        }
                        className="h-10"
                        disabled={form.no_reference_needed}
                      />
                      {form.reference_links.length > 1 && (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-10 w-10 shrink-0"
                          onClick={() => removeReferenceLink(index)}
                          disabled={form.no_reference_needed}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
                  <label className="inline-flex w-fit items-center gap-2 text-[11px] text-muted-foreground">
                    <Checkbox
                      checked={form.no_reference_needed}
                      onCheckedChange={(checked) => update("no_reference_needed", checked === true)}
                    />
                    <span>Non serve una reference per questo test</span>
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 w-full sm:w-auto"
                    onClick={addReferenceLink}
                    disabled={form.no_reference_needed}
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Aggiungi link
                  </Button>
                </div>
              </div>
            </div>
          </section>

          <div className="flex flex-col-reverse gap-3 border-t pt-4 sm:flex-row sm:justify-end">
            <Link to={homePageUrl}>
              <Button variant="outline" className="h-9 text-sm w-full sm:w-auto">Annulla</Button>
            </Link>
            <Button
              onClick={() => createMutation.mutate({
                ...form,
                description: form.description.trim(),
                required_tracking: form.required_tracking.trim(),
                reference_links: form.reference_links,
              })}
              disabled={
                !form.title ||
                !form.client_id ||
                !form.description.trim() ||
                !hasValidPlannedEffort ||
                !hasValidLink ||
                !hasValidDeadline ||
                createMutation.isPending
              }
              className="h-9 text-sm w-full sm:w-auto"
            >
              {createMutation.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              Nuovo ticket
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
