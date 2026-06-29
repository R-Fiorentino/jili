import React, { useEffect, useMemo, useRef, useState } from "react";
import { appClient } from "@/api/appClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronLeft, ChevronRight, AlertTriangle, Clock, Check, FileDown, SlidersHorizontal } from "lucide-react";
import { toast } from "@/components/ui/use-toast";
import { Link, useSearchParams } from "react-router-dom";
import { createPageUrl, isDeveloperLikeRole } from "@/utils";
import {
  STATUS_CONFIG,
  getEffectivePriorityScore,
  getPlannedEffortHours,
  getTicketWorkflowStatus,
  isClosedStatus,
  isSchedulableTicket,
  isTicketBlocked,
  isTicketClosed,
  normalizeTicketStatus,
} from "../components/shared/priorityUtils";
import { useCurrentUser } from "../components/shared/useCurrentUser";
import usePersistedState from "../components/shared/usePersistedState";
import moment from "moment";
import { cn } from "@/lib/utils";
import {
  normalizeRecurringAvailabilityRule,
  recurringRuleMatchesDate,
} from "@/lib/recurringAvailability";

const DAY_START = 9;   // 09:00
const DAY_END = 18;    // 18:00
const DAY_HOURS = DAY_END - DAY_START; // 9h (planning window)
const DAY_VIEW_PADDING_HOURS = 0.5; // show 30m before and after for better readability
const DAY_VIEW_START = DAY_START - DAY_VIEW_PADDING_HOURS; // 08:30
const DAY_VIEW_END = DAY_END + DAY_VIEW_PADDING_HOURS; // 18:30
const DAY_VIEW_HOURS = DAY_VIEW_END - DAY_VIEW_START; // 10h (visual window)
const TIMELINE_PX_PER_HOUR = 44;
const LUNCH_START = 13; // 13:00 - pausa pranzo
const LUNCH_END = 14;   // 14:00
const DESKTOP_DEV_COL_WIDTH = 132;
const DESKTOP_HOUR_COL_WIDTH = 34;
const DESKTOP_GRID_TEMPLATE = `${DESKTOP_DEV_COL_WIDTH}px ${DESKTOP_HOUR_COL_WIDTH}px repeat(5, minmax(0, 1fr))`;
const DESKTOP_GRID_MIN_WIDTH = 1100;
export const DEFAULT_REBALANCE_HORIZON_DAYS = 90;
const DEFAULT_CLIENT_COLOR = "#64748b";
const NO_CLIENT_FILTER_ID = "__no_client__";
const CLIENT_COLOR_PALETTE = [
  "#2563eb",
  "#0d9488",
  "#7c3aed",
  "#ea580c",
  "#db2777",
  "#4f46e5",
  "#16a34a",
  "#dc2626",
  "#0891b2",
  "#4338ca",
];
const WEEKDAY_SHORT_IT = {
  1: "Lun",
  2: "Mar",
  3: "Mer",
  4: "Gio",
  5: "Ven",
  6: "Sab",
  7: "Dom",
};

function buildTicketDetailUrl(ticketId, developerId = "") {
  const params = new URLSearchParams({
    id: ticketId,
    from: "dev_pipeline",
  });
  if (developerId) params.set("dev", developerId);
  return `${createPageUrl("TicketDetail")}?${params.toString()}`;
}

function FilterChip({
  selected = false,
  className = "",
  onClick,
  children,
  disabled = false,
  title = "",
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-2 rounded-full border px-2.5 text-xs font-semibold transition-[background-color,color,border-color,box-shadow,transform] duration-150 active:scale-[0.98]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/80 focus-visible:ring-offset-2",
        selected
          ? "border-primary/40 bg-primary/15 text-foreground shadow-[var(--shadow-soft)] dark:border-primary/55 dark:bg-primary/20"
          : "border-border/60 bg-card/80 text-muted-foreground hover:border-border/85 hover:bg-card hover:text-foreground",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
        className
      )}
    >
      {children}
    </button>
  );
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeClientColor(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return /^#[0-9A-Fa-f]{6}$/.test(normalized) ? normalized.toLowerCase() : null;
}

function hashSeed(value) {
  const seed = String(value || "");
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function fallbackClientColor(seed) {
  return CLIENT_COLOR_PALETTE[hashSeed(seed) % CLIENT_COLOR_PALETTE.length] || DEFAULT_CLIENT_COLOR;
}

function getClientColor(client, fallbackSeed = "") {
  return normalizeClientColor(client?.color) || fallbackClientColor(fallbackSeed || client?.name || "client");
}

const UNAVAILABLE_TYPE_META = {
  absence: {
    label: "Assenza",
    badgeClass: "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/35",
    blockClass: "bg-orange-100/70 border-orange-300 dark:bg-orange-500/20 dark:border-orange-500/40 text-orange-700 dark:text-orange-200",
  },
  call: {
    label: "Blocco",
    badgeClass: "bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/35",
    blockClass: "bg-sky-100/70 border-sky-300 dark:bg-sky-500/20 dark:border-sky-500/40 text-sky-700 dark:text-sky-200",
  },
  activity: {
    label: "Blocco",
    badgeClass: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-500/15 dark:text-slate-200 dark:border-slate-500/35",
    blockClass: "bg-slate-200/60 border-slate-300 dark:bg-slate-500/20 dark:border-slate-500/40 text-slate-700 dark:text-slate-200",
  },
};

function normalizeUnavailableType(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "absence") return "absence";
  if (raw === "call" || raw === "meeting") return "activity";
  return "activity";
}

function normalizeUnavailableLabel(value, type) {
  const raw = String(value || "").trim();
  if (!raw) return UNAVAILABLE_TYPE_META[type]?.label || UNAVAILABLE_TYPE_META.activity.label;
  const normalized = raw.toLowerCase();
  if ((normalized === "call" || normalized === "meeting" || normalized === "riunione") && type !== "absence") {
    return UNAVAILABLE_TYPE_META.activity.label;
  }
  return raw;
}

function buildUnavailableSlotId(slot = {}, fallback = "") {
  if (slot?.id) return String(slot.id);
  const seed = `${slot?.date || ""}-${slot?.start_time || ""}-${slot?.end_time || ""}-${slot?.type || ""}-${slot?.label || ""}-${fallback}`;
  return `slot-${hashSeed(seed)}`;
}
const DEFAULT_UNAVAILABLE_LOOKAHEAD_DAYS = 120;

function normalizeDateStr(value) {
  const parsed = moment(value, "YYYY-MM-DD", true);
  return parsed.isValid() ? parsed.format("YYYY-MM-DD") : null;
}

function isDateAllowed(dateStr, { dateSet, fromDate, toDate }) {
  if (!dateStr) return false;
  if (dateSet && !dateSet.has(dateStr)) return false;
  if (fromDate && dateStr < fromDate) return false;
  if (toDate && dateStr > toDate) return false;
  return true;
}

function buildDateCandidates({ dates, fromDate, toDate }) {
  if (Array.isArray(dates) && dates.length > 0) {
    return [...new Set(dates.map(normalizeDateStr).filter(Boolean))].sort();
  }

  const from = normalizeDateStr(fromDate);
  const to = normalizeDateStr(toDate);

  if (from && to && from <= to) {
    const result = [];
    let cursor = moment(from, "YYYY-MM-DD", true);
    const end = moment(to, "YYYY-MM-DD", true);
    while (cursor.isSameOrBefore(end, "day")) {
      result.push(cursor.format("YYYY-MM-DD"));
      cursor = cursor.add(1, "day");
    }
    return result;
  }

  const fallbackFrom = moment().startOf("day");
  const fallbackTo = fallbackFrom.clone().add(DEFAULT_UNAVAILABLE_LOOKAHEAD_DAYS, "days");
  const result = [];
  let cursor = fallbackFrom.clone();
  while (cursor.isSameOrBefore(fallbackTo, "day")) {
    result.push(cursor.format("YYYY-MM-DD"));
    cursor = cursor.add(1, "day");
  }
  return result;
}

export function getDeveloperRecurringUnavailableRules(dev, { includeInactive = false } = {}) {
  const rules = Array.isArray(dev?.recurring_unavailable_slots) ? dev.recurring_unavailable_slots : [];
  const normalized = rules
    .map((rule, index) =>
      normalizeRecurringAvailabilityRule(rule, index, {
        dayStart: DAY_START,
        dayEnd: DAY_END,
      })
    )
    .map((rule) => {
      if (!rule) return null;
      const type = normalizeUnavailableType(rule.type);
      return {
        ...rule,
        type,
        label: String(rule.label || "").trim() || UNAVAILABLE_TYPE_META[type].label,
      };
    })
    .filter(Boolean);

  if (includeInactive) return normalized;
  return normalized.filter((rule) => rule.active !== false);
}

export function getDeveloperUnavailableSlots(
  dev,
  {
    dates = null,
    fromDate = null,
    toDate = null,
    includeAbsences = true,
    includeOneTime = true,
    includeRecurring = true,
    includeInactiveRecurring = false,
  } = {}
) {
  const slots = [];
  const dateCandidates = buildDateCandidates({ dates, fromDate, toDate });
  const dateSet = new Set(dateCandidates);
  const normalizedFromDate = normalizeDateStr(fromDate);
  const normalizedToDate = normalizeDateStr(toDate);
  const dateFilter = {
    dateSet: dates ? dateSet : null,
    fromDate: normalizedFromDate,
    toDate: normalizedToDate,
  };

  if (includeAbsences && Array.isArray(dev?.absences)) {
    dev.absences.forEach((absence, index) => {
      const date = normalizeDateStr(absence?.date);
      if (!date || !isDateAllowed(date, dateFilter)) return;
      slots.push({
        id: `absence-${date}-${index}`,
        date,
        start: DAY_START,
        end: DAY_END,
        start_time: decimalToTime(DAY_START),
        end_time: decimalToTime(DAY_END),
        type: "absence",
        label: absence.reason || UNAVAILABLE_TYPE_META.absence.label,
        source: "absence",
      });
    });
  }

  if (includeOneTime && Array.isArray(dev?.unavailable_slots)) {
    dev.unavailable_slots.forEach((slot, index) => {
      const date = normalizeDateStr(slot?.date);
      const startRaw = timeToDecimal(slot?.start_time);
      const endRaw = timeToDecimal(slot?.end_time);
      if (!date || !isDateAllowed(date, dateFilter) || !Number.isFinite(startRaw) || !Number.isFinite(endRaw)) return;

      const start = roundHalf(Math.max(DAY_START, Math.min(DAY_END, startRaw)));
      const end = roundHalf(Math.max(DAY_START, Math.min(DAY_END, endRaw)));
      if (end <= start) return;

      const type = normalizeUnavailableType(slot?.type);
      slots.push({
        id: buildUnavailableSlotId(slot, `${index}`),
        date,
        start,
        end,
        start_time: decimalToTime(start),
        end_time: decimalToTime(end),
        type,
        label: normalizeUnavailableLabel(slot?.label, type),
        source: "slot",
      });
    });
  }

  if (includeRecurring) {
    const recurringRules = getDeveloperRecurringUnavailableRules(dev, {
      includeInactive: includeInactiveRecurring,
    });

    dateCandidates.forEach((dateStr) => {
      recurringRules.forEach((rule) => {
        if (!recurringRuleMatchesDate(rule, dateStr)) return;
        slots.push({
          id: `rec-${rule.id}-${dateStr}`,
          date: dateStr,
          start: rule.start,
          end: rule.end,
          start_time: rule.start_time,
          end_time: rule.end_time,
          type: rule.type,
          label: normalizeUnavailableLabel(rule.label, rule.type),
          source: "recurring",
          recurring_rule_id: rule.id,
        });
      });
    });
  }

  return slots.sort((a, b) => {
    if (a.date !== b.date) return String(a.date).localeCompare(String(b.date));
    if (a.start !== b.start) return a.start - b.start;
    return a.end - b.end;
  });
}

export function getDeveloperUnavailableSlotsByDate(dev, options = {}) {
  const byDate = {};
  getDeveloperUnavailableSlots(dev, options).forEach((slot) => {
    if (!byDate[slot.date]) byDate[slot.date] = [];
    byDate[slot.date].push(slot);
  });
  return byDate;
}

export function getDeveloperUnavailableIntervalsByDate(dev, options = {}) {
  const byDate = {};
  getDeveloperUnavailableSlots(dev, options).forEach((slot) => {
    if (!byDate[slot.date]) byDate[slot.date] = [];
    byDate[slot.date].push({ start: slot.start, end: slot.end });
  });

  Object.keys(byDate).forEach((dateStr) => {
    byDate[dateStr] = normalizeIntervals(byDate[dateStr]);
  });

  return byDate;
}

export function isDeveloperFullyUnavailableDay(dev, dateStr) {
  const intervals = getDeveloperUnavailableIntervalsByDate(dev, { dates: [dateStr] })[dateStr] || [];
  return intervals.some((slot) => slot.start <= DAY_START && slot.end >= DAY_END);
}

export function getSafePlanningStartDate(baseDate = null) {
  const parsed = baseDate ? moment(baseDate) : moment();
  const safeBase = parsed.isValid() ? parsed : moment();
  return safeBase.startOf("day").add(1, "day").format("YYYY-MM-DD");
}

export function getSafeRebalanceOptions(overrides = {}) {
  return {
    includeTodayHoles: false,
    planningStartDate: getSafePlanningStartDate(),
    freezeCurrentWeekSegments: true,
    horizonDays: DEFAULT_REBALANCE_HORIZON_DAYS,
    ...overrides,
  };
}

export function getDynamicRebalanceOptions(overrides = {}) {
  return getSafeRebalanceOptions({
    planningStartDate: moment().format("YYYY-MM-DD"),
    includeTodayHoles: true,
    freezeCurrentWeekSegments: false,
    preserveTodaySegments: false,
    preserveWorkingDaysFromToday: 3,
    preserveExistingSequence: true,
    ...overrides,
  });
}

function getProtectedWorkingDateSet(baseMoment, workingDaysCount = 0) {
  const count = Math.max(0, Number(workingDaysCount) || 0);
  if (count <= 0) return new Set();

  const protectedDates = new Set();
  const cursor = baseMoment.clone().startOf("day");

  while (protectedDates.size < count) {
    if (cursor.isoWeekday() <= 5) {
      protectedDates.add(cursor.format("YYYY-MM-DD"));
    }
    cursor.add(1, "day");
  }

  return protectedDates;
}

function roundHalf(h) {
  return Math.round(h * 2) / 2;
}

function floorHalf(h) {
  return Math.floor(h * 2) / 2;
}

function ceilHalf(h) {
  return Math.ceil(h * 2) / 2;
}

// Get current time in Europe/Rome timezone as decimal hours
function getCurrentTimeDecimal() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    hour: "numeric", minute: "numeric", hour12: false
  }).formatToParts(now);
  const hour = parseInt(parts.find(p => p.type === "hour").value);
  const minute = parseInt(parts.find(p => p.type === "minute").value);
  return hour + minute / 60;
}

// Check if a ticket's time window overlaps with a slot
function getSlotOverlap(ticketStart, ticketEnd, slotStart, slotEnd) {
  const overlapStart = Math.max(ticketStart, slotStart);
  const overlapEnd = Math.min(ticketEnd, slotEnd);
  return Math.max(0, overlapEnd - overlapStart);
}

// Get current time as decimal hours (e.g. 10:30 -> 10.5)
function currentTimeDecimal() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    hour: "numeric", minute: "numeric", hour12: false
  }).formatToParts(now);
  const hour = parseInt(parts.find(p => p.type === "hour").value);
  const minute = parseInt(parts.find(p => p.type === "minute").value);
  return hour + minute / 60;
}

// Convert HH:MM string to decimal hours (Europe/Rome timezone assumed)
function timeToDecimal(timeStr) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(":").map(Number);
  return h + (m || 0) / 60;
}

// Convert decimal hours to HH:MM string
function decimalToTime(dec) {
  const h = Math.floor(dec);
  const m = Math.round((dec - h) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function normalizeIntervals(intervals) {
  if (!intervals || intervals.length === 0) return [];

  const sorted = [...intervals]
    .filter((slot) => Number.isFinite(slot.start) && Number.isFinite(slot.end) && slot.end > slot.start)
    .sort((a, b) => a.start - b.start);

  const merged = [];
  sorted.forEach((slot) => {
    const last = merged[merged.length - 1];
    if (!last || slot.start > last.end) {
      merged.push({ start: slot.start, end: slot.end });
      return;
    }
    last.end = Math.max(last.end, slot.end);
  });

  return merged;
}

function hasManualPlannedEffort(ticket) {
  if (ticket?.planned_effort_locked === true) return true;
  const auditLog = Array.isArray(ticket?.audit_log) ? ticket.audit_log : [];
  return auditLog.some((entry) => entry?.action === "planned_effort_set");
}

function normalizeTicketSegments(segments = []) {
  if (!Array.isArray(segments) || segments.length === 0) return [];

  const groupedByDate = new Map();
  segments.forEach((segment) => {
    const date = String(segment?.date || "");
    if (!date) return;
    const start = Number(segment?.start);
    const end = Number(segment?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;

    if (!groupedByDate.has(date)) groupedByDate.set(date, []);
    groupedByDate.get(date).push({ start, end });
  });

  const normalized = [];
  [...groupedByDate.keys()]
    .sort((a, b) => a.localeCompare(b))
    .forEach((date) => {
      const mergedForDate = normalizeIntervals(groupedByDate.get(date) || []);
      mergedForDate.forEach((interval) => {
        normalized.push({
          date,
          start: roundHalf(interval.start),
          end: roundHalf(interval.end),
        });
      });
    });

  return sortSegments(normalized);
}

function getTicketEffort(ticket) {
  const planned = Number(getPlannedEffortHours(ticket));
  const hasManualPlan = hasManualPlannedEffort(ticket);

  // Derive scheduled effort from existing segments.
  // If planned effort is NOT manually locked by developer, scheduling should follow
  // currently planned slots (dynamic source of truth).
  const scheduledEffort = roundHalf(
    getAllTicketSegments(ticket).reduce((sum, segment) => sum + segmentDuration(segment), 0)
  );

  if (!hasManualPlan && scheduledEffort > 0) return scheduledEffort;
  if (Number.isFinite(planned) && planned > 0) return roundHalf(planned);
  return scheduledEffort > 0 ? scheduledEffort : 0;
}

function toMainSegment(ticket) {
  if (!ticket?.scheduled_date || !ticket?.start_time || !ticket?.end_time) return null;
  const start = timeToDecimal(ticket.start_time);
  const end = timeToDecimal(ticket.end_time);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return {
    date: ticket.scheduled_date,
    start,
    end,
  };
}

function toContinuationSegments(ticket) {
  const continuation = Array.isArray(ticket?.continuation_schedule)
    ? ticket.continuation_schedule
    : [];

  return continuation
    .map((slot) => {
      const start = timeToDecimal(slot?.start_time);
      const end = timeToDecimal(slot?.end_time);
      if (!slot?.date || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return null;
      }
      return {
        date: slot.date,
        start,
        end,
      };
    })
    .filter(Boolean);
}

function getAllTicketSegments(ticket) {
  const main = toMainSegment(ticket);
  const segments = main ? [main, ...toContinuationSegments(ticket)] : [...toContinuationSegments(ticket)];
  return normalizeTicketSegments(segments);
}

function getTicketSegmentsOnDate(ticket, dateStr) {
  return getAllTicketSegments(ticket).filter(
    (segment) => String(segment.date || "") === String(dateStr || "")
  );
}

function getRomeDateFromTimestamp(value) {
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

function getDoneCompletionPoint(ticket) {
  const logs = Array.isArray(ticket?.audit_log) ? [...ticket.audit_log] : [];
  const doneRegex = /(?:→|->|to)\s*(?:done|qa[_\s/]*review)\b/i;
  const doneEntry = logs.reverse().find((entry) => {
    if (entry?.action !== "status_change") return false;
    return doneRegex.test(String(entry?.details || ""));
  });

  const segments = sortSegments(getAllTicketSegments(ticket));
  const lastSegment = segments[segments.length - 1] || null;
  const fallbackDate = lastSegment?.date || (ticket?.scheduled_date ? String(ticket.scheduled_date) : null);
  const date = getRomeDateFromTimestamp(doneEntry?.timestamp) || fallbackDate;

  let time = null;
  const match = String(doneEntry?.details || "").match(/(?:end|fine):\s*([0-2]?\d:[0-5]\d)/i);
  if (match?.[1]) {
    time = match[1].padStart(5, "0");
  }

  const auditDecimal = timeToDecimal(time);
  const schedulePoint =
    lastSegment && Number.isFinite(lastSegment.end)
      ? { date: lastSegment.date, decimal: roundHalf(lastSegment.end) }
      : null;
  const auditPoint =
    date && Number.isFinite(auditDecimal)
      ? { date, decimal: roundHalf(auditDecimal) }
      : null;

  if (!auditPoint && !schedulePoint) return null;
  if (!auditPoint) return schedulePoint;
  if (!schedulePoint) return auditPoint;

  if (schedulePoint.date > auditPoint.date) return schedulePoint;
  if (schedulePoint.date < auditPoint.date) return auditPoint;
  return schedulePoint.decimal >= auditPoint.decimal ? schedulePoint : auditPoint;
}

function getVisibleDoneSegments(ticket) {
  const segments = sortSegments(getAllTicketSegments(ticket));
  if (segments.length === 0) return [];

  const completion = getDoneCompletionPoint(ticket);
  if (!completion) return segments;

  const visible = [];

  for (const segment of segments) {
    if (segment.date < completion.date) {
      visible.push(segment);
      continue;
    }

    if (segment.date > completion.date) break;
    if (completion.decimal <= segment.start) break;

    const cappedEnd = roundHalf(Math.min(segment.end, completion.decimal));
    if (cappedEnd > segment.start) {
      visible.push({
        ...segment,
        end: cappedEnd,
      });
    }

    if (completion.decimal < segment.end) break;
  }

  if (visible.length > 0) return visible;

  const first = segments[0];
  if (first.date === completion.date) {
    const cappedEnd = roundHalf(Math.min(first.end, completion.decimal));
    if (cappedEnd > first.start) {
      return [{ ...first, end: cappedEnd }];
    }
  }

  return segments;
}

function shouldLockWholeTicket(
  ticket,
  planningStartMoment,
  todayMoment,
  { allowInProgressReplan = false } = {}
) {
  if (!ticket) return true;
  if (normalizeTicketStatus(ticket.status) !== "in_progress") return false;
  if (allowInProgressReplan) return false;

  // For future-window planning, keep only past/today work fixed and allow
  // continuation to be rebalanced in the target window.
  const planningIsFuture = planningStartMoment?.isAfter(todayMoment, "day");
  return !planningIsFuture;
}

function segmentDuration(segment) {
  if (!segment) return 0;
  const duration = Number(segment.end) - Number(segment.start);
  return Number.isFinite(duration) && duration > 0 ? roundHalf(duration) : 0;
}

function computeTimelineOverlapLayout(items = []) {
  if (!Array.isArray(items) || items.length === 0) return {};

  const overlapByTime = (a, b) => Number(a?.start) < Number(b?.end) && Number(b?.start) < Number(a?.end);
  const isBaseSharedItem = (item) => item?.layoutKind === "block" || item?.layoutKind === "closed";
  const eligibleItems = items.filter((item) => {
    if (isBaseSharedItem(item)) return true;
    return items.some((candidate) => candidate.key !== item.key && isBaseSharedItem(candidate) && overlapByTime(item, candidate));
  });
  if (eligibleItems.length === 0) return {};

  const sortedItems = [...eligibleItems].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    if (a.end !== b.end) return a.end - b.end;
    return String(a.key).localeCompare(String(b.key));
  });

  const clusters = [];
  let currentCluster = [];
  let currentClusterEnd = -Infinity;

  sortedItems.forEach((item) => {
    if (currentCluster.length === 0 || item.start < currentClusterEnd) {
      currentCluster.push(item);
      currentClusterEnd = Math.max(currentClusterEnd, item.end);
      return;
    }

    clusters.push(currentCluster);
    currentCluster = [item];
    currentClusterEnd = item.end;
  });

  if (currentCluster.length > 0) {
    clusters.push(currentCluster);
  }

  const placements = {};

  clusters.forEach((cluster) => {
    const active = [];
    let maxLanes = 0;

    cluster.forEach((item) => {
      for (let i = active.length - 1; i >= 0; i -= 1) {
        if (active[i].end <= item.start) {
          active.splice(i, 1);
        }
      }

      const usedLanes = new Set(active.map((entry) => entry.lane));
      let lane = 0;
      while (usedLanes.has(lane)) lane += 1;

      active.push({ end: item.end, lane });
      placements[item.key] = { columnIndex: lane, columnCount: 1 };
      maxLanes = Math.max(maxLanes, lane + 1);
    });

    cluster.forEach((item) => {
      placements[item.key] = {
        columnIndex: placements[item.key].columnIndex,
        columnCount: maxLanes,
      };
    });
  });

  return placements;
}

function sortSegments(segments = []) {
  return [...segments].sort((a, b) => {
    if (a.date !== b.date) return String(a.date).localeCompare(String(b.date));
    if (a.start !== b.start) return a.start - b.start;
    return a.end - b.end;
  });
}

function getDeadlineSortValue(ticket) {
  const ts = Date.parse(ticket?.deadline || "");
  return Number.isFinite(ts) ? ts : Number.POSITIVE_INFINITY;
}

function getUrgencySortValue(ticket) {
  const raw = String(ticket?.urgent_requested_at || "").trim();
  if (!raw) return null;
  const ts = Date.parse(raw);
  return Number.isFinite(ts) ? ts : 0;
}

function compareTicketUrgency(a, b) {
  const urgencyA = getUrgencySortValue(a);
  const urgencyB = getUrgencySortValue(b);
  const aUrgent = urgencyA !== null;
  const bUrgent = urgencyB !== null;

  if (aUrgent !== bUrgent) return aUrgent ? -1 : 1;
  if (aUrgent && bUrgent && urgencyA !== urgencyB) return urgencyB - urgencyA;
  return 0;
}

function getSequenceSortValue(ticket, anchorDate = "", anchorStart = null) {
  const segments = sortSegments(getAllTicketSegments(ticket));
  const anchorDateValue = String(anchorDate || "").trim();
  const anchorStartValue = Number(anchorStart);
  const hasAnchor = Boolean(anchorDateValue) && Number.isFinite(anchorStartValue);

  const firstRelevantSegment =
    (hasAnchor
      ? segments.find(
          (segment) =>
            String(segment.date || "") > anchorDateValue ||
            (String(segment.date || "") === anchorDateValue && Number(segment.end) > anchorStartValue)
        )
      : null) || segments[0];

  if (!firstRelevantSegment) {
    return {
      hasSchedule: false,
      date: "9999-12-31",
      start: Number.POSITIVE_INFINITY,
      created: Date.parse(ticket?.created_date || "") || Number.POSITIVE_INFINITY,
    };
  }

  return {
    hasSchedule: true,
    date: String(firstRelevantSegment.date || "9999-12-31"),
    start: Number(firstRelevantSegment.start),
    created: Date.parse(ticket?.created_date || "") || Number.POSITIVE_INFINITY,
  };
}

function buildFreeSlotsForDay(
  dateStr,
  lockedIntervals,
  {
    isToday,
    includeTodayHoles,
    nowDecimal,
    restrictWithinRange = null,
  }
) {
  if (isToday && !includeTodayHoles) return [];

  const rawStartBoundary = isToday
    ? Math.max(DAY_START, Math.min(DAY_END, nowDecimal))
    : DAY_START;
  const startBoundary = isToday ? ceilHalf(rawStartBoundary) : rawStartBoundary;

  if (startBoundary >= DAY_END) return [];

  const occupied = normalizeIntervals([
    ...(lockedIntervals || []),
    { start: LUNCH_START, end: LUNCH_END },
  ]);

  const slots = [];
  let cursor = startBoundary;

  occupied.forEach((interval) => {
    const clippedStart = Math.max(startBoundary, interval.start);
    const clippedEnd = Math.min(DAY_END, interval.end);

    if (clippedStart > cursor) {
      slots.push({ date: dateStr, start: cursor, end: clippedStart });
    }

    if (clippedEnd > cursor) {
      cursor = clippedEnd;
    }
  });

  if (cursor < DAY_END) {
    slots.push({ date: dateStr, start: cursor, end: DAY_END });
  }

  const normalizedSlots = slots
    .map((slot) => ({
      ...slot,
      start: ceilHalf(slot.start),
      end: floorHalf(slot.end),
    }))
    .filter((slot) => slot.end > slot.start);

  if (
    !restrictWithinRange ||
    !Number.isFinite(restrictWithinRange.start) ||
    !Number.isFinite(restrictWithinRange.end) ||
    restrictWithinRange.end <= restrictWithinRange.start
  ) {
    return normalizedSlots;
  }

  return normalizedSlots
    .map((slot) => ({
      ...slot,
      start: Math.max(slot.start, restrictWithinRange.start),
      end: Math.min(slot.end, restrictWithinRange.end),
    }))
    .filter((slot) => slot.end > slot.start);
}

function schedulePayloadFromSegments(segments) {
  const normalizedSegments = normalizeTicketSegments(segments);
  if (!normalizedSegments || normalizedSegments.length === 0) {
    return {
      scheduled_date: null,
      start_time: null,
      end_time: null,
      continuation_schedule: [],
    };
  }

  const [first, ...rest] = normalizedSegments;
  return {
    scheduled_date: first.date,
    start_time: decimalToTime(first.start),
    end_time: decimalToTime(first.end),
    continuation_schedule: rest.map((segment) => ({
      date: segment.date,
      start_time: decimalToTime(segment.start),
      end_time: decimalToTime(segment.end),
    })),
  };
}

function normalizeScheduleForCompare(ticket) {
  const continuation = Array.isArray(ticket?.continuation_schedule)
    ? ticket.continuation_schedule.map((slot) => ({
        date: slot?.date || null,
        start_time: slot?.start_time || null,
        end_time: slot?.end_time || null,
      }))
    : [];

  return {
    scheduled_date: ticket?.scheduled_date || null,
    start_time: ticket?.start_time || null,
    end_time: ticket?.end_time || null,
    continuation_schedule: continuation,
  };
}

function scheduleChanged(ticket, nextSchedule) {
  const current = normalizeScheduleForCompare(ticket);
  const next = normalizeScheduleForCompare(nextSchedule);
  return JSON.stringify(current) !== JSON.stringify(next);
}

function getFirstSchedulePoint(source) {
  const firstSegment = sortSegments(getAllTicketSegments(source))[0];
  if (!firstSegment) return null;
  return {
    date: String(firstSegment.date || ""),
    start: Number(firstSegment.start),
  };
}

function compareSchedulePoint(a, b) {
  if (!a || !b) return 0;
  if (a.date !== b.date) return a.date.localeCompare(b.date);
  return a.start - b.start;
}

function buildScheduleSlipMetadata(ticket, nextSchedule) {
  const currentPoint = getFirstSchedulePoint(ticket);
  const nextPoint = getFirstSchedulePoint(nextSchedule);
  if (!currentPoint || !nextPoint) return {};
  if (compareSchedulePoint(currentPoint, nextPoint) >= 0) return {};

  return {
    schedule_slip_count: (Number(ticket?.schedule_slip_count) || 0) + 1,
    last_schedule_slipped_at: new Date().toISOString(),
    last_schedule_slip_from: `${currentPoint.date} ${decimalToTime(currentPoint.start)}`,
    last_schedule_slip_to: `${nextPoint.date} ${decimalToTime(nextPoint.start)}`,
  };
}

// Convert decimal hour to % position within visual window (08:30-18:30)
function hourToPercent(dec) {
  return ((dec - DAY_VIEW_START) / DAY_VIEW_HOURS) * 100;
}

function getTimelineCardDensity(hours) {
  const normalized = Number(hours) || 0;
  if (normalized <= 0.75) return "micro";
  if (normalized <= 1.5) return "compact";
  return "full";
}

function csvEscape(value) {
  const raw = String(value ?? "");
  if (!/[;"\n\r]/.test(raw)) return raw;
  return `"${raw.replace(/"/g, "\"\"")}"`;
}

function hoursToCsv(value) {
  const rounded = roundHalf(Number(value) || 0);
  if (!Number.isFinite(rounded)) return "0";
  const stringValue = Number.isInteger(rounded) ? String(rounded) : String(rounded);
  return stringValue.replace(".", ",");
}

function areStringArraysEqual(a = [], b = []) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function downloadCsv(filename, content) {
  const blob = new Blob([`\uFEFF${content}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function getTimesheetSegmentsForTicket(ticket) {
  const normalizedStatus = normalizeTicketStatus(ticket?.status);
  return isClosedStatus(normalizedStatus)
    ? getVisibleDoneSegments(ticket)
    : getAllTicketSegments(ticket);
}

function getInProgressReminderInfo(ticket, nowDecimal = currentTimeDecimal()) {
  if (normalizeTicketStatus(ticket?.status) !== "in_progress") return null;

  const segments = sortSegments(getAllTicketSegments(ticket));
  const lastSegment = segments[segments.length - 1] || null;
  if (!lastSegment) return null;

  const todayStr = moment().format("YYYY-MM-DD");
  const lastDate = String(lastSegment.date || "");
  const plannedEndLabel = `${lastDate} ${decimalToTime(lastSegment.end)}`;

  if (lastDate < todayStr) {
    return {
      kind: "previous_day",
      title: "Task ancora in corso dal giorno precedente",
      description: `Era pianificata fino a ${plannedEndLabel}. Verifica se va chiusa.`,
      plannedEndLabel,
      canExtend: false,
    };
  }

  if (lastDate === todayStr && Number(lastSegment.end) <= Number(nowDecimal)) {
    return {
      kind: "timer_elapsed",
      title: "Timer pianificato terminato",
      description: `La task era pianificata fino alle ${decimalToTime(lastSegment.end)}.`,
      plannedEndLabel,
      canExtend: lastSegment.end < DAY_END,
    };
  }

  return null;
}

/**
 * Build time-based schedule for tickets within visible week.
 * Returns: { [dateStr]: [{ ticket, startHour, endHour }] }
 * 
 * PRINCIPLE: Tickets with explicit start_time + end_time are ALWAYS rendered at those exact times.
 * Tickets without explicit times are laid out sequentially.
 */
function buildTimeSchedule(devTickets, days, dev) {
  const todayStr = moment().format("YYYY-MM-DD");
  const nowDecimal = currentTimeDecimal();
  const result = {};
  days.forEach(d => { result[d.format("YYYY-MM-DD")] = []; });

  // Sort by priority desc
  const sorted = [...devTickets].sort((a, b) => {
    const urgencyOrder = compareTicketUrgency(a, b);
    if (urgencyOrder !== 0) return urgencyOrder;
    return getEffectivePriorityScore(b) - getEffectivePriorityScore(a);
  });

  // Track cursor per day (for sequential layout)
  const dayCursor = {};
  days.forEach(d => { dayCursor[d.format("YYYY-MM-DD")] = DAY_START; });

  sorted.forEach(ticket => {
    if (isTicketBlocked(ticket)) return;

    const effort = roundHalf(getTicketEffort(ticket) || 4);
    const hasExplicitTimes = ticket.scheduled_date && ticket.start_time && ticket.end_time;
    const normalizedStatus = normalizeTicketStatus(ticket.status);
    const isInProgress = normalizedStatus === "in_progress";
    const isDone = isClosedStatus(normalizedStatus);
    const doneSegments = isDone ? getVisibleDoneSegments(ticket) : [];
    const doneMainSegment = isDone ? doneSegments[0] || null : null;
    const doneContinuationSegments = isDone ? doneSegments.slice(1) : [];

    // Determine target date
    let targetDate;
    if (isInProgress || isDone) {
      targetDate = (isDone ? doneMainSegment?.date : null) || ticket.scheduled_date || todayStr;
    } else if (ticket.scheduled_date) {
      targetDate = ticket.scheduled_date;
    } else {
      for (const day of days) {
        const ds = day.format("YYYY-MM-DD");
        if (!isDeveloperFullyUnavailableDay(dev, ds)) {
          targetDate = ds;
          break;
        }
      }
    }

    // Render explicit schedules from normalized (merged) segments so contiguous
    // slots in the same day appear as a single card.
    if (!isDone && hasExplicitTimes) {
      const explicitSegments = getAllTicketSegments(ticket);
      explicitSegments.forEach((segment, idx) => {
        if (!(segment.date in result)) return;

        const startHour = Math.max(DAY_START, Math.min(DAY_END, segment.start));
        const endHour = Math.max(DAY_START, Math.min(DAY_END, segment.end));
        if (endHour <= startHour) return;

        result[segment.date].push({
          ticket,
          startHour,
          endHour,
          isContinuation: idx > 0,
        });
      });
      return;
    }

    const targetInView = targetDate && (targetDate in result);

    if (targetInView) {
      let startHour, endHour;

      // RULE 1: If ticket has explicit times, USE THEM EXACTLY
      if (hasExplicitTimes) {
        const startDec = isDone && doneMainSegment
          ? doneMainSegment.start
          : timeToDecimal(ticket.start_time);
        const endDec = isDone && doneMainSegment
          ? doneMainSegment.end
          : timeToDecimal(ticket.end_time);
        // Clamp to day bounds but preserve relative position
        startHour = Math.max(DAY_START, Math.min(DAY_END, startDec));
        endHour = Math.max(DAY_START, Math.min(DAY_END, endDec));
        if (isDone && !doneMainSegment && targetDate === todayStr && Number.isFinite(nowDecimal)) {
          endHour = Math.min(endHour, nowDecimal);
        }
      }
      // RULE 2: For in-progress with start time only, calculate end from effort
      else if (isInProgress && ticket.start_time) {
        startHour = timeToDecimal(ticket.start_time);
        endHour = Math.min(DAY_END, startHour + effort);
      }
      // RULE 3: Layout sequentially (no explicit times)
      else {
        const cursor = dayCursor[targetDate];
        startHour = cursor;
        endHour = Math.min(DAY_END, startHour + effort);
      }

      // Validate and add to schedule
      if (endHour > startHour) {
        result[targetDate].push({ ticket, startHour, endHour });

        // Advance cursor ONLY for sequential layouts
        if (!hasExplicitTimes && !isInProgress) {
          dayCursor[targetDate] = endHour;
        }
      }
    }

    if (isDone) {
      doneContinuationSegments.forEach((segment) => {
        if (!(segment.date in result)) return;
        if (!Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.end <= segment.start) return;
        result[segment.date].push({
          ticket,
          startHour: segment.start,
          endHour: segment.end,
          isContinuation: true,
        });
      });
      return;
    }

    // MULTI-DAY: Add continuation days if ticket has continuation_schedule
    if (ticket.continuation_schedule && ticket.continuation_schedule.length > 0) {
      ticket.continuation_schedule.forEach(cont => {
        const contDate = cont.date;
        if (contDate in result) {
          const contStartDec = timeToDecimal(cont.start_time);
          const contEndDec = timeToDecimal(cont.end_time);

          if (Number.isFinite(contStartDec) && Number.isFinite(contEndDec) && contEndDec > contStartDec) {
            result[contDate].push({
              ticket,
              startHour: contStartDec,
              endHour: contEndDec,
              isContinuation: true,
            });
          }
        }
      });
    }
  });

  return result;
}

/**
 * Find first available date for a dev (exported for TicketDetail)
 */
/**
 * Check for scheduling conflicts and suggest alternatives.
 * Returns { status: 'ok'|'error', message, suggestedSchedule }
 */
export function checkScheduleConflict(
  allTickets,
  devId,
  _ticketPriority,
  scheduledDate,
  startTime,
  endTime,
  ticketId = null,
  dev = null,
  options = {}
) {
  const allowTicketReflow = Boolean(options?.allowTicketReflow);
  const newStart = timeToDecimal(startTime);
  const newEnd = timeToDecimal(endTime);
  
  if (!Number.isFinite(newStart) || !Number.isFinite(newEnd) || newEnd <= newStart) {
    return { status: 'error', message: 'Invalid time range', suggestedSchedule: null };
  }

  const unavailableIntervals = (dev
    ? getDeveloperUnavailableIntervalsByDate(dev, { dates: [scheduledDate] })[scheduledDate]
    : null) || [];
  const hasUnavailableOverlap = unavailableIntervals.some((slot) =>
    getSlotOverlap(newStart, newEnd, slot.start, slot.end) > 0
  );

  if (hasUnavailableOverlap) {
    const effortHours = roundHalf(newEnd - newStart);
    const schedule = findOptimalSchedule(allTickets, devId, effortHours, 8, dev, {
      excludeTicketIds: [ticketId].filter(Boolean),
    });
    const suggestion = schedule.length > 0
      ? { date: schedule[0].date, start_time: schedule[0].start_time, end_time: schedule[0].end_time }
      : null;

    return {
      status: "error",
      message: "Questo orario ricade in una fascia bloccata impostata in disponibilita.",
      suggestedSchedule: suggestion,
    };
  }

  const conflicts = (allTickets || [])
    .filter((t) =>
      t.assignee_id === devId &&
      t.id !== ticketId &&
      isSchedulableTicket(t)
    )
    .flatMap((t) =>
      getTicketSegmentsOnDate(t, scheduledDate)
        .filter((segment) => getSlotOverlap(newStart, newEnd, segment.start, segment.end) > 0)
        .map((segment) => ({ ticket: t, segment }))
    );

  if (conflicts.length === 0) {
    return { status: 'ok', message: 'No conflicts', suggestedSchedule: null };
  }

  if (allowTicketReflow) {
    return {
      status: "ok",
      message: "Slot occupato: le altre attivita verranno ripianificate.",
      suggestedSchedule: null,
      conflicts,
    };
  }

  const effortHours = roundHalf(newEnd - newStart);
  const schedule = findOptimalSchedule(allTickets, devId, effortHours, 8, dev, {
    excludeTicketIds: [ticketId].filter(Boolean),
  });
  
  const suggestion = schedule.length > 0 
    ? { date: schedule[0].date, start_time: schedule[0].start_time, end_time: schedule[0].end_time }
    : null;
  const firstConflict = conflicts[0];
  const conflictTitle = firstConflict?.ticket?.title || "un'altra task";
  const conflictTime = firstConflict?.segment
    ? `${decimalToTime(firstConflict.segment.start)}-${decimalToTime(firstConflict.segment.end)}`
    : "";

  return {
    status: "error",
    message: `Slot occupato da ${conflictTitle}${conflictTime ? ` (${conflictTime})` : ""}. Non possono esserci due task nello stesso slot.`,
    suggestedSchedule: suggestion
  };
}

export function findFirstAvailableDate(allTickets, devId, effortHours, dailyCapacity = 8, dev = null) {
  const schedule = findOptimalSchedule(allTickets, devId, effortHours, dailyCapacity, dev);
  return schedule.length > 0 ? schedule[0].date : moment().format("YYYY-MM-DD");
}

/**
 * Find optimal schedule slots for a task, considering current time and existing tickets.
 * Returns array of { date, start_time, end_time, hours }
 */
export function findOptimalSchedule(
  allTickets,
  devId,
  effortHours,
  dailyCapacity = 8,
  dev = null,
  { excludeTicketIds = [] } = {}
) {
  const result = [];
  let remaining = roundHalf(effortHours);
  const excludedIds = new Set((excludeTicketIds || []).filter(Boolean));
  const scheduleFrom = moment().startOf("day").format("YYYY-MM-DD");
  const scheduleTo = moment().startOf("day").add(90, "days").format("YYYY-MM-DD");
  const unavailableIntervalsByDate = getDeveloperUnavailableIntervalsByDate(dev, {
    fromDate: scheduleFrom,
    toDate: scheduleTo,
  });
  
  // Build existing schedule by date
  const dateSchedule = {}; // date -> [{ start, end }]
  allTickets
    .filter((t) => t.assignee_id === devId && isSchedulableTicket(t) && !excludedIds.has(t.id))
    .forEach(t => {
      getAllTicketSegments(t).forEach((segment) => {
        if (!dateSchedule[segment.date]) dateSchedule[segment.date] = [];
        dateSchedule[segment.date].push({
          start: segment.start,
          end: segment.end,
        });
      });
    });

  // Sort existing slots by start time
  Object.keys(dateSchedule).forEach(d => {
    dateSchedule[d].sort((a, b) => a.start - b.start);
  });

  const nowDecimal = currentTimeDecimal();
  const todayStr = moment().format("YYYY-MM-DD");
  let cursor = moment().startOf("day");

  for (let i = 0; i < 90 && remaining > 0; i++) {
    const dow = cursor.isoWeekday();
    const dateStr = cursor.format("YYYY-MM-DD");
    
    if (dow <= 5) {
      const isToday = dateStr === todayStr;
      const dayStart = isToday && nowDecimal > DAY_START ? Math.max(DAY_START, nowDecimal) : DAY_START;
      
      // Find free slots in this day (excluding lunch break 13:00-14:00)
      const occupied = [
        ...(dateSchedule[dateStr] || []),
        ...(unavailableIntervalsByDate[dateStr] || []),
        { start: LUNCH_START, end: LUNCH_END }, // lunch break as occupied
      ].sort((a, b) => a.start - b.start);
      const freeSlots = [];
      
      let pointer = dayStart;
      for (const slot of occupied) {
        if (pointer < slot.start) {
          freeSlots.push({ start: pointer, end: Math.min(slot.start, DAY_END) });
        }
        pointer = Math.max(pointer, slot.end);
      }
      if (pointer < DAY_END) {
        freeSlots.push({ start: pointer, end: DAY_END });
      }

      // Fill free slots with remaining hours
      for (const free of freeSlots) {
        const available = roundHalf(free.end - free.start);
        if (available > 0 && remaining > 0) {
          const allocate = Math.min(available, remaining);
          const endTime = Math.min(free.start + allocate, DAY_END);
          result.push({
            date: dateStr,
            start_time: decimalToTime(free.start),
            end_time: decimalToTime(endTime),
            hours: roundHalf(endTime - free.start),
          });
          remaining = roundHalf(remaining - (endTime - free.start));
          if (remaining <= 0) break;
        }
      }
    }
    cursor.add(1, "day");
  }

  return result;
}

/**
 * Rebuild weekly planning for a developer.
 * Rules:
 * - Keep today's explicit plan unchanged.
 * - Fill today's holes only with remaining capacity.
 * - Reorder tomorrow+ by priority (higher first).
 */
export function buildWeeklyRebalanceUpdates(
  allTickets,
  devId,
  dev = null,
  {
    includeTodayHoles = false,
    horizonDays = DEFAULT_REBALANCE_HORIZON_DAYS,
    planningStartDate = getSafePlanningStartDate(),
    freezeCurrentWeekSegments = true,
    freezeTicketIds = [],
    preserveTodaySegments = true,
    preserveElapsedTodaySegments = true,
    preserveWorkingDaysFromToday = 0,
    allowInProgressReplan = false,
    manualInsertionAnchor = null,
    preserveExistingSequence = false,
    forceFirstTicketIds = [],
    forceLastTicketIds = [],
  } = {}
) {
  const todayMoment = moment().startOf("day");
  const todayStr = todayMoment.format("YYYY-MM-DD");
  const nowDecimal = currentTimeDecimal();
  const tomorrowMoment = todayMoment.clone().add(1, "day");
  const currentWorkWeekEnd = todayMoment.clone().startOf("isoWeek").add(4, "day");
  const requestedStart = planningStartDate
    ? moment(planningStartDate, "YYYY-MM-DD", true)
    : null;
  const planningStartMoment = requestedStart?.isValid()
    ? moment.max(requestedStart.startOf("day"), todayMoment.clone())
    : todayMoment.clone();
  const planningStartStr = planningStartMoment.format("YYYY-MM-DD");
  const anchorDate = String(manualInsertionAnchor?.date || "").trim();
  const anchorStart = Number(manualInsertionAnchor?.start);
  const hasManualInsertionAnchor =
    Boolean(anchorDate) && Number.isFinite(anchorStart);
  const shouldPreserveTodaySegments = preserveTodaySegments && planningStartStr === todayStr;
  const preserveAllBeforePlanningStart = planningStartMoment.isAfter(todayMoment, "day");
  const protectedWorkingDates = getProtectedWorkingDateSet(todayMoment, preserveWorkingDaysFromToday);
  const frozenTicketSet = new Set((freezeTicketIds || []).filter(Boolean));
  const forceFirstTicketSet = new Set((forceFirstTicketIds || []).filter(Boolean));
  const forceLastTicketSet = new Set((forceLastTicketIds || []).filter(Boolean));

  const devTickets = (allTickets || []).filter(
    (ticket) => ticket.assignee_id === devId && isSchedulableTicket(ticket)
  );

  if (devTickets.length === 0) return [];

  const replannable = devTickets.filter(
    (ticket) =>
      !frozenTicketSet.has(ticket.id) &&
      !shouldLockWholeTicket(ticket, planningStartMoment, todayMoment, { allowInProgressReplan }) &&
      getTicketEffort(ticket) > 0
  );

  if (replannable.length === 0) return [];

  const replannableIds = new Set(replannable.map((ticket) => ticket.id));
  const lockedIntervalsByDate = {};
  const preservedSegmentsByTicket = {};
  const preservedHoursByTicket = {};
  const unavailableIntervalsByDate = getDeveloperUnavailableIntervalsByDate(dev, {
    fromDate: planningStartMoment.format("YYYY-MM-DD"),
    toDate: planningStartMoment.clone().add(horizonDays, "days").format("YYYY-MM-DD"),
  });

  const preserveSegment = (ticket, segment, isReplannable) => {
    if (!segment || segment.end <= segment.start) return;

    if (!lockedIntervalsByDate[segment.date]) {
      lockedIntervalsByDate[segment.date] = [];
    }
    lockedIntervalsByDate[segment.date].push({
      start: segment.start,
      end: segment.end,
    });

    if (!isReplannable) return;

    if (!preservedSegmentsByTicket[ticket.id]) {
      preservedSegmentsByTicket[ticket.id] = [];
    }
    preservedSegmentsByTicket[ticket.id].push(segment);
    preservedHoursByTicket[ticket.id] = roundHalf(
      (preservedHoursByTicket[ticket.id] || 0) + segmentDuration(segment)
    );
  };

  // PASS 1: preserve only strong/fixed segments (locks, past window, frozen rules).
  devTickets.forEach((ticket) => {
    const lockAllSegments =
      frozenTicketSet.has(ticket.id) ||
      shouldLockWholeTicket(ticket, planningStartMoment, todayMoment, { allowInProgressReplan });
    const isReplannable = replannableIds.has(ticket.id);

    getAllTicketSegments(ticket).forEach((segment) => {
      const segmentMoment = moment(segment.date, "YYYY-MM-DD", true);
      const beforePlanningStart = segmentMoment.isValid()
        ? segmentMoment.isBefore(planningStartMoment, "day")
        : String(segment.date || "") < planningStartStr;
      const isTodayOrPast = segmentMoment.isValid()
        ? !segmentMoment.isAfter(todayMoment, "day")
        : String(segment.date || "") <= todayStr;
      const preserveBeforeWindow =
        beforePlanningStart &&
        (preserveAllBeforePlanningStart || isTodayOrPast) &&
        !isReplannable;
      const isTodayFrozen = shouldPreserveTodaySegments && segment.date === todayStr;
      const preserveCurrentWeekSegment = freezeCurrentWeekSegments &&
        segmentMoment.isValid() &&
        segmentMoment.isBetween(tomorrowMoment, currentWorkWeekEnd, "day", "[]");
      const preserveProtectedWorkingDaySegment = protectedWorkingDates.has(String(segment.date || ""));
      const preserveBeforeManualAnchor =
        hasManualInsertionAnchor &&
        (String(segment.date || "") < anchorDate ||
          (String(segment.date || "") === anchorDate && Number(segment.end) <= anchorStart));

      const shouldPreserveBase =
        lockAllSegments ||
        preserveBeforeWindow ||
        isTodayFrozen ||
        preserveCurrentWeekSegment ||
        preserveProtectedWorkingDaySegment ||
        preserveBeforeManualAnchor;
      if (!shouldPreserveBase) return;

      preserveSegment(ticket, segment, isReplannable);
    });
  });

  // PASS 2: preserve elapsed part of today only when it does NOT collide with pass-1 locks.
  if (preserveElapsedTodaySegments && planningStartStr === todayStr) {
    devTickets.forEach((ticket) => {
      const lockAllSegments =
        frozenTicketSet.has(ticket.id) ||
        shouldLockWholeTicket(ticket, planningStartMoment, todayMoment, { allowInProgressReplan });
      const isReplannable = replannableIds.has(ticket.id);
      if (lockAllSegments) return;

      getAllTicketSegments(ticket).forEach((segment) => {
        if (segment.date !== todayStr) return;
        if (!(segment.start < nowDecimal)) return;

        const effectiveEnd = Math.min(segment.end, ceilHalf(nowDecimal));
        if (effectiveEnd <= segment.start) return;

        const intervals = lockedIntervalsByDate[segment.date] || [];
        const overlapsLocked = intervals.some(
          (interval) => getSlotOverlap(segment.start, effectiveEnd, interval.start, interval.end) > 0
        );
        if (overlapsLocked) return;

        preserveSegment(
          ticket,
          {
            ...segment,
            end: effectiveEnd,
          },
          isReplannable
        );
      });
    });
  }

  Object.entries(unavailableIntervalsByDate).forEach(([dateStr, intervals]) => {
    if (!lockedIntervalsByDate[dateStr]) {
      lockedIntervalsByDate[dateStr] = [];
    }
    lockedIntervalsByDate[dateStr].push(...intervals);
  });

  Object.keys(lockedIntervalsByDate).forEach((dateStr) => {
    lockedIntervalsByDate[dateStr] = normalizeIntervals(lockedIntervalsByDate[dateStr]);
  });

  const freeSlots = [];
  let cursor = planningStartMoment.clone();

  for (let i = 0; i < horizonDays; i++) {
    const dateStr = cursor.format("YYYY-MM-DD");
    const dayOfWeek = cursor.isoWeekday();
    const isToday = dateStr === todayStr;

    if (dayOfWeek <= 5) {
      const slots = buildFreeSlotsForDay(dateStr, lockedIntervalsByDate[dateStr] || [], {
        isToday,
        includeTodayHoles,
        nowDecimal,
      });
      freeSlots.push(...slots);
    }

    cursor.add(1, "day");
  }

  const sortedTickets = [...replannable].sort((a, b) => {
    const aForcedFirst = forceFirstTicketSet.has(a.id);
    const bForcedFirst = forceFirstTicketSet.has(b.id);
    if (aForcedFirst !== bForcedFirst) return aForcedFirst ? -1 : 1;

    const urgencyOrder = compareTicketUrgency(a, b);
    if (urgencyOrder !== 0) return urgencyOrder;

    if (preserveExistingSequence) {
      const aForcedLast = forceLastTicketSet.has(a.id);
      const bForcedLast = forceLastTicketSet.has(b.id);
      if (aForcedLast !== bForcedLast) return aForcedLast ? 1 : -1;

      const sequenceA = getSequenceSortValue(a, anchorDate, anchorStart);
      const sequenceB = getSequenceSortValue(b, anchorDate, anchorStart);

      if (sequenceA.hasSchedule !== sequenceB.hasSchedule) {
        return sequenceA.hasSchedule ? -1 : 1;
      }

      if (!sequenceA.hasSchedule && !sequenceB.hasSchedule) {
        const priorityA = getEffectivePriorityScore(a);
        const priorityB = getEffectivePriorityScore(b);
        if (priorityB !== priorityA) return priorityB - priorityA;

        const deadlineA = getDeadlineSortValue(a);
        const deadlineB = getDeadlineSortValue(b);
        if (deadlineA !== deadlineB) return deadlineA - deadlineB;
      }

      if (sequenceA.date !== sequenceB.date) return sequenceA.date.localeCompare(sequenceB.date);
      if (sequenceA.start !== sequenceB.start) return sequenceA.start - sequenceB.start;
      if (sequenceA.created !== sequenceB.created) return sequenceA.created - sequenceB.created;
      return String(a.id || "").localeCompare(String(b.id || ""));
    }

    const priorityA = getEffectivePriorityScore(a);
    const priorityB = getEffectivePriorityScore(b);
    if (priorityB !== priorityA) return priorityB - priorityA;

    const deadlineA = getDeadlineSortValue(a);
    const deadlineB = getDeadlineSortValue(b);
    if (deadlineA !== deadlineB) return deadlineA - deadlineB;

    const createdA = Date.parse(a.created_date || "") || 0;
    const createdB = Date.parse(b.created_date || "") || 0;
    return createdA - createdB;
  });

  const mutableSlots = freeSlots.map((slot) => ({ ...slot }));
  const updates = [];

  sortedTickets.forEach((ticket) => {
    const preservedSegments = sortSegments(preservedSegmentsByTicket[ticket.id] || []);
    const plannedEffort = getTicketEffort(ticket);
    const preservedHours = roundHalf(preservedHoursByTicket[ticket.id] || 0);
    let remaining = roundHalf(Math.max(0, plannedEffort - preservedHours));
    const allocatedSegments = [];

    for (const slot of mutableSlots) {
      if (remaining <= 0) break;

      const available = roundHalf(slot.end - slot.start);
      if (available <= 0) continue;

      const hours = roundHalf(Math.min(available, remaining));
      const segmentStart = slot.start;
      const segmentEnd = roundHalf(segmentStart + hours);

      allocatedSegments.push({
        date: slot.date,
        start: segmentStart,
        end: segmentEnd,
      });

      slot.start = segmentEnd;
      remaining = roundHalf(remaining - hours);
    }

    const segments = sortSegments([...preservedSegments, ...allocatedSegments]);
    const nextSchedule = schedulePayloadFromSegments(segments);
    if (!scheduleChanged(ticket, nextSchedule)) return;

    updates.push({
      id: ticket.id,
      updates: {
        ...nextSchedule,
        ...buildScheduleSlipMetadata(ticket, nextSchedule),
      },
    });
  });

  return updates;
}

export function buildVisibleWeekCompactionUpdates(
  allTickets,
  devId,
  weekStartDate,
  dev = null,
  { weekDays = 5 } = {}
) {
  const weekStart = moment(weekStartDate, "YYYY-MM-DD", true);
  if (!weekStart.isValid()) return [];
  const weekEnd = weekStart.clone().add(weekDays - 1, "day");

  const devTickets = (allTickets || []).filter(
    (ticket) => ticket.assignee_id === devId && isSchedulableTicket(ticket)
  );
  if (devTickets.length === 0) return [];

  const lockedIntervalsByDate = {};
  const preservedOutsideWeekByTicket = {};
  const weekEffortByTicket = {};
  const unavailableIntervalsByDate = getDeveloperUnavailableIntervalsByDate(dev, {
    fromDate: weekStart.format("YYYY-MM-DD"),
    toDate: weekEnd.format("YYYY-MM-DD"),
  });

  devTickets.forEach((ticket) => {
    const segments = getAllTicketSegments(ticket);
    const lockWholeInWeek = normalizeTicketStatus(ticket.status) === "in_progress";

    segments.forEach((segment) => {
      const segmentMoment = moment(segment.date, "YYYY-MM-DD", true);
      const inWeek = segmentMoment.isValid() && segmentMoment.isBetween(weekStart, weekEnd, "day", "[]");

      if (!inWeek) {
        if (!preservedOutsideWeekByTicket[ticket.id]) {
          preservedOutsideWeekByTicket[ticket.id] = [];
        }
        preservedOutsideWeekByTicket[ticket.id].push(segment);
        return;
      }

      if (lockWholeInWeek) {
        if (!lockedIntervalsByDate[segment.date]) {
          lockedIntervalsByDate[segment.date] = [];
        }
        lockedIntervalsByDate[segment.date].push({
          start: segment.start,
          end: segment.end,
        });
        if (!preservedOutsideWeekByTicket[ticket.id]) {
          preservedOutsideWeekByTicket[ticket.id] = [];
        }
        preservedOutsideWeekByTicket[ticket.id].push(segment);
        return;
      }

      weekEffortByTicket[ticket.id] = roundHalf(
        (weekEffortByTicket[ticket.id] || 0) + segmentDuration(segment)
      );
    });
  });

  Object.keys(lockedIntervalsByDate).forEach((dateStr) => {
    lockedIntervalsByDate[dateStr] = normalizeIntervals(lockedIntervalsByDate[dateStr]);
  });

  const freeSlots = [];
  for (let i = 0; i < weekDays; i++) {
    const date = weekStart.clone().add(i, "day");
    const dateStr = date.format("YYYY-MM-DD");
    if (date.isoWeekday() > 5) continue;

    if (!lockedIntervalsByDate[dateStr]) {
      lockedIntervalsByDate[dateStr] = [];
    }
    lockedIntervalsByDate[dateStr].push(...(unavailableIntervalsByDate[dateStr] || []));
    lockedIntervalsByDate[dateStr] = normalizeIntervals(lockedIntervalsByDate[dateStr]);

    const daySlots = buildFreeSlotsForDay(dateStr, lockedIntervalsByDate[dateStr] || [], {
      isToday: false,
      includeTodayHoles: true,
      nowDecimal: DAY_START,
    });
    freeSlots.push(...daySlots);
  }
  if (freeSlots.length === 0) return [];

  const replannableTickets = devTickets
    .filter((ticket) => (weekEffortByTicket[ticket.id] || 0) > 0)
    .sort((a, b) => {
      const urgencyOrder = compareTicketUrgency(a, b);
      if (urgencyOrder !== 0) return urgencyOrder;
      const priorityA = getEffectivePriorityScore(a);
      const priorityB = getEffectivePriorityScore(b);
      if (priorityB !== priorityA) return priorityB - priorityA;
      const deadlineA = getDeadlineSortValue(a);
      const deadlineB = getDeadlineSortValue(b);
      if (deadlineA !== deadlineB) return deadlineA - deadlineB;
      const createdA = Date.parse(a.created_date || "") || 0;
      const createdB = Date.parse(b.created_date || "") || 0;
      return createdA - createdB;
    });

  const mutableSlots = freeSlots.map((slot) => ({ ...slot }));
  const allocatedByTicket = {};

  replannableTickets.forEach((ticket) => {
    let remaining = weekEffortByTicket[ticket.id] || 0;
    const allocated = [];

    for (const slot of mutableSlots) {
      if (remaining <= 0) break;
      const available = roundHalf(slot.end - slot.start);
      if (available <= 0) continue;

      const hours = roundHalf(Math.min(available, remaining));
      const segmentStart = slot.start;
      const segmentEnd = roundHalf(segmentStart + hours);

      allocated.push({
        date: slot.date,
        start: segmentStart,
        end: segmentEnd,
      });

      slot.start = segmentEnd;
      remaining = roundHalf(remaining - hours);
    }

    allocatedByTicket[ticket.id] = allocated;
  });

  const updates = [];
  devTickets.forEach((ticket) => {
    const preservedOutsideWeek = sortSegments(preservedOutsideWeekByTicket[ticket.id] || []);
    const allocatedInWeek = sortSegments(allocatedByTicket[ticket.id] || []);
    const nextSegments = sortSegments([...preservedOutsideWeek, ...allocatedInWeek]);
    const nextSchedule = schedulePayloadFromSegments(nextSegments);

    if (!scheduleChanged(ticket, nextSchedule)) return;

    updates.push({
      id: ticket.id,
      updates: nextSchedule,
    });
  });

  return updates;
}

export default function DevPipeline() {
  const [searchParams] = useSearchParams();
  const [weekOffset, setWeekOffset] = usePersistedState("dev-pipeline:weekOffset", 0);
  const [currentTime, setCurrentTime] = useState(getCurrentTimeDecimal());
  const [activeDeveloperId, setActiveDeveloperId] = usePersistedState("dev-pipeline:activeDeveloperId", "");
  const [pendingRequestedDeveloperId, setPendingRequestedDeveloperId] = useState(() => searchParams.get("dev") || "");
  const [selectedClientIds, setSelectedClientIds] = usePersistedState("dev-pipeline:selectedClientIds", null);
  const [dismissedInProgressReminderIds, setDismissedInProgressReminderIds] = useState([]);
  const [showInProgressReminderList, setShowInProgressReminderList] = useState(false);
  const staleRebalanceSignatureRef = useRef("");
  const urgentRebalanceSignatureRef = useRef("");
  const queryClient = useQueryClient();
  const { user, isTechSupervisor, isAdmin, isAnalyst } = useCurrentUser();

  // Update current time every minute (Europe/Rome timezone)
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(getCurrentTimeDecimal()), 60000);
    return () => clearInterval(interval);
  }, []);

  const { data: developers = [] } = useQuery({
    queryKey: ["developers"],
    queryFn: () => appClient.entities.Developer.list(),
  });

  const { data: tickets = [] } = useQuery({
    queryKey: ["tickets"],
    queryFn: () => appClient.entities.Ticket.list(),
  });

  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: () => appClient.entities.Client.list(),
  });

  const clientsById = useMemo(
    () => new Map(clients.map((client) => [client.id, client])),
    [clients]
  );

  const clientsByName = useMemo(
    () =>
      new Map(
        clients
          .filter((client) => Boolean(client.name))
          .map((client) => [String(client.name).toLowerCase(), client])
      ),
    [clients]
  );

  const getTicketClientKey = (ticket) => {
    const byId = ticket?.client_id ? clientsById.get(ticket.client_id) : null;
    const byName = !byId && ticket?.client_name
      ? clientsByName.get(String(ticket.client_name).toLowerCase())
      : null;
    const client = byId || byName || null;
    return client?.id || NO_CLIENT_FILTER_ID;
  };

  const getTicketClientMeta = (ticket) => {
    const byId = ticket?.client_id ? clientsById.get(ticket.client_id) : null;
    const byName = !byId && ticket?.client_name
      ? clientsByName.get(String(ticket.client_name).toLowerCase())
      : null;
    const client = byId || byName || null;

    return {
      clientId: client?.id || NO_CLIENT_FILTER_ID,
      clientName: ticket?.client_name || client?.name || "No client",
      clientColor: getClientColor(client, ticket?.client_id || ticket?.client_name || ticket?.id),
    };
  };

  const startOfWeek = moment().add(weekOffset, "weeks").startOf("isoWeek");

  const applyDeveloperRebalance = async (developerId, developer = null, options = {}) => {
    if (!developerId) return;

    const latestTickets = await appClient.entities.Ticket.list();
    const devRef = developer || developers.find((item) => item.id === developerId) || null;
    const resolvedOptions = getDynamicRebalanceOptions(options);
    const updates = buildWeeklyRebalanceUpdates(
      latestTickets,
      developerId,
      devRef,
      resolvedOptions
    );

    if (updates.length > 0) {
      await Promise.all(
        updates.map((entry) => appClient.entities.Ticket.update(entry.id, entry.updates))
      );
    }

    await queryClient.invalidateQueries({ queryKey: ["tickets"] });
  };

  const days = [0, 1, 2, 3, 4].map(i => startOfWeek.clone().add(i, "days"));
  const isCurrentWeek = weekOffset === 0;
  const today = moment().startOf("day");

  const activeDevs = useMemo(
    () => developers.filter((d) => d.active !== false),
    [developers]
  );
  const canViewAllPipelines = isAdmin || isAnalyst || isTechSupervisor;
  const loggedDeveloper = useMemo(() => {
    const email = normalizeText(user?.email);
    if (!email) return null;
    return activeDevs.find((dev) => normalizeText(dev?.email) === email) || null;
  }, [activeDevs, user?.email]);
  const selectableDevelopers = useMemo(
    () => (canViewAllPipelines ? activeDevs : loggedDeveloper ? [loggedDeveloper] : []),
    [activeDevs, canViewAllPipelines, loggedDeveloper]
  );

  useEffect(() => {
    if (selectableDevelopers.length === 0 || tickets.length === 0) return;

    const todayStr = moment().format("YYYY-MM-DD");
    const developerById = new Map(selectableDevelopers.map((dev) => [dev.id, dev]));
    const staleTickets = tickets
      .filter((ticket) => {
        if (!ticket?.assignee_id || !developerById.has(ticket.assignee_id)) return false;
        if (!ticket.scheduled_date || String(ticket.scheduled_date) >= todayStr) return false;
        if (!isSchedulableTicket(ticket)) return false;
        if (normalizeTicketStatus(ticket.status) === "in_progress") return false;
        return getTicketEffort(ticket) > 0;
      })
      .sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));

    if (staleTickets.length === 0) return;

    const staleDeveloperIds = [...new Set(staleTickets.map((ticket) => ticket.assignee_id).filter(Boolean))];
    const signature = `${todayStr}:${staleTickets.map((ticket) => ticket.id).join(",")}`;
    if (staleRebalanceSignatureRef.current === signature) return;
    staleRebalanceSignatureRef.current = signature;

    let cancelled = false;

    const rebalanceStaleTickets = async () => {
      let movedCount = 0;

      for (const developerId of staleDeveloperIds) {
        const dev = developerById.get(developerId) || null;
        const latestTickets = await appClient.entities.Ticket.list();
        const updates = buildWeeklyRebalanceUpdates(
          latestTickets,
          developerId,
          dev,
          getDynamicRebalanceOptions({
            planningStartDate: todayStr,
            includeTodayHoles: true,
            preserveTodaySegments: false,
            preserveWorkingDaysFromToday: 3,
            preserveExistingSequence: true,
          })
        );

        if (updates.length === 0) continue;
        movedCount += updates.length;
        await Promise.all(
          updates.map((entry) => appClient.entities.Ticket.update(entry.id, entry.updates))
        );
      }

      if (movedCount > 0 && !cancelled) {
        await queryClient.invalidateQueries({ queryKey: ["tickets"] });
        toast({
          title: "Pipeline riallineata",
          description: `${movedCount} ticket arretrati ripianificati da oggi in avanti.`,
        });
      }
    };

    rebalanceStaleTickets().catch(() => {
      staleRebalanceSignatureRef.current = "";
    });

    return () => {
      cancelled = true;
    };
  }, [queryClient, selectableDevelopers, tickets]);

  useEffect(() => {
    if (selectableDevelopers.length === 0 || tickets.length === 0) return;

    const todayStr = moment().format("YYYY-MM-DD");
    const developerById = new Map(selectableDevelopers.map((dev) => [dev.id, dev]));
    const urgentTickets = tickets
      .filter((ticket) => {
        if (!ticket?.urgent_requested_at) return false;
        if (!ticket?.assignee_id || !developerById.has(ticket.assignee_id)) return false;
        if (!isSchedulableTicket(ticket)) return false;
        return getTicketEffort(ticket) > 0;
      })
      .sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));

    if (urgentTickets.length === 0) return;

    const urgentDeveloperIds = [...new Set(urgentTickets.map((ticket) => ticket.assignee_id).filter(Boolean))];
    const signature = `${todayStr}:${urgentTickets
      .map((ticket) => `${ticket.id}:${ticket.urgent_requested_at || ""}`)
      .join(",")}`;
    if (urgentRebalanceSignatureRef.current === signature) return;
    urgentRebalanceSignatureRef.current = signature;

    let cancelled = false;

    const rebalanceUrgentTickets = async () => {
      let movedCount = 0;

      for (const developerId of urgentDeveloperIds) {
        const dev = developerById.get(developerId) || null;
        const latestTickets = await appClient.entities.Ticket.list();
        const updates = buildWeeklyRebalanceUpdates(
          latestTickets,
          developerId,
          dev,
          getDynamicRebalanceOptions({
            planningStartDate: todayStr,
            includeTodayHoles: true,
            preserveTodaySegments: false,
            preserveWorkingDaysFromToday: 0,
            preserveExistingSequence: true,
            allowInProgressReplan: true,
            freezeCurrentWeekSegments: false,
          })
        );

        if (updates.length === 0) continue;
        movedCount += updates.length;
        await Promise.all(
          updates.map((entry) => appClient.entities.Ticket.update(entry.id, entry.updates))
        );
      }

      if (movedCount > 0 && !cancelled) {
        await queryClient.invalidateQueries({ queryKey: ["tickets"] });
        toast({
          title: "Urgenze riallineate",
          description: `${movedCount} attivita ripianificate mantenendo le urgenze sopra.`,
        });
      }
    };

    rebalanceUrgentTickets().catch(() => {
      urgentRebalanceSignatureRef.current = "";
    });

    return () => {
      cancelled = true;
    };
  }, [queryClient, selectableDevelopers, tickets]);

  const clientFilterOptions = useMemo(() => {
    const optionMap = new Map();

    clients.forEach((client) => {
      if (!client?.id) return;
      optionMap.set(client.id, {
        id: client.id,
        label: client.name || "Cliente",
        color: getClientColor(client, client.id),
      });
    });

    const hasNoClientTickets = tickets.some((ticket) => getTicketClientKey(ticket) === NO_CLIENT_FILTER_ID);
    if (hasNoClientTickets) {
      optionMap.set(NO_CLIENT_FILTER_ID, {
        id: NO_CLIENT_FILTER_ID,
        label: "Senza cliente",
        color: DEFAULT_CLIENT_COLOR,
      });
    }

    return [...optionMap.values()].sort((a, b) =>
      String(a.label || "").localeCompare(String(b.label || ""), "it", { sensitivity: "base" })
    );
  }, [clients, tickets]);

  useEffect(() => {
    if (activeDevs.length === 0) {
      setActiveDeveloperId((prev) => (prev === "" ? prev : ""));
      return;
    }

    if (!canViewAllPipelines) {
      const loggedDeveloperId = loggedDeveloper?.id || "";
      setActiveDeveloperId((prev) => (prev === loggedDeveloperId ? prev : loggedDeveloperId));
      if (pendingRequestedDeveloperId) setPendingRequestedDeveloperId("");
      return;
    }

    if (
      pendingRequestedDeveloperId &&
      activeDevs.some((dev) => dev.id === pendingRequestedDeveloperId)
    ) {
      if (activeDeveloperId !== pendingRequestedDeveloperId) {
        setActiveDeveloperId(pendingRequestedDeveloperId);
      }
      setPendingRequestedDeveloperId("");
      return;
    }

    const hasCurrentSelection = activeDevs.some((dev) => dev.id === activeDeveloperId);
    if (hasCurrentSelection) {
      if (pendingRequestedDeveloperId) {
        setPendingRequestedDeveloperId("");
      }
      return;
    }

    const nextDeveloperId =
      activeDevs.some((dev) => dev.id === pendingRequestedDeveloperId)
        ? pendingRequestedDeveloperId
        : loggedDeveloper && activeDevs.some((dev) => dev.id === loggedDeveloper.id)
          ? loggedDeveloper.id
          : activeDevs[0].id;

    if (nextDeveloperId !== activeDeveloperId) setActiveDeveloperId(nextDeveloperId);
    if (pendingRequestedDeveloperId) setPendingRequestedDeveloperId("");
  }, [
    activeDevs,
    activeDeveloperId,
    canViewAllPipelines,
    loggedDeveloper,
    pendingRequestedDeveloperId,
  ]);

  useEffect(() => {
    if (clientFilterOptions.length === 0) {
      return;
    }

    const availableIds = clientFilterOptions.map((client) => client.id);
    if (!Array.isArray(selectedClientIds) || selectedClientIds.length === 0) {
      setSelectedClientIds(availableIds);
      return;
    }

    setSelectedClientIds((prev) => {
      const current = Array.isArray(prev) ? prev : availableIds;
      const next = current.filter((id) => availableIds.includes(id));
      return areStringArraysEqual(next, current) ? current : next;
    });
  }, [clientFilterOptions, selectedClientIds, setSelectedClientIds]);

  const selectedClientList = Array.isArray(selectedClientIds) ? selectedClientIds : [];
  const selectedClientIdSet = useMemo(() => new Set(selectedClientList), [selectedClientList]);
  const activeDeveloper = useMemo(
    () => activeDevs.find((dev) => dev.id === activeDeveloperId) || null,
    [activeDevs, activeDeveloperId]
  );
  const visibleDevelopers = activeDeveloper ? [activeDeveloper] : [];
  const visibleDeveloperIds = useMemo(
    () => new Set(visibleDevelopers.map((developer) => developer.id).filter(Boolean)),
    [visibleDevelopers]
  );
  const inProgressReminders = useMemo(() => {
    if (visibleDeveloperIds.size === 0) return [];
    const dismissedIds = new Set(dismissedInProgressReminderIds);

    return tickets
      .filter((ticket) => visibleDeveloperIds.has(ticket.assignee_id))
      .map((ticket) => ({
        ticket,
        info: getInProgressReminderInfo(ticket, currentTime),
      }))
      .filter((entry) => entry.info && !dismissedIds.has(entry.ticket.id))
      .sort((a, b) => String(a.info.plannedEndLabel).localeCompare(String(b.info.plannedEndLabel)));
  }, [currentTime, dismissedInProgressReminderIds, tickets, visibleDeveloperIds]);
  const canDownloadTimesheet =
    Boolean(activeDeveloper) &&
    (isAdmin || (loggedDeveloper && activeDeveloper?.id === loggedDeveloper.id));

  const filteredTickets = useMemo(() => {
    if (selectedClientIdSet.size === 0) return [];
    return tickets.filter((ticket) => {
      const status = ticket?.status;
      if (!status) return false;
      return selectedClientIdSet.has(getTicketClientKey(ticket));
    });
  }, [tickets, selectedClientIdSet, clientsById, clientsByName]);

  const dismissInProgressReminder = (ticketId) => {
    if (!ticketId) return;
    setDismissedInProgressReminderIds((current) =>
      current.includes(ticketId) ? current : [...current, ticketId]
    );
  };

  const rebalanceAfterReminderAction = async (ticket, options = {}) => {
    if (!ticket?.assignee_id) return;

    const latestTickets = await appClient.entities.Ticket.list();
    const dev = developers.find((developer) => developer.id === ticket.assignee_id) || null;
    const updates = buildWeeklyRebalanceUpdates(
      latestTickets,
      ticket.assignee_id,
      dev,
      getDynamicRebalanceOptions(options)
    );

    if (updates.length > 0) {
      await Promise.all(
        updates.map((entry) => appClient.entities.Ticket.update(entry.id, entry.updates))
      );
    }
  };

  const handleCompleteInProgressReminder = async (ticket) => {
    if (!ticket?.id) return;

    const nowDecimal = roundHalf(Math.min(DAY_END, Math.max(DAY_START, currentTimeDecimal())));
    const nowTime = decimalToTime(nowDecimal);
    const todayStr = moment().format("YYYY-MM-DD");
    const segments = sortSegments(getAllTicketSegments(ticket));
    const lastSegment = segments[segments.length - 1] || null;
    const nextSegments = lastSegment?.date === todayStr && nowDecimal > lastSegment.start
      ? segments.map((segment, index) =>
          index === segments.length - 1
            ? { ...segment, end: Math.max(segment.end, nowDecimal) }
            : segment
        )
      : segments;
    const scheduleUpdates = schedulePayloadFromSegments(nextSegments);
    const auditEntry = {
      timestamp: new Date().toISOString(),
      user: user?.email || user?.full_name || "user",
      action: "status_change",
      details: `Status: in_progress → done (reminder, end: ${nowTime})`,
    };

    await appClient.entities.Ticket.update(ticket.id, {
      status: "done",
      ...(nextSegments.length > 0 ? scheduleUpdates : {}),
      audit_log: [...(ticket.audit_log || []), auditEntry],
    });

    await rebalanceAfterReminderAction(ticket, {
      preserveWorkingDaysFromToday: 0,
      preserveExistingSequence: true,
      includeTodayHoles: true,
      freezeCurrentWeekSegments: false,
      preserveTodaySegments: false,
      planningStartDate: todayStr,
      manualInsertionAnchor: {
        date: todayStr,
        start: nowDecimal,
      },
    });
    dismissInProgressReminder(ticket.id);
    await queryClient.invalidateQueries({ queryKey: ["tickets"] });
    toast({
      title: "Task chiusa",
      description: `${ticket.title} segnata come done.`,
    });
  };

  const handleExtendInProgressReminder = async (ticket) => {
    if (!ticket?.id) return;

    const todayStr = moment().format("YYYY-MM-DD");
    const segments = sortSegments(getAllTicketSegments(ticket));
    const targetIndex = segments.findLastIndex((segment) => String(segment.date || "") === todayStr);
    if (targetIndex < 0) {
      toast({
        variant: "destructive",
        title: "Estensione non disponibile",
        description: "Per task rimaste da giorni precedenti apri il ticket e verifica manualmente.",
      });
      return;
    }

    const targetSegment = segments[targetIndex];
    const nextEnd = roundHalf(Math.min(DAY_END, Math.max(targetSegment.end + 0.5, ceilHalf(currentTimeDecimal()))));
    if (nextEnd <= targetSegment.end) {
      toast({
        variant: "destructive",
        title: "Nessuno spazio utile",
        description: "La task e gia arrivata al termine della giornata lavorativa.",
      });
      return;
    }

    const nextSegments = segments.map((segment, index) =>
      index === targetIndex ? { ...segment, end: nextEnd } : segment
    );
    const scheduleUpdates = schedulePayloadFromSegments(nextSegments);
    const auditEntry = {
      timestamp: new Date().toISOString(),
      user: user?.email || user?.full_name || "user",
      action: "schedule_extended",
      details: `Task in progress estesa di 30 minuti fino alle ${decimalToTime(nextEnd)}`,
    };

    await appClient.entities.Ticket.update(ticket.id, {
      ...scheduleUpdates,
      audit_log: [...(ticket.audit_log || []), auditEntry],
    });

    await rebalanceAfterReminderAction(ticket, {
      freezeTicketIds: [ticket.id],
      preserveWorkingDaysFromToday: 0,
      preserveExistingSequence: true,
      planningStartDate: todayStr,
      manualInsertionAnchor: {
        date: todayStr,
        start: nextEnd,
      },
    });
    dismissInProgressReminder(ticket.id);
    await queryClient.invalidateQueries({ queryKey: ["tickets"] });
    toast({
      title: "Task estesa",
      description: `${ticket.title} estesa fino alle ${decimalToTime(nextEnd)}.`,
    });
  };

  const toggleClientFilter = (clientId) => {
    setSelectedClientIds((prev) => {
      const current = Array.isArray(prev) ? prev : [];
      return current.includes(clientId)
        ? current.filter((id) => id !== clientId)
        : [...current, clientId];
    });
  };

  // Hour labels for the time axis
  const hourLabels = [];
  for (let h = DAY_START; h <= DAY_END; h++) {
    hourLabels.push(h);
  }

  const isTimeVisible = currentTime >= DAY_VIEW_START && currentTime <= DAY_VIEW_END;
  const timeLinePercent = isCurrentWeek && isTimeVisible ? hourToPercent(currentTime) : null;
  const weekLabel = `${startOfWeek.format("DD MMM")} – ${startOfWeek.clone().add(4, "days").format("DD MMM")}`;
  const desktopTimelineHeight = "100%";

  const handleDownloadWeeklyTimesheet = () => {
    if (!activeDeveloper) return;

    const weekDates = days.map((day) => day.format("YYYY-MM-DD"));
    const weekDateSet = new Set(weekDates);
    const weekEnd = startOfWeek.clone().add(4, "days");
    const developerTickets = tickets.filter((ticket) => ticket.assignee_id === activeDeveloper.id);

    const rowsByClient = new Map();

    developerTickets.forEach((ticket) => {
      const segments = getTimesheetSegmentsForTicket(ticket);
      if (!segments || segments.length === 0) return;

      const byId = ticket?.client_id ? clientsById.get(ticket.client_id) : null;
      const byName = !byId && ticket?.client_name
        ? clientsByName.get(String(ticket.client_name).toLowerCase())
        : null;
      const resolvedClient = byId || byName || null;
      const clientName = ticket?.client_name || resolvedClient?.name || "Senza cliente";
      const commessa = String(resolvedClient?.commessa || "").trim();
      const rowKey = resolvedClient?.id || `client-${String(clientName).toLowerCase()}`;

      if (!rowsByClient.has(rowKey)) {
        rowsByClient.set(rowKey, {
          clientName,
          commessa,
          byDate: Object.fromEntries(weekDates.map((date) => [date, 0])),
          total: 0,
        });
      }

      const row = rowsByClient.get(rowKey);
      segments.forEach((segment) => {
        if (!weekDateSet.has(segment.date)) return;
        const duration = segmentDuration(segment);
        if (duration <= 0) return;
        row.byDate[segment.date] = roundHalf((row.byDate[segment.date] || 0) + duration);
        row.total = roundHalf((row.total || 0) + duration);
      });
    });

    const rows = [...rowsByClient.values()]
      .filter((row) => row.total > 0)
      .sort((a, b) =>
        b.total - a.total ||
        String(a.clientName || "").localeCompare(String(b.clientName || ""), "it", { sensitivity: "base" })
      );

    if (rows.length === 0) {
      toast({
        title: "Nessun dato da esportare",
        description: "Nella settimana selezionata non risultano ore pianificate per questo developer.",
      });
      return;
    }

    const weekRange = `${startOfWeek.format("YYYY-MM-DD")} -> ${weekEnd.format("YYYY-MM-DD")}`;
    const dayHeaders = days.map((day) => {
      const weekday = WEEKDAY_SHORT_IT[day.isoWeekday()] || day.format("ddd");
      return `${weekday} ${day.format("DD/MM")}`;
    });
    const totalsByDate = Object.fromEntries(weekDates.map((date) => [date, 0]));
    let grandTotal = 0;

    rows.forEach((row) => {
      weekDates.forEach((date) => {
        totalsByDate[date] = roundHalf((totalsByDate[date] || 0) + (row.byDate[date] || 0));
      });
      grandTotal = roundHalf(grandTotal + row.total);
    });

    const csvRows = [
      ["Settimana", weekRange],
      ["Developer", activeDeveloper.name || "Developer"],
      [],
      ["Cliente", "Commessa", ...dayHeaders, "Totale ore"],
      ...rows.map((row) => [
        row.clientName,
        row.commessa || "",
        ...weekDates.map((date) => hoursToCsv(row.byDate[date] || 0)),
        hoursToCsv(row.total),
      ]),
      [
        "TOTALE",
        "",
        ...weekDates.map((date) => hoursToCsv(totalsByDate[date] || 0)),
        hoursToCsv(grandTotal),
      ],
    ];

    const csvContent = csvRows
      .map((row) => row.map(csvEscape).join(";"))
      .join("\n");

    const safeDeveloperName = String(activeDeveloper.name || "developer")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "developer";
    const fileName = `timesheet-${safeDeveloperName}-${startOfWeek.format("YYYYMMDD")}-${weekEnd.format("YYYYMMDD")}.csv`;

    downloadCsv(fileName, csvContent);
    toast({
      title: "Timesheet esportato",
      description: `${rows.length} clienti inclusi per ${activeDeveloper.name}.`,
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden" data-tour="pipeline-page">
      <Card className="shrink-0 space-y-2 border-border/55 bg-card/90 p-3 sm:p-3.5" data-tour="pipeline-filters">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="space-y-0.5">
            <p className="app-kicker">Planning week</p>
            <p className="text-sm font-medium text-muted-foreground">Vista oraria 09:00 – 18:00</p>
          </div>
          <div className="flex w-full items-center gap-2 md:w-auto">
            <Button variant="outline" size="icon" className="h-8 w-8 shrink-0 rounded-full" onClick={() => setWeekOffset((w) => w - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant={isCurrentWeek ? "default" : "outline"}
              className={cn(
                "h-8 flex-1 rounded-full px-4 text-xs font-semibold md:flex-none",
                isCurrentWeek ? "bg-primary text-primary-foreground" : ""
              )}
              onClick={() => setWeekOffset(0)}
            >
              {isCurrentWeek ? "Questa settimana" : weekLabel}
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8 shrink-0 rounded-full" onClick={() => setWeekOffset((w) => w + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="grid items-center gap-2 xl:grid-cols-[minmax(0,1fr)_auto]">
          <div className="rounded-xl border border-border/60 bg-muted/35 p-2.5">
            <div className="grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
              <span className="px-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/90">
                Dev
              </span>
              <div className="flex max-h-[76px] flex-wrap gap-2 overflow-y-auto pr-1 xl:max-h-none">
                {selectableDevelopers.map((dev) => {
                  const selected = dev.id === activeDeveloperId;
                  return (
                    <FilterChip
                      key={dev.id}
                      selected={selected}
                      onClick={() => setActiveDeveloperId(dev.id)}
                      title={dev.name}
                      className="pr-2.5"
                    >
                      <Avatar className="h-[18px] w-[18px] border border-border/50">
                        <AvatarFallback className="bg-primary/15 text-[10px] font-semibold text-primary">
                          {dev.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="max-w-[96px] truncate xl:max-w-[112px]">{dev.name}</span>
                    </FilterChip>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="h-7 rounded-full px-3 text-xs font-semibold">
                  <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" />
                  Clienti {selectedClientList.length}/{clientFilterOptions.length || 0}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[300px] rounded-2xl border-border/70 bg-card/95 p-3 shadow-[var(--shadow-hover)]">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-foreground">Seleziona clienti</p>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="rounded-md px-2 py-1 text-[10px] font-semibold text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                      onClick={() => setSelectedClientIds(clientFilterOptions.map((client) => client.id))}
                    >
                      Tutti
                    </button>
                    <button
                      type="button"
                      className="rounded-md px-2 py-1 text-[10px] font-semibold text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                      onClick={() => setSelectedClientIds(clientFilterOptions.map((client) => client.id))}
                    >
                      Reset
                    </button>
                  </div>
                </div>

                <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
                  {clientFilterOptions.map((client) => {
                    const selected = selectedClientIdSet.has(client.id);
                    return (
                      <button
                        key={client.id}
                        type="button"
                        onClick={() => toggleClientFilter(client.id)}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors",
                          selected
                            ? "border-primary/35 bg-primary/10 text-foreground"
                            : "border-border/60 bg-card text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            className="inline-block h-2 w-2 rounded-full"
                            style={{ backgroundColor: client.color }}
                          />
                          <span className="truncate">{client.label}</span>
                        </span>
                        <span
                          className={cn(
                            "inline-flex h-4 w-4 items-center justify-center rounded border",
                            selected
                              ? "border-primary/35 bg-primary/20 text-primary"
                              : "border-border/70 bg-background text-transparent"
                          )}
                        >
                          <Check className="h-3 w-3" />
                        </span>
                      </button>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>

            <Button
              variant="outline"
              className="h-7 rounded-full px-3 text-xs font-medium"
              onClick={handleDownloadWeeklyTimesheet}
              disabled={!canDownloadTimesheet}
            >
              <FileDown className="mr-1.5 h-3.5 w-3.5" />
              Timesheet
            </Button>
          </div>
        </div>
      </Card>

      {inProgressReminders.length > 0 && (
        <Card className="shrink-0 border-amber-200 bg-amber-50/85 p-2.5 shadow-[var(--shadow-soft)] dark:border-amber-500/30 dark:bg-amber-500/10">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-200/80 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">
                <AlertTriangle className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-800 dark:text-amber-300">
                    Reminder operativo
                  </p>
                  <span className="rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:border-amber-500/35 dark:bg-amber-500/15 dark:text-amber-200">
                    {inProgressReminders.length}
                  </span>
                </div>
                <p className="truncate text-sm font-medium text-amber-950 dark:text-amber-100">
                  {inProgressReminders.length === 1
                    ? "C'e una task in corso da verificare."
                    : `Ci sono ${inProgressReminders.length} task in corso da verificare.`}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2 md:justify-end">
              {inProgressReminders[0] && (
                <Button asChild variant="outline" size="sm" className="h-7 rounded-full px-3 text-xs">
                  <Link to={buildTicketDetailUrl(inProgressReminders[0].ticket.id, activeDeveloperId)}>
                    Apri prima
                  </Link>
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-7 rounded-full px-3 text-xs"
                onClick={() => setShowInProgressReminderList((current) => !current)}
              >
                {showInProgressReminderList ? "Nascondi" : "Mostra"}
              </Button>
            </div>
          </div>

          {showInProgressReminderList && (
          <div className="mt-2 space-y-2 overflow-y-auto pr-1" style={{ maxHeight: "min(32vh, 260px)" }}>
            {inProgressReminders.map(({ ticket, info }) => {
              const { clientColor, clientName } = getTicketClientMeta(ticket);
              const assignee = developers.find((developer) => developer.id === ticket.assignee_id);

              return (
                <div
                  key={ticket.id}
                  className="flex flex-col gap-2 rounded-xl border border-amber-200/80 bg-card/95 p-2.5 shadow-[var(--shadow-soft)] lg:flex-row lg:items-center lg:justify-between dark:border-amber-500/25"
                  style={{ borderLeftWidth: 4, borderLeftColor: clientColor }}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:border-amber-500/35 dark:bg-amber-500/15 dark:text-amber-200">
                        {info.kind === "previous_day" ? "Da ieri" : "Timer scaduto"}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {info.plannedEndLabel}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-sm font-semibold text-foreground">{ticket.title}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{info.description}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1 font-medium">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: clientColor }} />
                        {clientName}
                      </span>
                      {assignee?.name && <span>{assignee.name}</span>}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                    <Button asChild variant="outline" size="sm" className="h-8 rounded-full px-3 text-xs">
                      <Link to={buildTicketDetailUrl(ticket.id, activeDeveloperId)}>Apri</Link>
                    </Button>
                    {info.canExtend && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-full px-3 text-xs"
                        onClick={() => handleExtendInProgressReminder(ticket)}
                      >
                        +30 min
                      </Button>
                    )}
                    <Button
                      size="sm"
                      className="h-8 rounded-full px-3 text-xs"
                      onClick={() => handleCompleteInProgressReminder(ticket)}
                    >
                      Segna done
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 rounded-full px-3 text-xs text-muted-foreground"
                      onClick={() => dismissInProgressReminder(ticket.id)}
                    >
                      Ignora
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          )}
        </Card>
      )}

      {/* Mobile agenda */}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 lg:hidden">
        {visibleDevelopers.map((dev) => {
          const devTickets = filteredTickets.filter((ticket) => ticket.assignee_id === dev.id);
          const schedule = buildTimeSchedule(devTickets, days, dev);
          const dailyCap = dev.daily_capacity || 8;
          const unavailableByDate = getDeveloperUnavailableSlotsByDate(dev, {
            dates: days.map((day) => day.format("YYYY-MM-DD")),
          });

          return (
            <Card key={dev.id} className="border-border/65 bg-card/95 shadow-[var(--shadow-soft)]">
              <div className="flex items-center justify-between gap-2.5 border-b border-border/70 p-4">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Avatar className="h-9 w-9 shrink-0 border border-border/60">
                    <AvatarFallback className="bg-primary/15 text-xs font-semibold text-primary">
                      {dev.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{dev.name}</p>
                    <p className="text-xs text-muted-foreground">{dailyCap}h/day</p>
                  </div>
                </div>
              </div>

              <div className="space-y-3 p-4">
                {days.map((day) => {
                  const dateStr = day.format("YYYY-MM-DD");
                  const dayTickets = [...(schedule[dateStr] || [])].sort((a, b) => a.startHour - b.startHour);
                  const dayUnavailable = unavailableByDate[dateStr] || [];
                  const blockedH = roundHalf(dayUnavailable.reduce((sum, slot) => sum + (slot.end - slot.start), 0));
                  const ticketHours = roundHalf(dayTickets.reduce((sum, item) => sum + (item.endHour - item.startHour), 0));
                  const occupiedH = roundHalf(ticketHours + blockedH);
                  const freeH = roundHalf(Math.max(0, dailyCap - occupiedH));
                  const isToday = day.isSame(today, "day");
                  const isPast = day.isBefore(today, "day");
                  const isAbsence = isDeveloperFullyUnavailableDay(dev, dateStr);
                  const isOverbooked = occupiedH > dailyCap;

                  return (
                    <div
                      key={`${dev.id}-${dateStr}`}
                      className={`rounded-xl border p-3 ${isToday ? "border-primary/35 bg-primary/10" : "border-border/70 bg-card/95"} ${isPast ? "opacity-90" : ""}`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div>
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{day.format("ddd")}</p>
                          <p className="text-sm font-semibold text-foreground">{day.format("D MMM")}</p>
                        </div>
                        <div className="text-right">
                          {isAbsence ? (
                            <p className="text-xs font-semibold text-orange-500">OFF</p>
                          ) : occupiedH > 0 ? (
                            <>
                              <p className={`text-xs font-semibold ${isOverbooked ? "text-red-500" : "text-foreground"}`}>{occupiedH}h</p>
                              <p className="text-[10px] text-muted-foreground">{freeH > 0 ? `${freeH}h free` : "FULL"}</p>
                            </>
                          ) : (
                            <>
                              <p className="text-xs font-semibold text-muted-foreground">0h</p>
                              <p className="text-[10px] text-muted-foreground">{dailyCap}h free</p>
                            </>
                          )}
                        </div>
                      </div>

                      {isAbsence ? (
                        <p className="text-xs text-orange-400">Developer assente.</p>
                      ) : dayTickets.length === 0 && dayUnavailable.length === 0 ? (
                        <p className="text-xs text-muted-foreground">Nessuna task pianificata.</p>
                      ) : (
                        <div className="space-y-2">
                          {dayUnavailable.map((slot) => {
                            const slotType = normalizeUnavailableType(slot.type);
                            const meta = UNAVAILABLE_TYPE_META[slotType];
                            return (
                              <div
                                key={`unavailable-${slot.id}`}
                                className={`rounded-xl border bg-card p-3 shadow-[var(--shadow-soft)] ${meta.blockClass}`}
                                style={{ borderLeftWidth: 4 }}
                              >
                                <div className="flex items-center justify-between gap-2 mb-1">
                                  <span className={`text-[9px] px-1.5 py-0.5 rounded-md border font-semibold ${meta.badgeClass}`}>
                                    {meta.label}
                                  </span>
                                  <span className="text-[10px] font-semibold text-muted-foreground tabular-nums">
                                    {slot.start_time}-{slot.end_time}
                                  </span>
                                </div>
                                <p className="text-[11px] font-semibold leading-tight text-foreground">
                                  {slot.label || "Slot non pianificabile"}
                                </p>
                              </div>
                            );
                          })}
                          {dayTickets.map(({ ticket, startHour, endHour, isContinuation }, idx) => {
                            const status = STATUS_CONFIG[getTicketWorkflowStatus(ticket)] || STATUS_CONFIG.new;
                            const durationH = roundHalf(endHour - startHour);
                            const { clientColor, clientName } = getTicketClientMeta(ticket);

                            return (
                              <Link
                                key={`${ticket.id}-${dateStr}-${isContinuation ? "cont" : "main"}-${idx}`}
                                to={buildTicketDetailUrl(ticket.id, activeDeveloperId)}
                                className="app-hover-lift block rounded-xl border border-border/70 bg-card p-3"
                                style={{ borderLeftWidth: 4, borderLeftColor: clientColor }}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <p className="text-xs font-semibold text-foreground line-clamp-2">{ticket.title}</p>
                                  <span className={`text-[9px] px-1.5 py-0.5 rounded-md border font-semibold whitespace-nowrap ${status.color}`}>
                                    {status.label}
                                  </span>
                                </div>
                                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                                  <span className="inline-flex items-center gap-1 font-medium">
                                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: clientColor }} />
                                    {clientName}
                                    {isContinuation ? " · cont." : ""}
                                  </span>
                                  <span className="inline-flex items-center gap-1 tabular-nums">
                                    <Clock className="w-2.5 h-2.5" />
                                    {decimalToTime(startHour)}-{decimalToTime(endHour)}
                                  </span>
                                  <span className="font-medium">{durationH}h</span>
                                </div>
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })}

        {activeDevs.length === 0 && (
          <Card className="border-border/70 bg-card/95">
            <div className="py-12 text-center text-muted-foreground">Nessun developer attivo</div>
          </Card>
        )}
        {activeDevs.length > 0 && visibleDevelopers.length === 0 && (
          <Card className="border-border/70 bg-card/95">
            <div className="py-12 text-center text-muted-foreground">
              {isDeveloperLikeRole(user?.role) && !loggedDeveloper
                ? "Il tuo utente non e associato a un profilo developer attivo."
                : "Seleziona un developer per vedere la pipeline."}
            </div>
          </Card>
        )}
      </div>

      {/* Desktop timeline */}
      <div className="hidden min-h-0 flex-1 overflow-hidden lg:flex lg:flex-col lg:space-y-2" data-tour="pipeline-grid">
        <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden pb-1">
          <div
            className="flex h-full min-h-0 flex-col gap-2"
            style={{ minWidth: `${DESKTOP_GRID_MIN_WIDTH}px` }}
          >
            {/* Day headers */}
            <div className="grid shrink-0 gap-1.5" style={{ gridTemplateColumns: DESKTOP_GRID_TEMPLATE }}>
              <div />
              <div />
              {days.map((day, i) => {
                const isToday = day.isSame(today, "day");
                const isPast = day.isBefore(today, "day");
                return (
                  <div
                    key={i}
                    className={`rounded-xl border px-2 py-1.5 text-center ${
                      isToday
                        ? "border-primary/35 bg-primary/10 text-foreground shadow-[var(--shadow-soft)]"
                        : isPast
                          ? "border-border/70 bg-muted/35 text-muted-foreground"
                          : "border-border/70 bg-muted/45 text-foreground"
                    }`}
                  >
                    <div className="flex items-baseline justify-center gap-1.5">
                      <p className="text-[8px] font-semibold uppercase tracking-wide text-muted-foreground">{day.format("ddd")}</p>
                      <p className="text-sm font-semibold leading-tight">{day.format("D MMM")}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Dev rows */}
            <div className="min-h-0 flex flex-1 flex-col overflow-y-auto pr-1">
              {visibleDevelopers.map((dev) => {
            const devTickets = filteredTickets.filter((ticket) => ticket.assignee_id === dev.id);
            const schedule = buildTimeSchedule(devTickets, days, dev);
            const unavailableByDate = getDeveloperUnavailableSlotsByDate(dev, {
              dates: days.map((day) => day.format("YYYY-MM-DD")),
            });

            return (
              <div key={dev.id} className="flex min-h-[560px] flex-1 flex-col overflow-hidden rounded-2xl border border-border/70 bg-card/95 shadow-[var(--shadow-soft)] xl:min-h-[600px]">
                {/* Dev header */}
                <div className="grid shrink-0 items-center border-b border-border/70" style={{ gridTemplateColumns: DESKTOP_GRID_TEMPLATE }}>
                  <div className="flex items-center justify-between gap-2 p-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar className="h-8 w-8 shrink-0 border border-border/60">
                        <AvatarFallback className="bg-primary/15 text-xs font-semibold text-primary">
                          {dev.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">{dev.name}</p>
                        <p className="text-[10px] text-muted-foreground">{dev.daily_capacity || 8}h/day</p>
                      </div>
                    </div>
                  </div>
                  <div />
                  {days.map((day, i) => {
                    const dateStr = day.format("YYYY-MM-DD");
                    const dayTickets = schedule[dateStr] || [];
                    const dayUnavailable = unavailableByDate[dateStr] || [];
                    const blockedH = roundHalf(dayUnavailable.reduce((sum, slot) => sum + (slot.end - slot.start), 0));
                    const ticketHours = roundHalf(dayTickets.reduce((s, t) => s + (t.endHour - t.startHour), 0));
                    const occupiedH = roundHalf(ticketHours + blockedH);
                    const dailyCap = dev.daily_capacity || 8;
                    const freeH = roundHalf(Math.max(0, dailyCap - occupiedH));
                    const isToday = day.isSame(today, "day");
                    const isPast = day.isBefore(today, "day");
                    const isAbsence = isDeveloperFullyUnavailableDay(dev, dateStr);
                    const isOverbooked = occupiedH > dailyCap;
                    return (
                      <div
                        key={i}
                        className={`border-l border-border/70 px-1 py-0.5 text-center text-[9px] font-medium ${isToday ? "bg-primary/10" : isPast ? "bg-muted/35" : ""}`}
                      >
                        {isAbsence ? (
                          <span className="text-orange-400">OFF</span>
                        ) : occupiedH > 0 ? (
                          <div>
                            <div className={isOverbooked ? "text-red-500 font-bold" : "text-foreground"}>{occupiedH}h</div>
                            <div className="text-muted-foreground text-[8px]">{freeH > 0 ? `+${freeH}h` : "FULL"}</div>
                          </div>
                        ) : (
                          <div>
                            <div className="text-muted-foreground">—</div>
                            <div className="text-muted-foreground text-[8px]">{dailyCap}h free</div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Timeline grid */}
                <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: DESKTOP_GRID_TEMPLATE }}>
                  {/* Dev name spacer */}
                  <div className="border-r border-border/70" />

                  {/* Hour axis */}
                  <div className="relative border-r border-border/70" style={{ height: desktopTimelineHeight }}>
                    {hourLabels.map((h) => (
                      <div
                        key={h}
                        className="absolute w-full text-right pr-1.5"
                        style={{ top: `${hourToPercent(h)}%`, transform: "translateY(-50%)" }}
                      >
                        <span className="text-[9px] text-muted-foreground font-medium">{h}:00</span>
                      </div>
                    ))}
                  </div>

                  {/* Day columns */}
                  {days.map((day, i) => {
                    const dateStr = day.format("YYYY-MM-DD");
                    const dayTickets = schedule[dateStr] || [];
                    const dayUnavailable = unavailableByDate[dateStr] || [];
                    const overlapLayout = computeTimelineOverlapLayout([
                      ...dayUnavailable.map((slot, idx) => ({
                        key: `slot-${slot.id}-${idx}`,
                        start: Number(slot.start),
                        end: Number(slot.end),
                        layoutKind: "block",
                      })),
                      ...dayTickets.map(({ ticket, startHour, endHour, isContinuation }, idx) => ({
                        key: `${ticket.id}-${dateStr}-${isContinuation ? "cont" : "main"}-${idx}`,
                        start: Number(startHour),
                        end: Number(endHour),
                        layoutKind: isTicketClosed(ticket) ? "closed" : "active",
                      })),
                    ]);
                    const isToday = day.isSame(today, "day");
                    const isPast = day.isBefore(today, "day");
                    const isAbsence = isDeveloperFullyUnavailableDay(dev, dateStr);

                    return (
                      <div
                        key={i}
                        className={`relative border-l border-border/70 ${isToday ? "bg-primary/10" : isPast ? "bg-muted/30" : ""} ${isAbsence ? "bg-orange-100/20 dark:bg-orange-900/20" : ""}`}
                        style={{ height: desktopTimelineHeight }}
                      >
                        {/* Hour grid lines */}
                        {hourLabels.map((h) => (
                          <div key={h} className="absolute w-full border-t border-border/60" style={{ top: `${hourToPercent(h)}%` }} />
                        ))}

                        {/* Current time line (today only) */}
                        {isToday && timeLinePercent !== null && (
                          <div className="absolute w-full z-[45] pointer-events-none" style={{ top: `${timeLinePercent}%` }}>
                            <div className="relative">
                              <div className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-red-500" />
                              <div className="w-full border-t-2 border-red-400" />
                            </div>
                          </div>
                        )}

                        {dayUnavailable.map((slot, idx) => (
                          <UnavailableBlock
                            key={`slot-${slot.id}-${idx}`}
                            slot={slot}
                            overlap={overlapLayout[`slot-${slot.id}-${idx}`]}
                          />
                        ))}

                        {/* Ticket blocks */}
                        {dayTickets.map(({ ticket, startHour, endHour, isContinuation }, idx) => {
                          const { clientColor, clientName } = getTicketClientMeta(ticket);
                          const overlapKey = `${ticket.id}-${dateStr}-${isContinuation ? "cont" : "main"}-${idx}`;
                          return (
                            <TicketBlock
                              key={overlapKey}
                              ticket={ticket}
                              startHour={startHour}
                              endHour={endHour}
                              dateStr={dateStr}
                              isContinuation={isContinuation}
                              clientColor={clientColor}
                              clientName={clientName}
                              viewDeveloperId={activeDeveloperId}
                              overlap={overlapLayout[overlapKey]}
                            />
                          );
                        })}

                        {isAbsence && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-[10px] text-orange-400 font-medium rotate-0">Assente</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
              })}

              {activeDevs.length === 0 && (
                <Card className="border-border/70 bg-card/95">
                  <div className="py-12 text-center text-muted-foreground">Nessun developer attivo</div>
                </Card>
              )}
              {activeDevs.length > 0 && visibleDevelopers.length === 0 && (
                <Card className="border-border/70 bg-card/95">
                  <div className="py-12 text-center text-muted-foreground">
                    {isDeveloperLikeRole(user?.role) && !loggedDeveloper
                      ? "Il tuo utente non e associato a un profilo developer attivo."
                      : "Seleziona un developer per vedere la pipeline."}
                  </div>
                </Card>
              )}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}

function UnavailableBlock({ slot, overlap }) {
  const topPercent = hourToPercent(slot.start);
  const heightPercent = ((slot.end - slot.start) / DAY_VIEW_HOURS) * 100;
  const durationH = roundHalf(slot.end - slot.start);
  const density = getTimelineCardDensity(durationH);
  const isMicro = density === "micro";
  const isCompact = density === "compact";
  const verticalInsetPx = isMicro ? 0 : 2;
  const type = normalizeUnavailableType(slot.type);
  const meta = UNAVAILABLE_TYPE_META[type];
  const blockLabel = slot.label || "Slot non pianificabile";
  const blockRange = `${slot.start_time}-${slot.end_time}`;
  const tooltip = `${meta.label} • ${blockLabel} • ${blockRange}`;
  const columnCount = Math.max(1, Number(overlap?.columnCount) || 1);
  const columnIndex = Math.max(0, Number(overlap?.columnIndex) || 0);
  const columnWidth = 100 / columnCount;
  const horizontalInsetPx = columnCount > 1 ? 2 : 6;

  return (
    <div
      className={`absolute z-40 overflow-hidden rounded-xl border border-border/70 bg-card/95 shadow-[var(--shadow-soft)] transition-[box-shadow,transform] pointer-events-none ${meta.blockClass}`}
      style={{
        top: `calc(${topPercent}% + ${verticalInsetPx}px)`,
        height: `calc(${Math.max(heightPercent, 3)}% - ${verticalInsetPx * 2}px)`,
        left: `calc(${columnWidth * columnIndex}% + ${horizontalInsetPx}px)`,
        width: `calc(${columnWidth}% - ${horizontalInsetPx * 2}px)`,
        minHeight: isMicro ? "20px" : isCompact ? "38px" : "54px",
        borderLeftWidth: "4px",
      }}
      title={tooltip}
    >
      {isMicro ? (
        <div className="h-full px-2 flex items-center gap-1.5 leading-none">
          <span className={`text-[8px] px-1.5 py-0.5 rounded-md border font-semibold uppercase tracking-wide ${meta.badgeClass}`}>
            Stop
          </span>
          <p className="text-[10px] font-medium truncate flex-1 text-foreground">{blockLabel}</p>
          <span className="text-[9px] font-medium text-muted-foreground tabular-nums">{blockRange}</span>
        </div>
      ) : isCompact ? (
        <div className="px-2 py-1.5 h-full flex flex-col justify-between gap-1">
          <div className="flex items-center justify-between gap-1.5">
            <span className={`text-[8px] px-1.5 py-0.5 rounded-md border font-semibold uppercase tracking-wide ${meta.badgeClass}`}>
              {meta.label}
            </span>
            <span className="text-[9px] font-medium text-muted-foreground tabular-nums">{blockRange}</span>
          </div>
          <p className="text-[10px] font-semibold leading-tight truncate text-foreground">{blockLabel}</p>
        </div>
      ) : (
        <div className="px-2 py-1.5 h-full flex flex-col justify-between gap-1">
          <div>
            <div className="flex items-center justify-between gap-1.5 mb-0.5">
              <span className={`text-[8px] px-1.5 py-0.5 rounded-md border font-semibold ${meta.badgeClass}`}>
                {meta.label}
              </span>
              <span className="text-[9px] font-medium text-muted-foreground tabular-nums">{blockRange}</span>
            </div>
            <p className="text-[11px] font-semibold leading-tight line-clamp-2 text-foreground">
              {blockLabel}
            </p>
          </div>
          <span className="inline-flex items-center gap-1 text-[9px] text-muted-foreground font-medium">
            <Clock className="w-2.5 h-2.5" />
            Slot non pianificabile
          </span>
        </div>
      )}
    </div>
  );
}

function TicketBlock({
  ticket,
  startHour,
  endHour,
  dateStr,
  isContinuation,
  clientColor = DEFAULT_CLIENT_COLOR,
  clientName = "No client",
  viewDeveloperId = "",
  overlap,
}) {
  const normalizedStatus = getTicketWorkflowStatus(ticket);
  const status = STATUS_CONFIG[normalizedStatus] || STATUS_CONFIG.new;
  const isDeadlineSoon = ticket.deadline && moment(ticket.deadline).diff(moment(), "days") <= 2;
  const isDeadlinePast = ticket.deadline && moment(ticket.deadline).isBefore(moment());
  const isUrgent = Boolean(ticket.urgent_requested_at);
  const isDone = isTicketClosed(ticket);
  const isPast = moment(dateStr).isBefore(moment(), "day");

  const topPercent = hourToPercent(startHour);
  const heightPercent = ((endHour - startHour) / DAY_VIEW_HOURS) * 100;
  const durationH = roundHalf(endHour - startHour);
  const density = getTimelineCardDensity(durationH);
  const isMicro = density === "micro";
  const isCompact = density === "compact";
  const verticalInsetPx = isMicro ? 0 : 2;
  const ticketRange = `${decimalToTime(startHour)}–${decimalToTime(endHour)}`;
  const ticketTooltip = `${ticket.title} • ${clientName}${isContinuation ? " • continuazione" : ""} • ${ticketRange} (${durationH}h)`;
  const statusCompactByState = {
    new: "New",
    in_progress: "In corso",
    qa_review: "QA",
    done: "Done",
    reported: "Report",
  };
  const statusCompactLabel = statusCompactByState[normalizedStatus] || status.label;
  const statusAccentByState = {
    new: "bg-slate-500",
    in_progress: "bg-violet-500",
    qa_review: "bg-cyan-500",
    done: "bg-emerald-500",
    reported: "bg-indigo-500",
  };
  const statusAccentClass = statusAccentByState[normalizedStatus] || statusAccentByState.new;
  const cardSurfaceClass = isDone
    ? "bg-emerald-50/70 dark:bg-emerald-950/30"
    : "bg-card/95 dark:bg-slate-900/95";
  const columnCount = Math.max(1, Number(overlap?.columnCount) || 1);
  const columnIndex = Math.max(0, Number(overlap?.columnIndex) || 0);
  const columnWidth = 100 / columnCount;
  const horizontalInsetPx = columnCount > 1 ? 2 : 6;

  return (
    <div
      className={`group absolute z-10 overflow-hidden rounded-xl border border-border/75 backdrop-blur-[1px] shadow-[var(--shadow-soft)] transition-[box-shadow,transform,border-color,opacity] hover:-translate-y-[1px] hover:shadow-[var(--shadow-hover)] ${cardSurfaceClass} ${isDone || isPast ? "opacity-80" : ""}`}
      style={{
        top: `calc(${topPercent}% + ${verticalInsetPx}px)`,
        height: `calc(${Math.max(heightPercent, 3)}% - ${verticalInsetPx * 2}px)`,
        left: `calc(${columnWidth * columnIndex}% + ${horizontalInsetPx}px)`,
        width: `calc(${columnWidth}% - ${horizontalInsetPx * 2}px)`,
        minHeight: isMicro ? "20px" : isCompact ? "40px" : "58px",
        borderLeftWidth: "4px",
        borderLeftColor: clientColor,
      }}
      title={ticketTooltip}
    >
      <Link to={buildTicketDetailUrl(ticket.id, viewDeveloperId)} className="relative block h-full">
        <span className={`absolute left-0 top-0 h-[2px] w-full ${statusAccentClass} opacity-70`} />
        {isMicro ? (
          <div className="h-full px-2 py-1 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: clientColor }} />
            <span className="text-[8px] font-semibold uppercase tracking-wide text-muted-foreground max-w-[40%] truncate">
              {clientName}
            </span>
            {isUrgent && (
              <span className="rounded border border-amber-300 bg-amber-100 px-1 py-0.5 text-[7px] font-bold uppercase tracking-wide text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/20 dark:text-amber-200">
                Urg
              </span>
            )}
            <p className="text-[10px] font-semibold text-foreground truncate flex-1 leading-none">
              {ticket.title}
            </p>
            <span className={`text-[7px] px-1 py-0.5 rounded-md border font-semibold uppercase tracking-wide max-w-[64px] truncate ${status.color}`}>
              {statusCompactLabel}
            </span>
          </div>
        ) : isCompact ? (
          <div className="px-2 py-1 h-full flex flex-col justify-center gap-0.5">
            <div className="flex items-center justify-between gap-1 min-w-0">
              <span className="text-[8px] font-semibold uppercase tracking-wide truncate text-muted-foreground inline-flex items-center gap-1 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: clientColor }} />
                <span className="truncate">{clientName}</span>
                {isContinuation && (
                  <span className="text-[7px] text-muted-foreground/80 font-bold">cont.</span>
                )}
              </span>
              <div className="flex items-center gap-1 shrink-0">
                {isDeadlinePast && <AlertTriangle className="w-2 h-2 text-red-500" />}
                {isDeadlineSoon && !isDeadlinePast && <AlertTriangle className="w-2 h-2 text-amber-500" />}
                {isUrgent && (
                  <span className="text-[7px] px-1.5 py-0.5 rounded-md border border-amber-300 bg-amber-100 font-semibold uppercase tracking-wide text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/20 dark:text-amber-200">
                    Urgente
                  </span>
                )}
                <span className={`text-[7px] px-1.5 py-0.5 rounded-md border font-semibold uppercase tracking-wide max-w-[74px] truncate ${status.color}`}>
                  {statusCompactLabel}
                </span>
              </div>
            </div>
            <p className="text-[10px] font-semibold text-foreground leading-tight truncate">
              {ticket.title}
            </p>
          </div>
        ) : (
          <div className="px-2 py-1.5 h-full flex flex-col justify-between gap-1">
            <div className="flex items-center justify-between gap-1 min-w-0">
              <span className="text-[8px] font-semibold uppercase tracking-wide truncate text-muted-foreground inline-flex items-center gap-1 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: clientColor }} />
                <span className="truncate">{clientName}</span>
                {isContinuation && (
                  <span className="text-[7px] text-muted-foreground/80 font-bold">cont.</span>
                )}
              </span>
              <div className="flex items-center gap-1 shrink-0">
                {isUrgent && (
                  <span className="text-[7px] px-1.5 py-0.5 rounded-md border border-amber-300 bg-amber-100 font-semibold uppercase tracking-wide text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/20 dark:text-amber-200">
                    Urgente
                  </span>
                )}
                <span className={`text-[7px] px-1.5 py-0.5 rounded-md border font-semibold uppercase tracking-wide max-w-[74px] truncate ${status.color}`}>
                  {statusCompactLabel}
                </span>
                {isDeadlinePast && <AlertTriangle className="w-2 h-2 text-red-500" />}
                {isDeadlineSoon && !isDeadlinePast && <AlertTriangle className="w-2 h-2 text-amber-500" />}
              </div>
            </div>
            <p className="text-[11px] font-semibold text-foreground leading-tight line-clamp-2">{ticket.title}</p>
            <div className="flex items-center justify-between gap-1.5 text-[9px] text-muted-foreground">
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Clock className="w-2.5 h-2.5" />
                {ticketRange}
              </span>
              <span className="font-medium">{durationH}h</span>
            </div>
          </div>
        )}
      </Link>
    </div>
  );
}
