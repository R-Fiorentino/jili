import React, { useEffect, useMemo, useState } from "react";
import { appClient } from "@/api/appClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "../components/shared/useCurrentUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { CalendarDays, Plus, Trash2, Repeat2 } from "lucide-react";
import { toast } from "@/components/ui/use-toast";
import moment from "moment";
import {
  buildWeeklyRebalanceUpdates,
  getDynamicRebalanceOptions,
} from "./DevPipeline";
import {
  formatRecurringRuleLabel,
  getNextRecurringDate,
  normalizeRecurringAvailabilityRule,
  normalizeRecurringInterval,
  normalizeRecurringUnit,
  normalizeWeekdays,
} from "@/lib/recurringAvailability";

const DAY_START = 9;
const DAY_END = 18;
const TODAY_STR = moment().format("YYYY-MM-DD");

const TYPE_META = {
  absence: {
    label: "Assenza",
    badgeClass: "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/35",
  },
  call: {
    label: "Blocco",
    badgeClass: "bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/35",
  },
  activity: {
    label: "Blocco",
    badgeClass: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-500/15 dark:text-slate-200 dark:border-slate-500/35",
  },
};

const WEEKDAY_OPTIONS = [
  { value: 1, label: "Lun" },
  { value: 2, label: "Mar" },
  { value: 3, label: "Mer" },
  { value: 4, label: "Gio" },
  { value: 5, label: "Ven" },
  { value: 6, label: "Sab" },
  { value: 7, label: "Dom" },
];

function normalizeType(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "absence") return "absence";
  if (raw === "call" || raw === "meeting") return "activity";
  return "activity";
}

function normalizeBlockLabel(value, type) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const normalized = raw.toLowerCase();
  if ((normalized === "call" || normalized === "meeting" || normalized === "riunione") && type !== "absence") {
    return TYPE_META.activity.label;
  }
  return raw;
}

function timeToDecimal(value) {
  if (!value) return null;
  const [h, m] = String(value).split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h + m / 60;
}

function decimalToTime(value) {
  const normalized = Math.round(Number(value || 0) * 2) / 2;
  const h = Math.floor(normalized);
  const m = Math.round((normalized - h) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function getRomeNow() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${byType.year}-${byType.month}-${byType.day}`;
  const time = `${byType.hour}:${byType.minute}`;
  return {
    date,
    time,
    decimal: timeToDecimal(time),
  };
}

function buildId(prefix, seed = "") {
  return `${prefix}-${seed}-${Date.now()}-${Math.floor(Math.random() * 9999)}`;
}

function clampTimeRange(startRaw, endRaw) {
  const start = Math.max(DAY_START, Math.min(DAY_END, startRaw));
  const end = Math.max(DAY_START, Math.min(DAY_END, endRaw));
  return { start, end };
}

const EMPTY_FORM = {
  recurring: false,
  date: TODAY_STR,
  weekdays: [1, 2, 3, 4, 5],
  recurrence_unit: "week",
  interval: 1,
  start_time: "09:30",
  end_time: "10:00",
  type: "activity",
  label: "",
  start_date: TODAY_STR,
  end_date: "",
  active: true,
};

export default function Availability() {
  const { user, loading, isAdmin, isDeveloper, isTechSupervisor } = useCurrentUser();
  const queryClient = useQueryClient();

  const [selectedDevId, setSelectedDevId] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const romeNow = getRomeNow();

  const { data: developers = [], isLoading } = useQuery({
    queryKey: ["developers"],
    queryFn: () => appClient.entities.Developer.list(),
    enabled: !loading,
  });

  const activeDevelopers = useMemo(
    () => developers.filter((dev) => dev.active !== false),
    [developers]
  );

  useEffect(() => {
    if (loading || developers.length === 0) return;

    const params = new URLSearchParams(window.location.search);
    const requestedDevId = params.get("dev_id");
    const myEmail = String(user?.email || "").toLowerCase();
    const myDeveloper = activeDevelopers.find(
      (dev) => String(dev?.email || "").toLowerCase() === myEmail
    );
    const shouldDefaultToOwnDeveloper = Boolean(myDeveloper) && (isDeveloper || isTechSupervisor || isAdmin);

    if (requestedDevId) {
      const requested = activeDevelopers.find((dev) => dev.id === requestedDevId);
      if (requested && (isAdmin || (myDeveloper && myDeveloper.id === requested.id))) {
        setSelectedDevId((prev) => (prev === requested.id ? prev : requested.id));
        return;
      }
    }

    if (shouldDefaultToOwnDeveloper) {
      setSelectedDevId((prev) => (prev === myDeveloper.id ? prev : myDeveloper.id));
      return;
    }

    if (isAdmin && activeDevelopers.length > 0) {
      setSelectedDevId((prev) => prev || activeDevelopers[0].id);
    }
  }, [loading, developers, isAdmin, isDeveloper, isTechSupervisor, user?.email, activeDevelopers]);

  const selectedDeveloper = developers.find((dev) => dev.id === selectedDevId) || null;

  const canManageSelected = useMemo(() => {
    if (!selectedDeveloper) return false;
    if (isAdmin) return true;
    if (!isDeveloper && !isTechSupervisor) return false;
    return String(selectedDeveloper.email || "").toLowerCase() === String(user?.email || "").toLowerCase();
  }, [selectedDeveloper, isAdmin, isDeveloper, isTechSupervisor, user?.email]);

  const oneTimeSlots = useMemo(() => {
    if (!selectedDeveloper) return [];
    const list = Array.isArray(selectedDeveloper.unavailable_slots)
      ? selectedDeveloper.unavailable_slots
      : [];

    return list
      .map((slot, index) => ({
        ...slot,
        _index: index,
        _id: String(slot?.id || `legacy-${index}`),
        _type: normalizeType(slot?.type),
        label: normalizeBlockLabel(slot?.label, normalizeType(slot?.type)),
      }))
      .filter((slot) => {
        const slotDate = String(slot.date || "");
        if (!slotDate) return false;
        if (slotDate > romeNow.date) return true;
        if (slotDate < romeNow.date) return false;
        const endDecimal = timeToDecimal(slot.end_time);
        return !Number.isFinite(endDecimal) || endDecimal > romeNow.decimal;
      })
      .sort((a, b) => {
        const dateCmp = String(a.date || "").localeCompare(String(b.date || ""));
        if (dateCmp !== 0) return dateCmp;
        return String(a.start_time || "").localeCompare(String(b.start_time || ""));
      });
  }, [selectedDeveloper, romeNow.date, romeNow.decimal]);

  const recurringRules = useMemo(() => {
    if (!selectedDeveloper) return [];
    const list = Array.isArray(selectedDeveloper.recurring_unavailable_slots)
      ? selectedDeveloper.recurring_unavailable_slots
      : [];

    return list
      .map((rule, index) =>
        normalizeRecurringAvailabilityRule(rule, index, {
          dayStart: DAY_START,
          dayEnd: DAY_END,
          defaultStartDate: TODAY_STR,
        })
      )
      .filter(Boolean)
      .map((rule, index) => ({
        ...rule,
        _index: index,
        _id: String(rule.id || `legacy-rec-${index}`),
        _type: normalizeType(rule.type),
        _active: rule.active !== false,
        _nextDate: getNextRecurringDate(rule),
        label: normalizeBlockLabel(rule.label, normalizeType(rule.type)),
      }))
      .filter((rule) => {
        if (rule._active === false && !rule.end_date) return true;
        if (rule._nextDate) return true;
        return !rule.end_date || String(rule.end_date) >= romeNow.date;
      });
  }, [selectedDeveloper, romeNow.date]);

  const allBlocks = useMemo(() => {
    const oneTime = oneTimeSlots.map((slot) => ({
      _key: `single-${slot._id}`,
      _kind: "single",
      _sortDate: String(slot.date || "9999-12-31"),
      _sortTime: String(slot.start_time || "23:59"),
      _index: slot._index,
      _type: slot._type,
      date: slot.date,
      start_time: slot.start_time,
      end_time: slot.end_time,
      label: slot.label,
    }));

    const recurring = recurringRules.map((rule) => ({
      _key: `recurring-${rule._id}`,
      _kind: "recurring",
      _sortDate: String(rule._nextDate || rule.start_date || "9999-12-31"),
      _sortTime: String(rule.start_time || "23:59"),
      _index: rule._index,
      _type: rule._type,
      start_time: rule.start_time,
      end_time: rule.end_time,
      label: rule.label,
      start_date: rule.start_date,
      end_date: rule.end_date,
      _active: rule._active,
      _weekdays: rule._weekdays,
      _recurrenceUnit: rule.recurrence_unit,
      _interval: rule.interval,
      _monthDay: rule.month_day,
      _nextDate: rule._nextDate,
    }));

    return [...oneTime, ...recurring].sort((a, b) => {
      const dateCmp = a._sortDate.localeCompare(b._sortDate);
      if (dateCmp !== 0) return dateCmp;
      const timeCmp = a._sortTime.localeCompare(b._sortTime);
      if (timeCmp !== 0) return timeCmp;
      return a._kind.localeCompare(b._kind);
    });
  }, [oneTimeSlots, recurringRules]);

  const formDurationHours = useMemo(() => {
    const startRaw = timeToDecimal(form.start_time);
    const endRaw = timeToDecimal(form.end_time);
    if (!Number.isFinite(startRaw) || !Number.isFinite(endRaw) || endRaw <= startRaw) return 0;
    const { start, end } = clampTimeRange(startRaw, endRaw);
    return Math.max(0, end - start);
  }, [form.start_time, form.end_time]);

  const oneTimeCount = oneTimeSlots.length;
  const recurringCount = recurringRules.length;

  const applyDeveloperUpdate = async (
    payload,
    planningStartDate = TODAY_STR,
    successTitle = "Disponibilita aggiornata",
    rebalanceOverrides = {}
  ) => {
    if (!selectedDeveloper || !canManageSelected || saving) return;
    setSaving(true);

    try {
      await appClient.entities.Developer.update(selectedDeveloper.id, payload);
      const updatedDeveloper = { ...selectedDeveloper, ...payload };

      const latestTickets = await appClient.entities.Ticket.list();
      const updates = buildWeeklyRebalanceUpdates(
        latestTickets,
        updatedDeveloper.id,
        updatedDeveloper,
        getDynamicRebalanceOptions({
          planningStartDate: planningStartDate || TODAY_STR,
          allowInProgressReplan: true,
          preserveWorkingDaysFromToday: 0,
          preserveExistingSequence: true,
          ...rebalanceOverrides,
        })
      );

      if (updates.length > 0) {
        await Promise.all(
          updates.map((entry) => appClient.entities.Ticket.update(entry.id, entry.updates))
        );
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["developers"] }),
        queryClient.invalidateQueries({ queryKey: ["tickets"] }),
      ]);

      toast({
        title: successTitle,
        description: updates.length > 0
          ? `Pipeline ricalcolata: ${updates.length} ticket riallineati.`
          : "Nessuna ripianificazione necessaria.",
      });
    } catch (error) {
      console.error("Availability update failed", error);
      toast({
        variant: "destructive",
        title: "Operazione non riuscita",
        description: "Controlla i permessi Firestore e riprova.",
      });
    } finally {
      setSaving(false);
    }
  };

  const addAvailability = async () => {
    if (!selectedDeveloper || !canManageSelected) return;

    const type = normalizeType(form.type);
    const label = normalizeBlockLabel(form.label, type);
    const startRaw = timeToDecimal(form.start_time);
    const endRaw = timeToDecimal(form.end_time);

    if (!Number.isFinite(startRaw) || !Number.isFinite(endRaw) || endRaw <= startRaw) {
      toast({
        variant: "destructive",
        title: "Fascia oraria non valida",
        description: "Controlla ora inizio e ora fine.",
      });
      return;
    }

    const { start, end } = clampTimeRange(startRaw, endRaw);
    if (end <= start) {
      toast({
        variant: "destructive",
        title: "Fascia fuori orario",
        description: "Usa una fascia compresa tra 09:00 e 18:00.",
      });
      return;
    }

    if (form.recurring) {
      const recurrenceUnit = normalizeRecurringUnit(form.recurrence_unit);
      const interval = normalizeRecurringInterval(form.interval);
      const weekdays = recurrenceUnit === "week" ? normalizeWeekdays(form.weekdays) : [];
      const startDate = String(form.start_date || "").trim() || TODAY_STR;
      const endDate = String(form.end_date || "").trim();

      if (recurrenceUnit === "week" && weekdays.length === 0) {
        toast({
          variant: "destructive",
          title: "Ricorrenza non valida",
          description: "Seleziona almeno un giorno della settimana.",
        });
        return;
      }

      if (endDate && endDate < startDate) {
        toast({
          variant: "destructive",
          title: "Intervallo non valido",
          description: "La data fine deve essere successiva alla data inizio.",
        });
        return;
      }

      const currentRules = Array.isArray(selectedDeveloper.recurring_unavailable_slots)
        ? [...selectedDeveloper.recurring_unavailable_slots]
        : [];

      const nextRule = {
        id: buildId("rule", startDate),
        recurrence_unit: recurrenceUnit,
        interval,
        weekdays,
        month_day: recurrenceUnit === "month" ? moment(startDate, "YYYY-MM-DD", true).date() : null,
        start_time: decimalToTime(start),
        end_time: decimalToTime(end),
        type,
        label,
        start_date: startDate,
        end_date: endDate || null,
        active: form.active !== false,
      };

      await applyDeveloperUpdate(
        { recurring_unavailable_slots: [...currentRules, nextRule] },
        startDate,
        "Ricorrenza aggiunta",
        {
          manualInsertionAnchor: {
            date: getNextRecurringDate(nextRule) || startDate,
            start,
          },
        }
      );
      return;
    }

    const date = String(form.date || "").trim();
    if (!date) {
      toast({
        variant: "destructive",
        title: "Data mancante",
        description: "Seleziona la data del blocco.",
      });
      return;
    }

    const currentSlots = Array.isArray(selectedDeveloper.unavailable_slots)
      ? [...selectedDeveloper.unavailable_slots]
      : [];

    const nextSlot = {
      id: buildId("slot", date),
      date,
      start_time: decimalToTime(start),
      end_time: decimalToTime(end),
      type,
      label,
    };

      await applyDeveloperUpdate(
        { unavailable_slots: [...currentSlots, nextSlot] },
        date,
        "Slot aggiunto",
        {
          manualInsertionAnchor: {
            date,
            start,
          },
        }
      );
  };

  const removeOneTimeSlot = async (index) => {
    if (!selectedDeveloper || !canManageSelected) return;
    const list = Array.isArray(selectedDeveloper.unavailable_slots)
      ? [...selectedDeveloper.unavailable_slots]
      : [];
    if (index < 0 || index >= list.length) return;

    const removed = list[index];
    list.splice(index, 1);

    await applyDeveloperUpdate(
      { unavailable_slots: list },
      removed?.date || TODAY_STR,
      "Slot rimosso",
      {
        manualInsertionAnchor: {
          date: String(removed?.date || TODAY_STR),
          start: timeToDecimal(removed?.start_time) ?? DAY_START,
        },
      }
    );
  };

  const removeRecurringRule = async (index) => {
    if (!selectedDeveloper || !canManageSelected) return;
    const list = Array.isArray(selectedDeveloper.recurring_unavailable_slots)
      ? [...selectedDeveloper.recurring_unavailable_slots]
      : [];
    if (index < 0 || index >= list.length) return;

    const removed = list[index];
    list.splice(index, 1);

    await applyDeveloperUpdate(
      { recurring_unavailable_slots: list },
      String(removed?.start_date || TODAY_STR),
      "Ricorrenza rimossa",
      {
        manualInsertionAnchor: {
          date: getNextRecurringDate(removed) || String(removed?.start_date || TODAY_STR),
          start: timeToDecimal(removed?.start_time) ?? DAY_START,
        },
      }
    );
  };

  const toggleRecurringRule = async (index, checked) => {
    if (!selectedDeveloper || !canManageSelected) return;
    const list = Array.isArray(selectedDeveloper.recurring_unavailable_slots)
      ? [...selectedDeveloper.recurring_unavailable_slots]
      : [];
    if (index < 0 || index >= list.length) return;

    list[index] = { ...list[index], active: checked };

    await applyDeveloperUpdate(
      { recurring_unavailable_slots: list },
      String(list[index]?.start_date || TODAY_STR),
      checked ? "Ricorrenza attivata" : "Ricorrenza disattivata",
      {
        manualInsertionAnchor: {
          date: getNextRecurringDate(list[index]) || String(list[index]?.start_date || TODAY_STR),
          start: timeToDecimal(list[index]?.start_time) ?? DAY_START,
        },
      }
    );
  };

  const toggleWeekday = (weekday) => {
    setForm((prev) => {
      const hasDay = prev.weekdays.includes(weekday);
      const nextWeekdays = hasDay
        ? prev.weekdays.filter((day) => day !== weekday)
        : [...prev.weekdays, weekday];
      return {
        ...prev,
        weekdays: normalizeWeekdays(nextWeekdays),
      };
    });
  };

  if (loading || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[320px]">
        <div className="w-6 h-6 border-2 border-violet-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAdmin && !isDeveloper && !isTechSupervisor) {
    return (
      <Card className="border border-border bg-card shadow-sm">
        <CardContent className="py-14 text-center text-muted-foreground">
          Solo admin, developer e tech supervisor possono gestire la disponibilita.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="w-full space-y-6" data-tour="availability-page">
      <Card className="border border-border/70 bg-card/95 shadow-[var(--shadow-soft)]" data-tour="availability-overview">
        <CardContent className="space-y-5 p-5 lg:p-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="space-y-2">
              <p className="app-kicker">Availability control</p>
              <div className="space-y-1">
                <h2 className="text-2xl font-semibold tracking-tight text-foreground">Blocchi che governano la pipeline</h2>
                <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                  Gestisci assenze e slot non pianificabili del developer selezionato. Ogni modifica libera o blocca spazio utile e riallinea automaticamente i ticket successivi.
                </p>
              </div>
            </div>

            {isAdmin && (
              <div className="w-full xl:w-[320px]">
                <Label className="mb-2 block text-xs font-semibold text-muted-foreground">Developer</Label>
                <Select value={selectedDevId} onValueChange={setSelectedDevId}>
                  <SelectTrigger className="h-11 bg-muted/45">
                    <SelectValue placeholder="Seleziona developer" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeDevelopers.map((dev) => (
                      <SelectItem key={dev.id} value={dev.id}>
                        {dev.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
            <div className="rounded-3xl border border-border/70 bg-muted/30 px-4 py-4 xl:col-span-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Developer attivo</p>
              <p className="mt-2 text-lg font-semibold text-foreground">{selectedDeveloper?.name || "—"}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {selectedDeveloper?.daily_capacity_hours || 8}h al giorno disponibili prima dei blocchi.
              </p>
            </div>
            <div className="rounded-3xl border border-border/70 bg-muted/30 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Blocchi attivi</p>
              <p className="mt-2 text-2xl font-semibold text-foreground">{allBlocks.length}</p>
              <p className="mt-1 text-xs text-muted-foreground">Singoli e ricorrenti non scaduti</p>
            </div>
            <div className="rounded-3xl border border-border/70 bg-muted/30 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Singoli</p>
              <p className="mt-2 text-2xl font-semibold text-foreground">{oneTimeCount}</p>
              <p className="mt-1 text-xs text-muted-foreground">Slot datati ancora rilevanti</p>
            </div>
            <div className="rounded-3xl border border-border/70 bg-muted/30 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Ricorrenti</p>
              <p className="mt-2 text-2xl font-semibold text-foreground">{recurringCount}</p>
              <p className="mt-1 text-xs text-muted-foreground">Regole ricorrenti attive</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {!selectedDeveloper && (
        <Card className="border border-border bg-card shadow-sm">
          <CardContent className="py-14 text-center text-muted-foreground">
            Nessun developer selezionato.
          </CardContent>
        </Card>
      )}

      {selectedDeveloper && !canManageSelected && (
        <Card className="border border-border bg-card shadow-sm">
          <CardContent className="py-14 text-center text-muted-foreground">
            Non hai i permessi per modificare la disponibilita di questo developer.
          </CardContent>
        </Card>
      )}

      {selectedDeveloper && canManageSelected && (
        <>
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.95fr)]">
            <Card className="border border-border/70 bg-card/95 shadow-[var(--shadow-soft)]" data-tour="availability-form">
              <CardHeader className="border-b border-border/60 pb-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2 text-base font-semibold">
                      <CalendarDays className="h-4 w-4 text-violet-500" />
                      Nuovo slot di indisponibilita
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      Crea un blocco singolo o una regola ricorrente che renda non pianificabile una fascia oraria.
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-muted/35 px-4 py-3 lg:min-w-[260px]">
                    <div>
                      <p className="text-sm font-semibold text-foreground">Regola ricorrente</p>
                      <p className="text-xs text-muted-foreground">Ripete automaticamente lo slot selezionato.</p>
                    </div>
                    <Switch
                      checked={form.recurring}
                      onCheckedChange={(value) => setForm((prev) => ({ ...prev, recurring: value }))}
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6 p-5">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold text-muted-foreground">Tipo</Label>
                    <Select
                      value={form.type}
                      onValueChange={(value) => setForm((prev) => ({ ...prev, type: value }))}
                    >
                      <SelectTrigger className="h-11 bg-muted/35">
                        <SelectValue placeholder="Tipo" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="absence">Assenza</SelectItem>
                        <SelectItem value="activity">Blocco</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs font-semibold text-muted-foreground">Inizio</Label>
                    <Input
                      className="h-11 bg-muted/35"
                      type="time"
                      value={form.start_time}
                      onChange={(event) => setForm((prev) => ({ ...prev, start_time: event.target.value }))}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs font-semibold text-muted-foreground">Fine</Label>
                    <Input
                      className="h-11 bg-muted/35"
                      type="time"
                      value={form.end_time}
                      onChange={(event) => setForm((prev) => ({ ...prev, end_time: event.target.value }))}
                    />
                  </div>

                  {!form.recurring ? (
                    <div className="space-y-2">
                      <Label className="text-xs font-semibold text-muted-foreground">Data</Label>
                      <Input
                        className="h-11 bg-muted/35"
                        type="date"
                        value={form.date}
                        onChange={(event) => setForm((prev) => ({ ...prev, date: event.target.value }))}
                      />
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-border/70 bg-muted/25 px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Durata slot</p>
                      <p className="mt-2 text-lg font-semibold text-foreground">{formDurationHours || 0}h</p>
                      <p className="mt-1 text-xs text-muted-foreground">La durata verra replicata sui giorni selezionati.</p>
                    </div>
                  )}
                </div>

                {form.recurring && (
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                    <div className="space-y-4">
                      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_112px]">
                        <div className="space-y-2">
                          <Label className="text-xs font-semibold text-muted-foreground">Cadenza</Label>
                          <Select
                            value={form.recurrence_unit}
                            onValueChange={(value) =>
                              setForm((prev) => ({ ...prev, recurrence_unit: normalizeRecurringUnit(value) }))
                            }
                          >
                            <SelectTrigger className="h-11 bg-muted/35">
                              <SelectValue placeholder="Cadenza" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="week">Settimanale</SelectItem>
                              <SelectItem value="month">Mensile</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs font-semibold text-muted-foreground">Ogni</Label>
                          <Input
                            className="h-11 bg-muted/35"
                            type="number"
                            min="1"
                            max="12"
                            value={form.interval}
                            onChange={(event) =>
                              setForm((prev) => ({
                                ...prev,
                                interval: normalizeRecurringInterval(event.target.value),
                              }))
                            }
                          />
                        </div>
                      </div>

                      {normalizeRecurringUnit(form.recurrence_unit) === "week" ? (
                        <div className="space-y-2">
                          <Label className="text-xs font-semibold text-muted-foreground">Giorni ricorrenti</Label>
                          <div className="flex flex-wrap gap-2">
                            {WEEKDAY_OPTIONS.map((day) => {
                              const active = form.weekdays.includes(day.value);
                              return (
                                <Button
                                  key={day.value}
                                  type="button"
                                  variant={active ? "default" : "outline"}
                                  size="sm"
                                  className="h-9 rounded-full px-3 text-xs"
                                  onClick={() => toggleWeekday(day.value)}
                                >
                                  {day.label}
                                </Button>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-border/70 bg-muted/25 px-4 py-3">
                          <p className="text-sm font-medium text-foreground">Ripetizione mensile</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            La regola verra ripetuta ogni {normalizeRecurringInterval(form.interval)} mese{normalizeRecurringInterval(form.interval) > 1 ? "i" : ""} sul giorno del mese scelto nella data di inizio.
                          </p>
                        </div>
                      )}
                    </div>
                    <div className="rounded-2xl border border-border/70 bg-muted/25 px-4 py-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label className="text-xs font-semibold text-muted-foreground">Dal</Label>
                          <Input
                            className="h-10 bg-card/70"
                            type="date"
                            value={form.start_date}
                            onChange={(event) => setForm((prev) => ({ ...prev, start_date: event.target.value }))}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs font-semibold text-muted-foreground">Al</Label>
                          <Input
                            className="h-10 bg-card/70"
                            type="date"
                            value={form.end_date}
                            onChange={(event) => setForm((prev) => ({ ...prev, end_date: event.target.value }))}
                          />
                        </div>
                      </div>
                      <div className="mt-3 flex items-center justify-between rounded-2xl border border-border/60 bg-card/75 px-3 py-2">
                        <div>
                          <p className="text-sm font-medium text-foreground">Regola attiva</p>
                          <p className="text-xs text-muted-foreground">Disattivabile in qualsiasi momento dalla lista.</p>
                        </div>
                        <Switch
                          checked={form.active}
                          onCheckedChange={(value) => setForm((prev) => ({ ...prev, active: value }))}
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold text-muted-foreground">Nota</Label>
                    <Input
                      className="h-11 bg-muted/35"
                      placeholder={form.recurring ? "Es. bloccato ogni martedi per operativita cliente" : "Es. blocco operativo o assenza"}
                      value={form.label}
                      onChange={(event) => setForm((prev) => ({ ...prev, label: event.target.value }))}
                    />
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-muted/25 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Riepilogo</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={`border ${TYPE_META[normalizeType(form.type)].badgeClass}`}>
                        {TYPE_META[normalizeType(form.type)].label}
                      </Badge>
                      <Badge variant="outline" className="border-border/70">
                        {form.recurring ? "Ricorrente" : "Singolo"}
                      </Badge>
                      <Badge variant="outline" className="border-border/70">
                        {decimalToTime(Math.max(DAY_START, timeToDecimal(form.start_time) || DAY_START))}-{decimalToTime(Math.min(DAY_END, timeToDecimal(form.end_time) || DAY_END))}
                      </Badge>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {form.recurring
                        ? formatRecurringRuleLabel({
                            recurrence_unit: normalizeRecurringUnit(form.recurrence_unit),
                            interval: normalizeRecurringInterval(form.interval),
                            weekdays: normalizeRecurringUnit(form.recurrence_unit) === "week" ? form.weekdays : [],
                            month_day: normalizeRecurringUnit(form.recurrence_unit) === "month"
                              ? moment(form.start_date || TODAY_STR, "YYYY-MM-DD", true).date()
                              : null,
                            start_time: form.start_time,
                            end_time: form.end_time,
                            start_date: form.start_date || TODAY_STR,
                          })
                        : `Si applica il ${moment(form.date).isValid() ? moment(form.date).format("DD MMM YYYY") : "giorno selezionato"}.`}
                    </p>
                  </div>
                </div>

                <div className="flex flex-col gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-muted-foreground">
                    Le modifiche riallineano automaticamente la pipeline del developer selezionato.
                  </p>
                  <Button type="button" onClick={addAvailability} disabled={saving} className="h-11 rounded-full px-5">
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Aggiungi slot
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div>
              <Card className="border border-border/70 bg-card/95 shadow-[var(--shadow-soft)]" data-tour="availability-slots">
                <CardHeader className="border-b border-border/60 pb-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <CardTitle className="text-base font-semibold">Slot impostati</CardTitle>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Solo blocchi ancora rilevanti per la pianificazione.
                      </p>
                    </div>
                    <Badge variant="outline" className="rounded-full border-border/70 px-3 py-1 text-xs">
                      {allBlocks.length}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="max-h-[560px] space-y-3 overflow-y-auto p-5">
                  {allBlocks.length === 0 && (
                    <div className="rounded-3xl border border-dashed border-border/70 bg-muted/20 px-4 py-10 text-center">
                      <p className="text-sm font-medium text-foreground">Nessuno slot attivo</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        I blocchi singoli gia trascorsi non vengono piu mostrati qui.
                      </p>
                    </div>
                  )}
                  {allBlocks.map((item) => (
                    <div key={item._key} className="rounded-3xl border border-border/70 bg-muted/20 p-4 shadow-[var(--shadow-soft)]">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className={`text-[10px] border ${TYPE_META[item._type].badgeClass}`}>
                              {TYPE_META[item._type].label}
                            </Badge>
                            <Badge variant="outline" className="text-[10px] border-border/70">
                              {item._kind === "recurring" ? "Ricorrente" : "Singolo"}
                            </Badge>
                            <span className="text-xs font-semibold tabular-nums text-foreground">
                              {item.start_time}-{item.end_time}
                            </span>
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-foreground">
                              {item.label || (item._kind === "recurring" ? "Blocco ricorrente" : "Blocco")}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {item._kind === "single"
                                ? moment(item.date).format("DD MMM YYYY")
                                : `${formatRecurringRuleLabel({
                                    recurrence_unit: item._recurrenceUnit,
                                    interval: item._interval,
                                    weekdays: item._weekdays,
                                    month_day: item._monthDay,
                                  })}${item._nextDate ? ` • prossimo ${moment(item._nextDate).format("DD MMM YYYY")}` : ""}`}
                            </p>
                            {item._kind === "recurring" && (
                              <p className="mt-1 text-[11px] text-muted-foreground">
                                {item.start_date ? `Dal ${moment(item.start_date).format("DD MMM YYYY")}` : "Da subito"}
                                {item.end_date ? ` • fino al ${moment(item.end_date).format("DD MMM YYYY")}` : ""}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {item._kind === "recurring" && (
                            <div className="flex items-center gap-2 rounded-full border border-border/60 bg-card/70 px-3 py-1.5">
                              <Repeat2 className="h-3.5 w-3.5 text-muted-foreground" />
                              <Switch
                                checked={item._active}
                                onCheckedChange={(checked) => toggleRecurringRule(item._index, checked)}
                                disabled={saving}
                              />
                            </div>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 rounded-full"
                            onClick={() =>
                              item._kind === "recurring"
                                ? removeRecurringRule(item._index)
                                : removeOneTimeSlot(item._index)
                            }
                            disabled={saving}
                          >
                            <Trash2 className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
