import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Clock, Pencil, Check, X, AlertTriangle } from "lucide-react";
import { appClient } from "@/api/appClient";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import moment from "moment";
import { checkScheduleConflict } from "@/pages/DevPipeline";
import {
  getActualEffortHours,
  getEffectivePriorityScore,
  getPlannedEffortHours,
  getTicketWorkflowStatus,
  isTicketClosed,
} from "../shared/priorityUtils";

const DAY_START = 9;
const DAY_END = 18;

function timeToDecimal(t) {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return h + (m || 0) / 60;
}

function decimalToTime(dec) {
  const h = Math.floor(dec);
  const m = Math.round((dec - h) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function calcEffort(start, end) {
  if (!start || !end) return null;
  const diff = timeToDecimal(end) - timeToDecimal(start);
  return diff > 0 ? Math.round(diff * 2) / 2 : null;
}

function roundHalf(value) {
  return Math.round(value * 2) / 2;
}

function isClose(a, b) {
  return Math.abs(Number(a || 0) - Number(b || 0)) < 0.01;
}

function formatHours(value) {
  if (!Number.isFinite(value)) return "—";
  const normalized = (Math.round(value * 100) / 100).toFixed(2);
  return normalized.replace(/\.?0+$/, "");
}

function buildScheduleRows(ticket) {
  const rows = [];

  const append = (date, startTime, endTime) => {
    const start = timeToDecimal(startTime);
    const end = timeToDecimal(endTime);
    if (!date || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;

    rows.push({
      date: String(date),
      start_time: String(startTime),
      end_time: String(endTime),
      start,
      end,
      hours: end - start,
    });
  };

  append(ticket?.scheduled_date, ticket?.start_time, ticket?.end_time);
  (ticket?.continuation_schedule || []).forEach((segment) =>
    append(segment?.date, segment?.start_time, segment?.end_time)
  );

  const sortedRows = rows.sort((a, b) => {
    if (a.date !== b.date) return String(a.date).localeCompare(String(b.date));
    if (a.start !== b.start) return a.start - b.start;
    return a.end - b.end;
  });

  const merged = [];
  sortedRows.forEach((row) => {
    const last = merged[merged.length - 1];
    if (!last || last.date !== row.date || row.start > last.end) {
      merged.push({ ...row });
      return;
    }

    if (row.end > last.end) {
      last.end = row.end;
      last.end_time = decimalToTime(row.end);
      last.hours = last.end - last.start;
    }
  });

  return merged;
}

function getRomeDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  const parts = new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);

  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  if (!byType.year || !byType.month || !byType.day) return null;
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function getDoneAuditEntry(ticket) {
  const logs = Array.isArray(ticket?.audit_log) ? [...ticket.audit_log] : [];
  const doneRegex = /(?:→|->|to)\s*(?:done|qa[_\s/]*review)\b/i;
  return logs.reverse().find((entry) => {
    if (entry?.action !== "status_change") return false;
    const details = String(entry?.details || "");
    return doneRegex.test(details);
  });
}

function getDoneCompletionPoint(ticket) {
  const doneEntry = getDoneAuditEntry(ticket);
  const scheduleRows = buildScheduleRows(ticket);
  const lastScheduleRow = scheduleRows[scheduleRows.length - 1] || null;

  const fallbackDate = lastScheduleRow?.date || (ticket?.scheduled_date ? String(ticket.scheduled_date) : null);
  const date = getRomeDate(doneEntry?.timestamp) || fallbackDate;

  let time = null;
  const match = String(doneEntry?.details || "").match(
    /(?:end|fine):\s*([0-2]?\d:[0-5]\d)/i
  );
  if (match?.[1]) {
    time = match[1].padStart(5, "0");
  }

  const auditDecimal = timeToDecimal(time);
  const schedulePoint =
    lastScheduleRow && Number.isFinite(lastScheduleRow.end)
      ? {
          date: lastScheduleRow.date,
          time: decimalToTime(lastScheduleRow.end),
          decimal: roundHalf(lastScheduleRow.end),
        }
      : null;
  const auditPoint =
    date && Number.isFinite(auditDecimal)
      ? { date, time: decimalToTime(auditDecimal), decimal: roundHalf(auditDecimal) }
      : null;

  if (!auditPoint && !schedulePoint) return null;
  if (!auditPoint) return schedulePoint;
  if (!schedulePoint) return auditPoint;

  if (schedulePoint.date > auditPoint.date) return schedulePoint;
  if (schedulePoint.date < auditPoint.date) return auditPoint;
  return schedulePoint.decimal >= auditPoint.decimal ? schedulePoint : auditPoint;
}

function getDisplayScheduleRows(ticket, { isDone = false } = {}) {
  const rows = buildScheduleRows(ticket);
  if (!isDone || rows.length === 0) return rows;

  const completion = getDoneCompletionPoint(ticket);
  if (!completion) return rows;

  const visible = [];

  for (const row of rows) {
    if (row.date < completion.date) {
      visible.push(row);
      continue;
    }

    if (row.date > completion.date) break;
    if (completion.decimal <= row.start) break;

    const cappedEnd = Math.min(row.end, completion.decimal);
    if (cappedEnd <= row.start) break;

    visible.push({
      ...row,
      end: cappedEnd,
      end_time: decimalToTime(cappedEnd),
      hours: cappedEnd - row.start,
    });

    if (completion.decimal < row.end) break;
  }

  if (visible.length === 0 && rows.length > 0) {
    const first = rows[0];
    const fallbackEnd = Math.min(first.end, completion.decimal);
    if (fallbackEnd > first.start) {
      return [
        {
          ...first,
          end: fallbackEnd,
          end_time: decimalToTime(fallbackEnd),
          hours: fallbackEnd - first.start,
        },
      ];
    }
  }

  return visible.length > 0 ? visible : rows;
}

export default function TimeScheduleCard({ ticket, canEdit, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const [editDate, setEditDate] = useState("");
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [editContinuation, setEditContinuation] = useState([]);
  const [saving, setSaving] = useState(false);
  const [splitWarning, setSplitWarning] = useState(false);
  const [conflictInfo, setConflictInfo] = useState(null);
  const queryClient = useQueryClient();

  const { data: allTickets = [] } = useQuery({
    queryKey: ["tickets"],
    queryFn: () => appClient.entities.Ticket.list(),
  });

  const { data: developers = [] } = useQuery({
    queryKey: ["developers"],
    queryFn: () => appClient.entities.Developer.list(),
  });

  const assignedDeveloper = developers.find((dev) => dev.id === ticket.assignee_id) || null;

  const plannedEffort = getPlannedEffortHours(ticket);
  const actualEffort = getActualEffortHours(ticket);
  const scheduleRows = buildScheduleRows(ticket);
  const scheduledEffort = roundHalf(scheduleRows.reduce((sum, row) => sum + (Number(row.hours) || 0), 0));
  const effortReferenceHours = actualEffort > 0
    ? actualEffort
    : plannedEffort > 0
      ? plannedEffort
      : scheduledEffort;
  const effortReferenceLabel = actualEffort > 0
    ? "Effort reale"
    : plannedEffort > 0
      ? "Effort previsto"
      : "Effort pianificato";
  const effort = effortReferenceHours || 0;
  const firstDraftHours = calcEffort(editStart, editEnd) || 0;
  const continuationDraftHours = (editContinuation || []).reduce(
    (sum, cont) => sum + (calcEffort(cont?.start_time, cont?.end_time) || 0),
    0
  );
  const draftTotalHours = roundHalf(firstDraftHours + continuationDraftHours);
  const hasReferenceEffort = effortReferenceHours > 0;
  const effortMatchesPlan = !hasReferenceEffort || isClose(draftTotalHours, effortReferenceHours);
  const effortDelta = hasReferenceEffort ? roundHalf(draftTotalHours - effortReferenceHours) : 0;

  // Compute estimated end from start + effort if no end_time
  const estimatedEnd = ticket.end_time
    ? ticket.end_time
    : ticket.start_time && effort
    ? (() => {
        const [h, m] = ticket.start_time.split(":").map(Number);
        const totalMin = h * 60 + m + Math.round(effort * 60);
        const eh = Math.floor(totalMin / 60);
        const em = totalMin % 60;
        return `${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`;
      })()
    : null;

  const normalizedStatus = getTicketWorkflowStatus(ticket);
  const isDone = isTicketClosed(ticket);
  const isInProgress = normalizedStatus === "in_progress";
  const displayScheduleRows = getDisplayScheduleRows(ticket, { isDone });
  const firstDisplayRow = displayScheduleRows[0] || null;
  const continuationDisplayRows = displayScheduleRows.slice(1);
  const lastDisplayRow = displayScheduleRows[displayScheduleRows.length - 1] || null;
  const doneEndDisplay = isDone
    ? (lastDisplayRow?.end_time || ticket.end_time || null)
    : null;

  const handleStartEdit = () => {
    setEditDate(ticket.scheduled_date || "");
    setEditStart(ticket.start_time || "09:00");
    setEditEnd(ticket.end_time || estimatedEnd || "");
    setEditContinuation(ticket.continuation_schedule || []);
    setEditing(true);
  };

  const handleSave = async () => {
   if (!editStart || !editDate) return;
   setSaving(true);
   setConflictInfo(null);

   const startDec = timeToDecimal(editStart);
   const rawEndDec = timeToDecimal(editEnd);
   const endDec = Math.min(rawEndDec || 0, DAY_END);

   if (!startDec || !rawEndDec || endDec <= startDec) {
     setSaving(false);
     return;
   }

   const normalizedContinuation = (editContinuation || [])
     .map((cont) => ({
       date: String(cont?.date || "").trim(),
       start_time: String(cont?.start_time || "").trim(),
       end_time: String(cont?.end_time || "").trim(),
     }))
     .filter((cont) => cont.date || cont.start_time || cont.end_time);

   for (const cont of normalizedContinuation) {
     if (!cont.date || !cont.start_time || !cont.end_time) {
       setConflictInfo({
         status: "error",
         message: "Compila data, inizio e fine per ogni giorno di frammentazione.",
       });
       setSaving(false);
       return;
     }
     const cHours = calcEffort(cont.start_time, cont.end_time);
     if (!cHours || cHours <= 0) {
       setConflictInfo({
         status: "error",
         message: "Ogni slot di frammentazione deve avere una durata valida.",
       });
       setSaving(false);
       return;
     }
   }

   const firstDayEnd = decimalToTime(endDec);
   const firstDayHours = calcEffort(editStart, firstDayEnd) || 0;
   let continuationSchedule = [...normalizedContinuation];

   // If reference effort exists and only first slice is provided, auto-split remainder on next days.
   if (effortReferenceHours > 0 && continuationSchedule.length === 0 && firstDayHours < effortReferenceHours) {
     let remaining = roundHalf(effortReferenceHours - firstDayHours);
     let currentDate = moment(editDate);
     while (remaining > 0) {
       currentDate = currentDate.add(1, "day");
       const alloc = Math.min(remaining, DAY_END - DAY_START);
       continuationSchedule.push({
         date: currentDate.format("YYYY-MM-DD"),
         start_time: decimalToTime(DAY_START),
         end_time: decimalToTime(DAY_START + alloc),
       });
       remaining = roundHalf(remaining - alloc);
     }
     setSplitWarning(true);
     setTimeout(() => setSplitWarning(false), 4000);
   }

   const continuationHours = continuationSchedule.reduce(
     (sum, cont) => sum + (calcEffort(cont.start_time, cont.end_time) || 0),
     0
   );
   const totalScheduled = roundHalf(firstDayHours + continuationHours);

   if (effortReferenceHours > 0 && !isClose(totalScheduled, effortReferenceHours)) {
     setConflictInfo({
       status: "error",
       message: `La pianificazione (${totalScheduled}h) deve combaciare con ${effortReferenceLabel.toLowerCase()} (${effortReferenceHours}h).`,
     });
     setSaving(false);
     return;
   }

   const plannedSlots = [
     { date: editDate, start_time: editStart, end_time: firstDayEnd },
     ...continuationSchedule,
   ];
   for (const slot of plannedSlots) {
     const conflict = checkScheduleConflict(
       allTickets,
       ticket.assignee_id,
       getEffectivePriorityScore(ticket),
       slot.date,
       slot.start_time,
       slot.end_time,
       ticket.id,
       assignedDeveloper,
       { allowTicketReflow: true }
     );
     if (conflict.status !== "ok") {
       setConflictInfo({
         ...conflict,
         message: `${slot.date} ${slot.start_time}-${slot.end_time}: ${conflict.message}`,
       });
       setSaving(false);
       return;
     }
   }

    const updates = {
      scheduled_date: editDate,
      start_time: editStart,
      end_time: firstDayEnd,
      continuation_schedule: continuationSchedule,
    };

   await appClient.entities.Ticket.update(ticket.id, updates);

   if (onUpdate) {
     await onUpdate({
       freezeTicketIds: [ticket.id],
       planningStartDate: editDate,
       preserveWorkingDaysFromToday: 0,
       preserveExistingSequence: true,
       allowInProgressReplan: true,
       manualInsertionAnchor: {
         date: editDate,
         start: startDec,
       },
     });
   } else {
     await queryClient.invalidateQueries({ queryKey: ["tickets"] });
   }

   setSaving(false);
   setEditing(false);
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-violet-500" />
            <span className="text-xs font-semibold text-gray-700">Pianificazione oraria</span>
          </div>
          {canEdit && !editing && (
            <button onClick={handleStartEdit} className="text-gray-400 hover:text-violet-600 transition-colors">
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {editing ? (
          <div className="space-y-3">
            <div>
              <label className="text-[10px] text-gray-500 font-medium block mb-1">Data pianificata</label>
              <input
                type="date"
                value={editDate}
                onChange={e => setEditDate(e.target.value)}
                className="w-full border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-violet-400"
              />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 font-medium block mb-1">Orario inizio</label>
              <input
                type="time"
                value={editStart}
                onChange={e => setEditStart(e.target.value)}
                className="w-full border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-violet-400"
              />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 font-medium block mb-1">Orario fine</label>
              <input
                type="time"
                value={editEnd}
                onChange={e => setEditEnd(e.target.value)}
                className="w-full border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-violet-400"
              />
            </div>
            {editStart && editEnd && calcEffort(editStart, editEnd) && (
              <p className="text-[11px] text-violet-600 font-medium">
                Durata: {calcEffort(editStart, editEnd)}h
              </p>
            )}
            <div className="rounded-md border border-gray-200 bg-gray-50 p-2 space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-gray-500 font-medium">Effort di riferimento</span>
                <span className="font-semibold text-gray-700">
                  {hasReferenceEffort ? `${effortReferenceHours}h` : "non impostato"}
                </span>
              </div>
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-gray-500 font-medium">Fonte</span>
                <span className="font-semibold text-gray-700">{effortReferenceLabel}</span>
              </div>
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-gray-500 font-medium">Totale pianificato (editor)</span>
                <span className={`font-semibold ${effortMatchesPlan ? "text-emerald-700" : "text-amber-700"}`}>
                  {draftTotalHours}h
                </span>
              </div>
              {hasReferenceEffort && !effortMatchesPlan && (
                <p className="text-[9px] text-amber-700">
                  {effortDelta > 0 ? `Eccesso di ${effortDelta}h` : `Mancano ${Math.abs(effortDelta)}h`}
                </p>
              )}
            </div>
            {splitWarning && (
              <div className="bg-amber-50 border border-amber-200 rounded-md p-2 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="text-[10px] text-amber-700">
                  <p>✓ Splittato su più giorni</p>
                  <p className="text-[9px] opacity-80 mt-0.5">Continua il giorno dopo alle 09:00</p>
                </div>
              </div>
            )}

            {/* Continuation days editor */}
            <div className="bg-gray-50 rounded-md p-3 space-y-2 border border-gray-200">
              <p className="text-[10px] font-semibold text-gray-700">Frammentazione manuale per giorni</p>
              {editContinuation.map((cont, i) => (
                <div key={i} className="space-y-1.5 p-2 bg-white rounded border border-gray-100">
                  <div className="grid grid-cols-3 gap-1.5">
                    <div>
                      <label className="text-[9px] text-gray-500 font-medium block mb-0.5">Data</label>
                      <input
                        type="date"
                        value={cont.date}
                        onChange={e => {
                          const newCont = [...editContinuation];
                          newCont[i].date = e.target.value;
                          setEditContinuation(newCont);
                        }}
                        className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] text-gray-500 font-medium block mb-0.5">Inizio</label>
                      <input
                        type="time"
                        value={cont.start_time}
                        onChange={e => {
                          const newCont = [...editContinuation];
                          newCont[i].start_time = e.target.value;
                          setEditContinuation(newCont);
                        }}
                        className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] text-gray-500 font-medium block mb-0.5">Fine</label>
                      <input
                        type="time"
                        value={cont.end_time}
                        onChange={e => {
                          const newCont = [...editContinuation];
                          newCont[i].end_time = e.target.value;
                          setEditContinuation(newCont);
                        }}
                        className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400"
                      />
                    </div>
                  </div>
                  <button
                    onClick={() => setEditContinuation(editContinuation.filter((_, idx) => idx !== i))}
                    className="text-[9px] text-red-600 hover:text-red-700 font-medium"
                  >
                    Rimuovi giorno
                  </button>
                </div>
              ))}
              <button
                onClick={() => setEditContinuation([...editContinuation, { date: "", start_time: "09:00", end_time: "10:00" }])}
                className="text-[9px] text-violet-600 hover:text-violet-700 font-medium w-full py-1.5 rounded hover:bg-violet-50 transition-colors"
              >
                + Aggiungi giorno
              </button>
            </div>
            {conflictInfo && (
              <div className={`rounded-md p-2 ${conflictInfo.status === 'error' ? 'bg-red-50 border border-red-200' : 'bg-amber-50 border border-amber-200'}`}>
                <p className={`text-[10px] font-medium ${conflictInfo.status === 'error' ? 'text-red-700' : 'text-amber-700'}`}>
                  {conflictInfo.message}
                </p>
                {conflictInfo.suggestedSchedule && (
                  <div className="mt-2 space-y-1">
                    <p className={`text-[9px] ${conflictInfo.status === 'error' ? 'text-red-600' : 'text-amber-600'}`}>Orario suggerito:</p>
                    <button
                      onClick={() => {
                        setEditDate(conflictInfo.suggestedSchedule.date);
                        setEditStart(conflictInfo.suggestedSchedule.start_time);
                        setEditEnd(conflictInfo.suggestedSchedule.end_time);
                        setConflictInfo(null);
                      }}
                      className={`text-[9px] text-white px-2 py-1 rounded ${conflictInfo.status === 'error' ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700'}`}
                    >
                      Usa {conflictInfo.suggestedSchedule.date} {conflictInfo.suggestedSchedule.start_time}
                    </button>
                  </div>
                )}
              </div>
            )}
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSave} disabled={saving || !editStart} className="flex-1 h-8 bg-violet-600 hover:bg-violet-700 text-white text-xs">
                <Check className="w-3 h-3 mr-1" /> Salva e riallinea
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setEditing(false); setConflictInfo(null); }} className="flex-1 h-8 text-xs">
                <X className="w-3 h-3 mr-1" /> Annulla
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Start time */}
            <div className="flex justify-between items-center text-xs">
              <span className="text-gray-500">
                {isInProgress || isDone ? "Inizio reale" : "Inizio stimato"}
              </span>
              <span className={`font-semibold ${ticket.start_time ? "text-gray-900" : "text-gray-300"}`}>
                {ticket.start_time || "—"}
              </span>
            </div>

            {/* End time */}
            <div className="flex justify-between items-center text-xs">
              <span className="text-gray-500">
                {isDone ? "Fine reale" : "Fine stimata"}
              </span>
              <span className={`font-semibold ${isDone && doneEndDisplay ? "text-gray-900" : estimatedEnd ? "text-gray-400 italic" : "text-gray-300"}`}>
                {isDone ? (doneEndDisplay || "—") : estimatedEnd ? `~${estimatedEnd}` : "—"}
              </span>
            </div>

            {/* Duration */}
            {(ticket.start_time || estimatedEnd) && (
              <div className="flex justify-between items-center text-xs pt-1 border-t border-gray-50">
                <span className="text-gray-500">Durata totale</span>
                <span className="font-semibold text-violet-600">
                  {isDone
                    ? actualEffort
                      ? `${actualEffort}h (real)`
                      : plannedEffort
                        ? `${plannedEffort}h (prev.)`
                        : "—"
                    : plannedEffort
                      ? `${plannedEffort}h (prev.)`
                      : actualEffort
                        ? `${actualEffort}h (real)`
                        : "—"}
                </span>
              </div>
            )}

            {/* Multi-day breakdown */}
            {displayScheduleRows.length > 1 && (
              <div className="mt-3 pt-2 border-t border-gray-50 space-y-2">
                <p className="text-xs font-semibold text-gray-700">📅 Pianificazione per giorno:</p>
                <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                  {/* Day 1 */}
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-600">{moment(firstDisplayRow?.date).format("DD MMM")}</span>
                    <span className="font-medium text-gray-900">
                      {firstDisplayRow?.start_time}–{firstDisplayRow?.end_time} ({formatHours(firstDisplayRow?.hours)}h)
                    </span>
                  </div>
                  {/* Continuation days */}
                  {continuationDisplayRows.map((cont, i) => (
                    <div key={i} className="flex justify-between text-xs">
                      <span className="text-gray-600">⤳ {moment(cont.date).format("DD MMM")}</span>
                      <span className="font-medium text-gray-900">
                        {cont.start_time}–{cont.end_time} ({formatHours(cont.hours)}h)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Status indicator */}
            <div className="mt-2 pt-2 border-t border-gray-50">
              {isDone && ticket.start_time && ticket.end_time ? (
                <p className="text-[10px] text-emerald-600 flex items-center gap-1">
                  <Check className="w-3 h-3" /> Orari confermati
                </p>
              ) : isInProgress && ticket.start_time ? (
                <p className="text-[10px] text-violet-600 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> In lavorazione dalle {ticket.start_time}
                </p>
              ) : (
                <p className="text-[10px] text-gray-400">
                  {ticket.scheduled_date
                    ? `📅 Pianificato per ${ticket.scheduled_date}`
                    : "Orari non ancora confermati"}
                </p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
