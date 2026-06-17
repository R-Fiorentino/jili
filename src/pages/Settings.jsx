import React, { useState, useEffect } from "react";
import { appClient } from "@/api/appClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Save, CheckCircle } from "lucide-react";
import {
  DEFAULT_CONFIG,
  calculatePriorityScore,
  getIndustryOptions,
  isOpenStatus,
} from "../components/shared/priorityUtils";
import { useNavigate } from "react-router-dom";

function parseIndustryOptionsInput(value) {
  return Array.from(
    new Set(
      String(value || "")
        .split("\n")
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  );
}

function buildComparableSettingsDraft(form, industryOptionsInput) {
  return {
    age_coefficient: Number(form?.age_coefficient) || 0,
    tier_scores: {
      P1: Number(form?.tier_scores?.P1) || 0,
      P2: Number(form?.tier_scores?.P2) || 0,
      P3: Number(form?.tier_scores?.P3) || 0,
    },
    deadline_bonus: {
      overdue: Number(form?.deadline_bonus?.overdue) || 0,
      today: Number(form?.deadline_bonus?.today) || 0,
      next_3_days: Number(form?.deadline_bonus?.next_3_days) || 0,
      next_7_days: Number(form?.deadline_bonus?.next_7_days) || 0,
    },
    effort_penalty_per_hour: Number(form?.effort_penalty_per_hour) || 0,
    industry_options: parseIndustryOptionsInput(industryOptionsInput),
    report_permissions: {
      edit_roles: Array.from(
        new Set(
          (form?.report_permissions?.edit_roles || [])
            .map((role) => String(role || "").trim().toLowerCase())
            .filter(Boolean)
        )
      ).sort(),
    },
  };
}

export default function Settings() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);
  const [recalcCount, setRecalcCount] = useState(0);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [leaveAlertOpen, setLeaveAlertOpen] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState(null);
  const [industryOptionsInput, setIndustryOptionsInput] = useState(
    (DEFAULT_CONFIG.industry_options || []).join("\n")
  );
  const baselineSnapshotRef = React.useRef(
    JSON.stringify(
      buildComparableSettingsDraft(
        DEFAULT_CONFIG,
        (DEFAULT_CONFIG.industry_options || []).join("\n")
      )
    )
  );
  const historyGuardArmedRef = React.useRef(false);
  const skipNextPopStateRef = React.useRef(false);

  const { data: configList = [], isLoading } = useQuery({
    queryKey: ["priority_config"],
    queryFn: () => appClient.entities.PriorityConfig.list(),
  });

  const existing = configList[0];
  const [form, setForm] = useState(DEFAULT_CONFIG);

  useEffect(() => {
    if (existing) {
      const savedReportEditRoles = Array.isArray(existing?.report_permissions?.edit_roles)
        ? existing.report_permissions.edit_roles
            .map((role) => String(role || "").trim().toLowerCase())
            .filter(Boolean)
        : [];

      setForm({
        age_coefficient: existing.age_coefficient ?? 2,
        tier_scores: { ...DEFAULT_CONFIG.tier_scores, ...existing.tier_scores },
        deadline_bonus: { ...DEFAULT_CONFIG.deadline_bonus, ...existing.deadline_bonus },
        effort_penalty_per_hour: existing.effort_penalty_per_hour ?? DEFAULT_CONFIG.effort_penalty_per_hour,
        industry_options: getIndustryOptions(existing),
        report_permissions: {
          ...DEFAULT_CONFIG.report_permissions,
          ...(existing.report_permissions || {}),
          edit_roles: savedReportEditRoles.length > 0
            ? Array.from(new Set(savedReportEditRoles))
            : DEFAULT_CONFIG.report_permissions.edit_roles,
        },
      });
      const nextIndustryInput = getIndustryOptions(existing).join("\n");
      setIndustryOptionsInput(nextIndustryInput);
      baselineSnapshotRef.current = JSON.stringify(
        buildComparableSettingsDraft(
          {
            age_coefficient: existing.age_coefficient ?? 2,
            tier_scores: { ...DEFAULT_CONFIG.tier_scores, ...existing.tier_scores },
            deadline_bonus: { ...DEFAULT_CONFIG.deadline_bonus, ...existing.deadline_bonus },
            effort_penalty_per_hour: existing.effort_penalty_per_hour ?? DEFAULT_CONFIG.effort_penalty_per_hour,
            report_permissions: {
              ...DEFAULT_CONFIG.report_permissions,
              ...(existing.report_permissions || {}),
              edit_roles: savedReportEditRoles.length > 0
                ? Array.from(new Set(savedReportEditRoles))
                : DEFAULT_CONFIG.report_permissions.edit_roles,
            },
          },
          nextIndustryInput
        )
      );
      setHasUnsavedChanges(false);
    }
  }, [existing]);

  useEffect(() => {
    const currentSnapshot = JSON.stringify(buildComparableSettingsDraft(form, industryOptionsInput));
    setHasUnsavedChanges(currentSnapshot !== baselineSnapshotRef.current);
  }, [form, industryOptionsInput]);

  useEffect(() => {
    if (!hasUnsavedChanges) {
      setLeaveAlertOpen(false);
      setPendingNavigation(null);
    }
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!hasUnsavedChanges) return undefined;

    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!hasUnsavedChanges) return undefined;

    const handleDocumentClick = (event) => {
      if (event.defaultPrevented) return;
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!anchor) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      const rawHref = anchor.getAttribute("href");
      if (!rawHref || rawHref.startsWith("#")) return;

      const nextUrl = new URL(anchor.href, window.location.origin);
      const currentUrl = new URL(window.location.href);
      const isSameDestination =
        nextUrl.pathname === currentUrl.pathname &&
        nextUrl.search === currentUrl.search &&
        nextUrl.hash === currentUrl.hash;

      if (isSameDestination) return;

      event.preventDefault();
      setPendingNavigation({
        type: nextUrl.origin === window.location.origin ? "internal" : "external",
        to: `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`,
        href: nextUrl.href,
      });
      setLeaveAlertOpen(true);
    };

    document.addEventListener("click", handleDocumentClick, true);
    return () => document.removeEventListener("click", handleDocumentClick, true);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!hasUnsavedChanges) {
      historyGuardArmedRef.current = false;
      return undefined;
    }

    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (!historyGuardArmedRef.current) {
      window.history.pushState({ settingsGuard: true }, "", currentUrl);
      historyGuardArmedRef.current = true;
    }

    const handlePopState = () => {
      if (skipNextPopStateRef.current) {
        skipNextPopStateRef.current = false;
        return;
      }

      window.history.pushState({ settingsGuard: true }, "", currentUrl);
      setPendingNavigation({ type: "history-back" });
      setLeaveAlertOpen(true);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [hasUnsavedChanges]);

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      const normalizedEditRoles = Array.from(
        new Set(
          (data?.report_permissions?.edit_roles || [])
            .map((role) => String(role || "").trim().toLowerCase())
            .filter(Boolean)
        )
      );

      const payload = {
        ...data,
        mode: "standard",
        config_key: "default",
        tier_scores: {
          P1: Number(data?.tier_scores?.P1) || DEFAULT_CONFIG.tier_scores.P1,
          P2: Number(data?.tier_scores?.P2) || DEFAULT_CONFIG.tier_scores.P2,
          P3: Number(data?.tier_scores?.P3) || DEFAULT_CONFIG.tier_scores.P3,
        },
        industry_options: parseIndustryOptionsInput(industryOptionsInput),
        report_permissions: {
          edit_roles: normalizedEditRoles.length > 0
            ? normalizedEditRoles
            : [...DEFAULT_CONFIG.report_permissions.edit_roles],
        },
      };
      const savedConfig = await (existing
        ? appClient.entities.PriorityConfig.update(existing.id, payload)
        : appClient.entities.PriorityConfig.create(payload));

      // Recalculate priority_score for open tickets to keep pipeline consistent
      const [tickets, clients] = await Promise.all([
        appClient.entities.Ticket.list(),
        appClient.entities.Client.list(),
      ]);
      const clientMap = new Map(clients.map((client) => [client.id, client]));

      const updates = tickets
        .filter((ticket) => isOpenStatus(ticket.status))
        .map((ticket) => {
          const client = clientMap.get(ticket.client_id);
          const nextScore = calculatePriorityScore(ticket, client, payload);
          const currentScore = Number(ticket.priority_score) || 0;
          return {
            id: ticket.id,
            nextScore,
            shouldUpdate: nextScore !== currentScore,
          };
        })
        .filter((entry) => entry.shouldUpdate);

      const CHUNK_SIZE = 25;
      for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
        const chunk = updates.slice(i, i + CHUNK_SIZE);
        await Promise.all(
          chunk.map((entry) =>
            appClient.entities.Ticket.update(entry.id, { priority_score: entry.nextScore })
          )
        );
      }

      return { savedConfig, updatedCount: updates.length };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["priority_config"] });
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
      const normalizedOptions = parseIndustryOptionsInput(industryOptionsInput);
      const nextForm = { ...form, industry_options: normalizedOptions };
      setForm(nextForm);
      setIndustryOptionsInput(normalizedOptions.join("\n"));
      baselineSnapshotRef.current = JSON.stringify(
        buildComparableSettingsDraft(nextForm, normalizedOptions.join("\n"))
      );
      setHasUnsavedChanges(false);
      setSaved(true);
      setRecalcCount(result?.updatedCount || 0);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const updateNested = (section, key, value) => {
    setForm(prev => ({
      ...prev,
      [section]: { ...prev[section], [key]: parseFloat(value) || 0 },
    }));
  };

  const toggleReportRole = (role) => {
    const normalizedRole = String(role || "").trim().toLowerCase();
    if (!normalizedRole) return;

    setForm((prev) => {
      const currentRoles = Array.isArray(prev?.report_permissions?.edit_roles)
        ? prev.report_permissions.edit_roles
            .map((entry) => String(entry || "").trim().toLowerCase())
            .filter(Boolean)
        : [...DEFAULT_CONFIG.report_permissions.edit_roles];

      const hasRole = currentRoles.includes(normalizedRole);
      const nextRoles = hasRole
        ? currentRoles.filter((entry) => entry !== normalizedRole)
        : [...currentRoles, normalizedRole];

      const safeRoles = nextRoles.length > 0
        ? Array.from(new Set(nextRoles))
        : [...DEFAULT_CONFIG.report_permissions.edit_roles];

      return {
        ...prev,
        report_permissions: {
          ...(prev.report_permissions || DEFAULT_CONFIG.report_permissions),
          edit_roles: safeRoles,
        },
      };
    });
  };

  const handleStayOnPage = () => {
    setLeaveAlertOpen(false);
    setPendingNavigation(null);
  };

  const handleLeaveWithoutSaving = () => {
    const nextNavigation = pendingNavigation;
    setLeaveAlertOpen(false);
    setPendingNavigation(null);

    if (!nextNavigation) return;

    skipNextPopStateRef.current = true;

    if (nextNavigation.type === "history-back") {
      setHasUnsavedChanges(false);
      window.history.back();
      return;
    }

    if (nextNavigation.type === "external") {
      setHasUnsavedChanges(false);
      window.location.href = nextNavigation.href;
      return;
    }

    setHasUnsavedChanges(false);
    navigate(nextNavigation.to);
  };

  if (isLoading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-4">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Ticket Priority
            </p>
            <CardTitle className="text-base font-semibold">Regole di priorità</CardTitle>
            <p className="text-sm text-muted-foreground">
              La priorità viene calcolata con questa formula: tier + età ticket + urgenza deadline − penalità effort.
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
            <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
              <Label className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Age coefficient
              </Label>
              <Input
                type="number"
                value={form.age_coefficient}
                onChange={e => setForm({ ...form, age_coefficient: parseFloat(e.target.value) || 0 })}
                className="mt-3 h-10"
              />
              <p className="mt-2 text-xs text-muted-foreground">Punti aggiunti per ogni giorno dalla creazione.</p>
            </div>

            <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
              <Label className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Client tier scores
              </Label>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {["P1", "P2", "P3"].map((tier) => (
                  <div key={tier} className="space-y-1.5">
                    <Label className="text-xs font-semibold text-muted-foreground">{tier}</Label>
                    <Input
                      type="number"
                      value={form.tier_scores[tier]}
                      onChange={e => updateNested("tier_scores", tier, e.target.value)}
                      className="h-10"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.5fr_260px]">
            <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
              <Label className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Deadline urgency bonus
              </Label>
              <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                {[
                  { key: "overdue", label: "Scaduto" },
                  { key: "today", label: "Oggi" },
                  { key: "next_3_days", label: "Entro 3gg" },
                  { key: "next_7_days", label: "Entro 7gg" },
                ].map(({ key, label }) => (
                  <div key={key} className="space-y-1.5">
                    <Label className="text-xs font-semibold text-muted-foreground">{label}</Label>
                    <Input
                      type="number"
                      value={form.deadline_bonus?.[key] ?? 0}
                      onChange={e => updateNested("deadline_bonus", key, e.target.value)}
                      className="h-10"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
              <Label className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Effort penalty
              </Label>
              <Input
                type="number"
                step="0.1"
                value={form.effort_penalty_per_hour}
                onChange={e => setForm({ ...form, effort_penalty_per_hour: parseFloat(e.target.value) || 0 })}
                className="mt-3 h-10"
              />
              <p className="mt-2 text-xs text-muted-foreground">Punti sottratti per ogni ora di effort pianificato.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-4">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Shared Options
            </p>
            <CardTitle className="text-base font-semibold">Impostazioni condivise</CardTitle>
            <p className="text-sm text-muted-foreground">
              Opzioni che vengono riusate tra clienti, report test e filtri dell&apos;applicazione.
            </p>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
            <Label className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Industry list
            </Label>
            <p className="mt-2 text-xs text-muted-foreground">
              Una industry per riga. Le modifiche vengono applicate ai select cliente, report test e test riportati.
            </p>
            <Textarea
              value={industryOptionsInput}
              onChange={(event) => setIndustryOptionsInput(event.target.value)}
              className="mt-3 min-h-[220px]"
              placeholder={`Telco\nFashion e-commerce\nEnergy`}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              {parseIndustryOptionsInput(industryOptionsInput).map((industry) => (
                <span
                  key={industry}
                  className="inline-flex h-8 items-center rounded-full border border-border bg-card px-3 text-xs font-medium text-foreground"
                >
                  {industry}
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
            <Label className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Report permissions
            </Label>
            <p className="mt-2 text-xs text-muted-foreground">
              Il report è visibile a tutti. Qui definisci chi può modificarlo e generare il contenuto.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {[
                { key: "admin", label: "Admin" },
                { key: "analyst", label: "Analyst" },
                { key: "developer", label: "Developer" },
              ].map((role) => {
                const selected = (form?.report_permissions?.edit_roles || []).includes(role.key);
                return (
                  <button
                    key={role.key}
                    type="button"
                    onClick={() => toggleReportRole(role.key)}
                    className={`h-9 rounded-xl border px-3 text-xs font-medium transition-colors ${
                      selected
                        ? "border-violet-300 bg-violet-100 text-violet-700"
                        : "border-border bg-card text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {role.label}
                  </button>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          onClick={() => saveMutation.mutate(form)}
          disabled={saveMutation.isPending}
          className="h-10 px-6"
        >
          {saveMutation.isPending ? (
            <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
          ) : saved ? (
            <CheckCircle className="w-4 h-4 mr-1.5 text-emerald-400" />
          ) : (
            <Save className="w-4 h-4 mr-1.5" />
          )}
          {saved ? "Saved!" : "Save Configuration"}
        </Button>
      </div>
      {saved && (
        <p className="text-xs text-emerald-700 text-right">
          Priorità ricalcolate: {recalcCount} ticket aperti aggiornati.
        </p>
      )}

      <AlertDialog open={leaveAlertOpen} onOpenChange={setLeaveAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ci sono modifiche non salvate</AlertDialogTitle>
            <AlertDialogDescription>
              Se esci ora perderai le modifiche alle impostazioni non ancora salvate.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleStayOnPage}>Resta nella pagina</AlertDialogCancel>
            <AlertDialogAction onClick={handleLeaveWithoutSaving}>Esci senza salvare</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
