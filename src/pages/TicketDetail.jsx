import React, { useEffect, useMemo, useRef, useState } from "react";
import { appClient } from "@/api/appClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, Bell, Clock, ExternalLink, Plus, Send, Loader2, AlertTriangle, Trash2, Pencil, X } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { createPageUrl, getHomePageForRole, normalizeAppRole } from "@/utils";
import { toast } from "@/components/ui/use-toast";
import {
  STATUS_CONFIG,
  DIFFICULTY_CONFIG,
  TYPE_CONFIG,
  getPriorityLevel,
  suggestAssignment,
  calculatePriorityScore,
  DEFAULT_CONFIG,
  getActualEffortHours,
  getEffectivePriorityScore,
  getPlannedEffortHours,
  getRemainingEffortHours,
  getTicketWorkflowStatus,
  getWorkedEffortHours,
  isPriorityPaused,
  isClosedStatus,
  isSchedulableTicket,
  isTicketBlocked,
  isTicketClosed,
  normalizeTicketStatus,
} from "../components/shared/priorityUtils";
import {
  buildWeeklyRebalanceUpdates,
  checkScheduleConflict,
  findOptimalSchedule,
  getDynamicRebalanceOptions,
  getDeveloperUnavailableIntervalsByDate,
} from "./DevPipeline";
import { useCurrentUser } from "../components/shared/useCurrentUser";
import TimeScheduleCard from "../components/tickets/TimeScheduleCard";
import { buildReferenceLinksPayload, getReferenceLinkLabel, normalizeReferenceLinks } from "../components/shared/ticketReferenceLinks";
import {
  createNotification,
  normalizeTicketWatchers,
  notifyClientTicketUpdate,
  notifyLiveOpsCompleted,
  notifyQaReviewApproved,
  notifyQaReviewRejected,
  notifyTicketAssigned,
  notifyTicketComment,
  notifyTicketDone,
  notifyTicketMissingData,
  notifyWatcherAdded,
} from "@/lib/notificationService";
import moment from "moment";
import MarkdownContent from "../components/shared/MarkdownContent";
import MarkdownEditor from "../components/shared/MarkdownEditor";

const DAY_START = 9;
const DAY_END = 18;
const LUNCH_START = 13;
const LUNCH_END = 14;
const REPORT_OUTCOME_OPTIONS = [
  { value: "winner", label: "Winner" },
  { value: "loser", label: "Loser" },
  { value: "not_significant", label: "Not Significant" },
];
const QA_REVIEW_EFFORT_HOURS = 0.5;
const QA_FIX_EFFORT_HOURS = 0.5;
const QA_SYSTEM_PRIORITY = 180;
const POST_PREVIEW_CHANGE_EFFORT_HOURS = 0.5;
const POST_PREVIEW_SYSTEM_PRIORITY = 190;
const LIVE_OPS_EFFORT_HOURS = 0.5;
const LIVE_SYSTEM_PRIORITY = 170;
const LIVE_OPERATION_LABELS = {
  launch: "Messa live",
  stop: "Spegnimento",
  change: "Modifica live",
};
const LIVE_OPERATION_REQUESTED_STATE = {
  launch: "launch_requested",
  stop: "stop_requested",
  change: "change_requested",
};
const LIVE_OPERATION_COMPLETED_STATE = {
  launch: "live",
  stop: "stopped",
  change: "live",
};
const LIVE_STATE_LABELS = {
  not_live: "Non live",
  launch_requested: "Messa live richiesta",
  live: "Live",
  change_requested: "Modifica live richiesta",
  stop_requested: "Spegnimento richiesto",
  stopped: "Spento",
};
const LIVE_CONFIRMATION_STATUS_LABELS = {
  not_confirmed: "Non confermato",
  pending: "In attesa conferma",
  confirmed: "Confermato",
};
const LIVE_CONFIRMATION_STATUS_BADGE_CLASSES = {
  not_confirmed:
    "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-200",
  pending:
    "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  confirmed:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
};
const LIVE_OPS_PENDING_BADGE_CLASS =
  "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300";
const LIVE_OPS_CONFIRMED_BADGE_CLASS =
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300";

function normalizeQaPreviewEntries(previewEntries = [], fallbackUrls = [], fallbackLink = "") {
  const rawEntries = Array.isArray(previewEntries) ? previewEntries : [previewEntries];
  const rawFallbackUrls = Array.isArray(fallbackUrls) ? fallbackUrls : [fallbackUrls];
  const candidates = [
    ...rawEntries.map((entry) =>
      typeof entry === "object" && entry !== null
        ? {
            title: String(entry.title || entry.label || "").trim(),
            url: String(entry.url || entry.link || "").trim(),
          }
        : { title: "", url: String(entry || "").trim() }
    ),
    ...rawFallbackUrls.map((url) => ({ title: "", url: String(url || "").trim() })),
    { title: "", url: String(fallbackLink || "").trim() },
  ].filter((entry) => entry.url);

  const byUrl = new Map();
  candidates.forEach((entry) => {
    const existing = byUrl.get(entry.url);
    if (!existing || (!existing.title && entry.title)) {
      byUrl.set(entry.url, entry);
    }
  });

  return [...byUrl.values()].map((entry, index) => ({
    title: entry.title || `Preview ${index + 1}`,
    url: entry.url,
  }));
}

function resolveQaPreviewEntries(...tickets) {
  for (const currentTicket of tickets) {
    const entries = normalizeQaPreviewEntries(
      currentTicket?.qa_preview_links,
      currentTicket?.qa_preview_urls,
      currentTicket?.qa_preview_url
    );
    if (entries.length > 0) return entries;
  }
  return [];
}

function buildQaPreviewPayload(previewEntries = [], fallbackUrls = [], fallbackLink = "") {
  const normalizedEntries = normalizeQaPreviewEntries(
    previewEntries,
    fallbackUrls,
    fallbackLink
  );
  const normalizedUrls = normalizedEntries.map((entry) => entry.url);
  return {
    qa_preview_links: normalizedEntries,
    qa_preview_urls: normalizedUrls,
    qa_preview_url: normalizedUrls[0] || "",
  };
}

function extractMentionedUserTokens(text = "") {
  const values = [];
  const regex = /\]\(mention:([^)]+)\)/g;
  let match;

  while ((match = regex.exec(String(text || ""))) !== null) {
    const value = String(match[1] || "").trim();
    if (value) values.push(value);
  }

  return [...new Set(values)];
}

const TICKET_BACK_SOURCE_MAP = {
  dashboard: { label: "Torna ai miei ticket", page: "MyTickets" },
  dev_pipeline: { label: "Torna alla pipeline dev", page: "DevPipeline" },
  my_tickets: { label: "Torna ai miei ticket", page: "MyTickets" },
  notifications: { label: "Torna alle notifiche", page: "Notifications" },
  reported_tests: { label: "Torna ai test riportati", page: "ReportedTests" },
  clients: { label: "Torna ai clienti", page: "Clients" },
  analysts: { label: "Torna agli analyst", page: "Analysts" },
  developers: { label: "Torna ai developer", page: "Developers" },
  availability: { label: "Torna alla disponibilita", page: "Availability" },
  settings: { label: "Torna alle impostazioni", page: "Settings" },
  create_ticket: { label: "Torna al nuovo ticket", page: "CreateTicket" },
  ticket_report: { label: "Torna al report test", page: "TicketReport" },
};

function normalizeBackSource(source) {
  const raw = String(source || "").trim();
  if (!raw) return "";

  const aliases = {
    Dashboard: "dashboard",
    DevPipeline: "dev_pipeline",
    MyTickets: "my_tickets",
    Notifications: "notifications",
    ReportedTests: "reported_tests",
    Clients: "clients",
    Analysts: "analysts",
    Developers: "developers",
    Availability: "availability",
    Settings: "settings",
    CreateTicket: "create_ticket",
    TicketReport: "ticket_report",
  };

  return aliases[raw] || raw.toLowerCase();
}

function withQueryParam(url, key, value) {
  if (!value) return url;
  const [path, query = ""] = String(url || "").split("?");
  const params = new URLSearchParams(query);
  params.set(key, value);
  return `${path}?${params.toString()}`;
}

function resolveTicketBackContext({ fromPage, storedPage, storedPath, role, ticketId, pipelineDeveloperId }) {
  const explicitSource = normalizeBackSource(fromPage);
  const storedSource = normalizeBackSource(storedPage);
  const defaultPage = getHomePageForRole(role);
  const defaultSource = normalizeBackSource(defaultPage);

  if (explicitSource && TICKET_BACK_SOURCE_MAP[explicitSource]) {
    const entry = TICKET_BACK_SOURCE_MAP[explicitSource];
    let url =
      storedSource === explicitSource && storedPath
        ? storedPath
        : entry.page === "TicketReport"
          ? `${createPageUrl("TicketReport")}?id=${ticketId}`
          : createPageUrl(entry.page);
    if (explicitSource === "dev_pipeline" && pipelineDeveloperId) {
      url = withQueryParam(url, "dev", pipelineDeveloperId);
    }
    return { url, label: entry.label };
  }

  if (storedSource && storedPath) {
    const entry = TICKET_BACK_SOURCE_MAP[storedSource];
    if (entry) {
      return {
        url: storedPath,
        label: entry.label,
      };
    }
  }

  const fallbackEntry = TICKET_BACK_SOURCE_MAP[defaultSource] || TICKET_BACK_SOURCE_MAP.my_tickets;
  return {
    url: createPageUrl(fallbackEntry.page),
    label: fallbackEntry.label,
  };
}

function roundHalf(value) {
  return Math.round(value * 2) / 2;
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function buildWatcherFromUser(sourceUser = {}) {
  return {
    id: String(sourceUser?.id || "").trim(),
    email: String(sourceUser?.email || "").trim(),
    name: String(sourceUser?.full_name || sourceUser?.name || sourceUser?.email || "").trim(),
    added_at: new Date().toISOString(),
  };
}

function getWatcherKey(watcher = {}) {
  return (
    String(watcher?.id || "").trim() ||
    String(watcher?.email || "").trim().toLowerCase() ||
    String(watcher?.name || "").trim().toLowerCase()
  );
}

function watcherMatchesUser(watcher = {}, sourceUser = {}) {
  const watcherId = String(watcher?.id || "").trim();
  const watcherEmail = String(watcher?.email || "").trim().toLowerCase();
  const userId = String(sourceUser?.id || "").trim();
  const userEmail = String(sourceUser?.email || "").trim().toLowerCase();
  return Boolean((watcherId && watcherId === userId) || (watcherEmail && watcherEmail === userEmail));
}

function ceilHalf(value) {
  return Math.ceil((Number(value) || 0) * 2) / 2;
}

function normalizeEffortHours(value) {
  const parsed = Number(String(value || "").replace(",", "."));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(0.5, roundHalf(parsed));
}

function timeToDecimal(timeStr) {
  if (!timeStr) return null;
  const [h, m] = String(timeStr).split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h + m / 60;
}

function decimalToTime(dec) {
  const normalized = roundHalf(dec);
  const h = Math.floor(normalized);
  const m = Math.round((normalized - h) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function compareScheduleSegments(a, b) {
  if (a.date !== b.date) return String(a.date).localeCompare(String(b.date));
  if (a.start !== b.start) return a.start - b.start;
  return a.end - b.end;
}

function normalizeScheduleSegments(segments = []) {
  if (!Array.isArray(segments) || segments.length === 0) return [];

  const groupedByDate = new Map();
  segments.forEach((segment) => {
    const date = String(segment?.date || "");
    const start = Number(segment?.start);
    const end = Number(segment?.end);
    if (!date || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
    if (!groupedByDate.has(date)) groupedByDate.set(date, []);
    groupedByDate.get(date).push({ start, end });
  });

  const normalized = [];
  [...groupedByDate.keys()]
    .sort((a, b) => a.localeCompare(b))
    .forEach((date) => {
      const items = groupedByDate.get(date).sort((a, b) => a.start - b.start);
      const merged = [];

      items.forEach((item) => {
        const last = merged[merged.length - 1];
        if (!last || item.start > last.end) {
          merged.push({ ...item });
          return;
        }
        last.end = Math.max(last.end, item.end);
      });

      merged.forEach((item) => {
        normalized.push({
          date,
          start: roundHalf(item.start),
          end: roundHalf(item.end),
        });
      });
    });

  return normalized.sort(compareScheduleSegments);
}

function getTicketScheduleSegments(ticket) {
  const segments = [];

  const addSegment = (date, startTime, endTime) => {
    const start = timeToDecimal(startTime);
    const end = timeToDecimal(endTime);
    if (!date || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
    segments.push({
      date: String(date),
      start: roundHalf(start),
      end: roundHalf(end),
    });
  };

  addSegment(ticket?.scheduled_date, ticket?.start_time, ticket?.end_time);
  (ticket?.continuation_schedule || []).forEach((segment) => {
    addSegment(segment?.date, segment?.start_time, segment?.end_time);
  });

  return normalizeScheduleSegments(segments);
}

function schedulePayloadFromSegments(segments = []) {
  const normalizedSegments = normalizeScheduleSegments(segments);
  if (!Array.isArray(normalizedSegments) || normalizedSegments.length === 0) {
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

function buildDoneScheduleSnapshot(ticket, completionDate, completionTime) {
  const completionDecimalRaw = timeToDecimal(completionTime);
  const completionDecimal = Number.isFinite(completionDecimalRaw)
    ? Math.min(DAY_END, ceilHalf(completionDecimalRaw))
    : null;
  if (!completionDate || !Number.isFinite(completionDecimal)) return null;

  const sourceSegments = getTicketScheduleSegments(ticket);
  if (sourceSegments.length === 0) return null;

  const completedSegments = [];

  for (const segment of sourceSegments) {
    if (segment.date < completionDate) {
      completedSegments.push(segment);
      continue;
    }

    if (segment.date > completionDate) break;

    if (completionDecimal <= segment.start) break;

    const cappedEnd = roundHalf(Math.min(segment.end, completionDecimal));
    if (cappedEnd > segment.start) {
      completedSegments.push({
        ...segment,
        end: cappedEnd,
      });
    }

    if (completionDecimal < segment.end) break;
  }

  // If completion happened after the last planned slot of the same day,
  // extend the last segment to match the real completion time.
  const completedSameDay = completedSegments.filter((segment) => segment.date === completionDate);
  if (completedSameDay.length > 0) {
    const lastEnd = Math.max(...completedSameDay.map((segment) => segment.end));
    const extendedEnd = roundHalf(Math.min(DAY_END, completionDecimal));
    if (extendedEnd > lastEnd) {
      completedSegments.push({
        date: completionDate,
        start: lastEnd,
        end: extendedEnd,
      });
    }
  }

  if (completedSegments.length === 0) return null;

  const effort = roundHalf(
    completedSegments.reduce((sum, segment) => sum + (segment.end - segment.start), 0)
  );

  return {
    ...schedulePayloadFromSegments(completedSegments),
    effort_hours: effort > 0 ? effort : undefined,
  };
}

function buildPauseScheduleSnapshot(ticket, pauseDate, pauseTime) {
  const completedSnapshot = buildDoneScheduleSnapshot(ticket, pauseDate, pauseTime);
  if (!completedSnapshot) return null;

  const workedEffort = roundHalf(Number(completedSnapshot.effort_hours) || 0);
  const plannedEffort = Math.max(getPlannedEffortHours(ticket), workedEffort);
  const remainingEffort = roundHalf(Math.max(0, plannedEffort - workedEffort));
  const schedule = { ...completedSnapshot };
  delete schedule.effort_hours;

  return {
    schedule,
    workedEffort,
    remainingEffort,
  };
}

function getWorkedScheduleSegments(ticket) {
  let remainingWorked = roundHalf(getWorkedEffortHours(ticket));
  if (remainingWorked <= 0) return [];

  const workedSegments = [];
  for (const segment of getTicketScheduleSegments(ticket)) {
    if (remainingWorked <= 0) break;
    const duration = roundHalf(segment.end - segment.start);
    if (duration <= 0) continue;

    const workedDuration = roundHalf(Math.min(duration, remainingWorked));
    workedSegments.push({
      ...segment,
      end: roundHalf(segment.start + workedDuration),
    });
    remainingWorked = roundHalf(remainingWorked - workedDuration);
  }

  return workedSegments;
}

function getPlannedCompletionInfo(ticket) {
  const segments = getTicketScheduleSegments(ticket);
  if (segments.length > 0) {
    const last = segments[segments.length - 1];
    return {
      date: last.date,
      time: decimalToTime(last.end),
    };
  }

  const fallbackDate = ticket?.scheduled_date ? String(ticket.scheduled_date) : null;
  const fallbackEnd = timeToDecimal(ticket?.end_time);
  if (!fallbackDate || !Number.isFinite(fallbackEnd)) return null;

  return {
    date: fallbackDate,
    time: decimalToTime(roundHalf(fallbackEnd)),
  };
}

function formatDateTimeLabel(dateStr, timeStr) {
  const dateLabel = moment(dateStr, "YYYY-MM-DD", true).isValid()
    ? moment(dateStr, "YYYY-MM-DD").format("DD/MM")
    : dateStr;
  return `${dateLabel} ${timeStr}`.trim();
}

function isAbsenceDay(dev, dateStr) {
  if (!dev || !Array.isArray(dev.absences)) return false;
  return dev.absences.some((absence) => absence?.date === dateStr);
}

function buildInProgressSchedule(startDate, startTime, effortHours, dev = null) {
  const totalEffort = roundHalf(Number(effortHours) || 0);
  if (totalEffort <= 0) return null;
  const safeStartDate = moment(startDate, "YYYY-MM-DD", true).isValid()
    ? moment(startDate, "YYYY-MM-DD", true).format("YYYY-MM-DD")
    : moment().format("YYYY-MM-DD");
  const unavailableIntervalsByDate = getDeveloperUnavailableIntervalsByDate(dev, {
    fromDate: safeStartDate,
    toDate: moment(safeStartDate).add(45, "days").format("YYYY-MM-DD"),
  });

  let remaining = totalEffort;
  const firstDay = moment(startDate, "YYYY-MM-DD", true);
  let cursor = firstDay.isValid() ? firstDay.startOf("day") : moment().startOf("day");
  let dayStart = timeToDecimal(startTime);
  if (!Number.isFinite(dayStart)) dayStart = DAY_START;

  const segments = [];

  for (let i = 0; i < 45 && remaining > 0; i++) {
    const dateStr = cursor.format("YYYY-MM-DD");
    const isWeekday = cursor.isoWeekday() <= 5;

    if (isWeekday && !isAbsenceDay(dev, dateStr)) {
      const effectiveStart = i === 0 ? dayStart : DAY_START;
      const clampedStart = Math.max(DAY_START, effectiveStart);

      if (clampedStart < DAY_END) {
        const occupiedRaw = [
          ...(unavailableIntervalsByDate[dateStr] || []),
          { start: LUNCH_START, end: LUNCH_END },
        ].filter((interval) =>
          Number.isFinite(interval?.start) &&
          Number.isFinite(interval?.end) &&
          interval.end > interval.start
        ).sort((a, b) => a.start - b.start);

        const occupied = [];
        occupiedRaw.forEach((interval) => {
          const last = occupied[occupied.length - 1];
          if (!last || interval.start > last.end) {
            occupied.push({ start: interval.start, end: interval.end });
            return;
          }
          last.end = Math.max(last.end, interval.end);
        });

        const windows = [];
        let pointer = clampedStart;
        occupied.forEach((interval) => {
          const start = Math.max(clampedStart, interval.start);
          const end = Math.min(DAY_END, interval.end);
          if (start > pointer) {
            windows.push({ start: pointer, end: start });
          }
          if (end > pointer) {
            pointer = end;
          }
        });
        if (pointer < DAY_END) {
          windows.push({ start: pointer, end: DAY_END });
        }

        for (const window of windows) {
          const windowStart = roundHalf(window.start);
          const windowEnd = roundHalf(window.end);
          const available = roundHalf(windowEnd - windowStart);
          if (available <= 0) continue;

          const allocated = roundHalf(Math.min(available, remaining));
          if (allocated <= 0) continue;

          segments.push({
            date: dateStr,
            start_time: decimalToTime(windowStart),
            end_time: decimalToTime(windowStart + allocated),
          });

          remaining = roundHalf(remaining - allocated);
          if (remaining <= 0) break;
        }
      }
    }

    cursor = cursor.add(1, "day");
    dayStart = DAY_START;
  }

  if (segments.length === 0) return null;

  const [first, ...continuation] = segments;
  return {
    scheduled_date: first.date,
    start_time: first.start_time,
    end_time: first.end_time,
    continuation_schedule: continuation.map((segment) => ({
      date: segment.date,
      start_time: segment.start_time,
      end_time: segment.end_time,
    })),
  };
}

function normalizeTicketKind(ticket) {
  const normalized = String(ticket?.ticket_kind || "").trim().toLowerCase();
  return normalized || "main";
}

function normalizeLiveOperationType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(LIVE_OPERATION_LABELS, normalized)
    ? normalized
    : "launch";
}

function getLiveOperationLabel(value) {
  const normalized = normalizeLiveOperationType(value);
  return LIVE_OPERATION_LABELS[normalized] || LIVE_OPERATION_LABELS.launch;
}

function normalizeLiveState(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(LIVE_STATE_LABELS, normalized)) return normalized;
  return "not_live";
}

function normalizeLiveConfirmationStatus(value, fallbackLiveState = "not_live") {
  const normalized = String(value || "").trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(LIVE_CONFIRMATION_STATUS_LABELS, normalized)) {
    return normalized;
  }

  const liveState = normalizeLiveState(fallbackLiveState);
  if (liveState === "launch_requested") return "pending";
  if (liveState === "live" || liveState === "change_requested" || liveState === "stop_requested") {
    return "confirmed";
  }
  return "not_confirmed";
}

function getQaCycleValue(ticket) {
  const cycle = Number(ticket?.qa_cycle);
  return Number.isFinite(cycle) && cycle > 0 ? Math.floor(cycle) : 0;
}

function getAuditEntryByAction(ticket, action) {
  if (!ticket || !Array.isArray(ticket.audit_log)) return null;
  const match = [...ticket.audit_log]
    .reverse()
    .find((entry) => String(entry?.action || "").trim().toLowerCase() === String(action || "").trim().toLowerCase());
  return match || null;
}

function getEventTimestamp(...values) {
  const firstValid = values.find((value) => value && moment(value).isValid());
  return firstValid || null;
}

function buildQaPhaseEvents(mainTicket, allTickets = []) {
  if (!mainTicket) return [];

  const relatedTickets = allTickets
    .filter((entry) => String(entry?.parent_ticket_id || "").trim() === String(mainTicket.id))
    .filter((entry) => {
      const kind = normalizeTicketKind(entry);
      return kind === "qa_review" || kind === "qa_fix" || kind === "post_preview_change";
    });

  const events = [];

  relatedTickets.forEach((entry) => {
    const kind = normalizeTicketKind(entry);
    const cycle = getQaCycleValue(entry) || 1;

    if (kind === "qa_review") {
      events.push({
        id: `${entry.id}-requested`,
        timestamp: getEventTimestamp(entry.qa_requested_at, entry.created_date, entry.updated_date),
        title: "Preview mandata in approvazione",
        description: entry.assignee_name
          ? `Assegnata a ${entry.assignee_name}`
          : "Review assegnata al tech supervisor del cliente.",
        actor: entry.qa_requested_by || entry.created_by || entry.assignee_name || "Sistema",
        cycle,
        tone: "info",
      });

      if (entry.qa_review_outcome === "approved") {
        events.push({
          id: `${entry.id}-approved`,
          timestamp: getEventTimestamp(entry.qa_review_resolved_at, entry.updated_date),
          title: "Preview approvata",
          description: "Il test e stato validato e puo proseguire alla chiusura.",
          actor: entry.qa_review_resolved_by || entry.assignee_name || "Tech supervisor",
          cycle,
          tone: "success",
        });
      }

      if (entry.qa_review_outcome === "rejected") {
        events.push({
          id: `${entry.id}-rejected`,
          timestamp: getEventTimestamp(entry.qa_review_resolved_at, entry.updated_date),
          title: "Preview rifiutata",
          description: entry.qa_reject_notes || "Il tech supervisor ha richiesto un fix prima dell'approvazione.",
          actor: entry.qa_review_resolved_by || entry.assignee_name || "Tech supervisor",
          cycle,
          tone: "warning",
        });
      }
    }

    if (kind === "qa_fix") {
      events.push({
        id: `${entry.id}-created`,
        timestamp: getEventTimestamp(entry.created_date, entry.updated_date),
        title: "Bug fix creato",
        description: entry.assignee_name
          ? `Assegnato a ${entry.assignee_name}`
          : "Creato un fix per la preview rifiutata.",
        actor: entry.created_by || entry.assignee_name || "Sistema",
        cycle,
        tone: "warning",
      });

      if (isClosedStatus(entry.status)) {
        const completionAudit = getAuditEntryByAction(entry, "qa_fix_completed");
        events.push({
          id: `${entry.id}-completed`,
          timestamp: getEventTimestamp(completionAudit?.timestamp, entry.updated_date),
          title: "Bug fix completato",
          description: "Fix completato e rimandato in review.",
          actor: completionAudit?.user || entry.assignee_name || "Developer",
          cycle,
          tone: "success",
        });
      }
    }

    if (kind === "post_preview_change") {
      events.push({
        id: `${entry.id}-created`,
        timestamp: getEventTimestamp(entry.post_preview_requested_at, entry.created_date, entry.updated_date),
        title: "Modifica post-preview richiesta",
        description: entry.post_preview_notes || entry.description || "Creata una task collegata per il developer assegnato.",
        actor: entry.post_preview_requested_by || entry.created_by || "Analyst",
        cycle,
        tone: "warning",
      });

      if (isClosedStatus(entry.status)) {
        const completionAudit = getAuditEntryByAction(entry, "post_preview_change_completed");
        events.push({
          id: `${entry.id}-completed`,
          timestamp: getEventTimestamp(completionAudit?.timestamp, entry.updated_date),
          title: "Modifica post-preview completata",
          description: "La task collegata e stata completata dal developer.",
          actor: completionAudit?.user || entry.assignee_name || "Developer",
          cycle,
          tone: "success",
        });
      }
    }
  });

  return events
    .filter((entry) => entry.timestamp)
    .sort((a, b) => {
      const diff = moment(a.timestamp).valueOf() - moment(b.timestamp).valueOf();
      if (diff !== 0) return diff;
      return String(a.id).localeCompare(String(b.id));
    });
}

function buildLivePhaseEvents(mainTicket, allTickets = []) {
  if (!mainTicket) return [];

  const relatedTickets = allTickets
    .filter((entry) => String(entry?.parent_ticket_id || "").trim() === String(mainTicket.id))
    .filter((entry) => normalizeTicketKind(entry) === "live_ops");

  const events = [];

  relatedTickets.forEach((entry) => {
    const operationType = normalizeLiveOperationType(entry.live_operation_type);
    const operationLabel = getLiveOperationLabel(operationType);

    events.push({
      id: `${entry.id}-requested`,
      timestamp: getEventTimestamp(entry.live_requested_at, entry.created_date, entry.updated_date),
      title: `${operationLabel} richiesta`,
      description: [
        entry.live_split ? `Split: ${entry.live_split}` : "",
        entry.live_target ? `Target: ${entry.live_target}` : "",
      ]
        .filter(Boolean)
        .join(" · "),
      actor: entry.live_requested_by || entry.created_by || "Analyst",
      cycle: null,
      tone: "info",
    });

    if (isClosedStatus(entry.status) || entry.live_completed_at) {
      events.push({
        id: `${entry.id}-completed`,
        timestamp: getEventTimestamp(entry.live_completed_at, entry.updated_date),
        title: `${operationLabel} completata`,
        description: entry.live_notes || "Operazione completata dal tech supervisor.",
        actor: entry.live_completed_by || entry.assignee_name || "Tech supervisor",
        cycle: null,
        tone: "success",
      });
    }
  });

  return events
    .filter((entry) => entry.timestamp)
    .sort((a, b) => {
      const diff = moment(a.timestamp).valueOf() - moment(b.timestamp).valueOf();
      if (diff !== 0) return diff;
      return String(a.id).localeCompare(String(b.id));
    });
}

function buildTicketUrl(ticketId, from = "ticket_detail") {
  return `${createPageUrl("TicketDetail")}?id=${ticketId}&from=${from}`;
}

export default function TicketDetail() {
  const location = useLocation();
  const urlParams = new URLSearchParams(location.search);
  const ticketId = urlParams.get("id");
  const fromPage = urlParams.get("from");
  const pipelineDeveloperId = urlParams.get("dev");
  const queryClient = useQueryClient();
  const [comment, setComment] = useState("");
  const commentTextareaRef = useRef(null);
  const [editingCommentIndex, setEditingCommentIndex] = useState(null);
  const [editingCommentText, setEditingCommentText] = useState("");
  const editingCommentTextareaRef = useRef(null);
  const [plannedEffortInput, setPlannedEffortInput] = useState("");
  const [actualEffortInput, setActualEffortInput] = useState("");
  const [deadlineInput, setDeadlineInput] = useState("");
  const [savingDeadline, setSavingDeadline] = useState(false);
  const [inProgressConflict, setInProgressConflict] = useState(null); // { nowTime, plannedTime }
  const [inProgressBlockDialog, setInProgressBlockDialog] = useState(null);
  const [resumePauseDialog, setResumePauseDialog] = useState(null);
  const [resumeRemainingInput, setResumeRemainingInput] = useState("");
  const [doneConflict, setDoneConflict] = useState(null); // { status, nowDate, nowTime, plannedDate, plannedTime }
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editingDetails, setEditingDetails] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [reportedOutcomeInput, setReportedOutcomeInput] = useState("");
  const [manualPriorityInput, setManualPriorityInput] = useState("");
  const [qaRequestDialog, setQaRequestDialog] = useState(false);
  const [qaRequestForm, setQaRequestForm] = useState({
    preview_links: [{ title: "", url: "" }],
    review_notes: "",
    test_instructions: "",
  });
  const [liveOpsDialog, setLiveOpsDialog] = useState(false);
  const [liveOpsForm, setLiveOpsForm] = useState({
    operation_type: "launch",
    split: "",
    target: "",
    notes: "",
    outcome: "",
    effort_hours: String(LIVE_OPS_EFFORT_HOURS),
    assignee_id: "",
  });
  const [submittingLiveOps, setSubmittingLiveOps] = useState(false);
  const [submittingQaRequest, setSubmittingQaRequest] = useState(false);
  const [qaRejectDialog, setQaRejectDialog] = useState(false);
  const [qaRejectNotes, setQaRejectNotes] = useState("");
  const [submittingQaDecision, setSubmittingQaDecision] = useState(false);
  const [postPreviewDialog, setPostPreviewDialog] = useState(false);
  const [postPreviewNotes, setPostPreviewNotes] = useState("");
  const [postPreviewEffortInput, setPostPreviewEffortInput] = useState(String(POST_PREVIEW_CHANGE_EFFORT_HOURS));
  const [postPreviewAssigneeId, setPostPreviewAssigneeId] = useState("");
  const [submittingPostPreviewChange, setSubmittingPostPreviewChange] = useState(false);
  const [submittingUrgency, setSubmittingUrgency] = useState(false);
  const [watcherToAddId, setWatcherToAddId] = useState("");
  const { user, isAnalyst, isDeveloper, isAdmin, isTechSupervisor } = useCurrentUser();

  useEffect(() => {
    if (editingCommentIndex == null) return;
    window.requestAnimationFrame(() => {
      editingCommentTextareaRef.current?.focus();
      const textLength = editingCommentText.length;
      editingCommentTextareaRef.current?.setSelectionRange?.(textLength, textLength);
    });
  }, [editingCommentIndex, editingCommentText]);

  const backContext = resolveTicketBackContext({
    fromPage,
    storedPage: window.sessionStorage.getItem("app_last_non_ticket_page"),
    storedPath: window.sessionStorage.getItem("app_last_non_ticket_path"),
    role: normalizeAppRole(user?.app_role || user?._app_role || user?.role),
    ticketId,
    pipelineDeveloperId,
  });

  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ["tickets"],
    queryFn: () => appClient.entities.Ticket.list(),
  });
  const ticket = useMemo(
    () => tickets.find((entry) => entry.id === ticketId),
    [ticketId, tickets]
  );

  const { data: developers = [] } = useQuery({
    queryKey: ["developers"],
    queryFn: () => appClient.entities.Developer.list(),
  });

  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: () => appClient.entities.Client.list(),
  });

  const { data: users = [] } = useQuery({
    queryKey: ["users"],
    queryFn: () => appClient.entities.User.list(),
  });

  const { data: configList = [] } = useQuery({
    queryKey: ["priority_config"],
    queryFn: () => appClient.entities.PriorityConfig.list(),
  });

  const config = configList[0] || DEFAULT_CONFIG;

  const notifyClientSupervisor = async ({ ticketOverride = null, title, body = "", metadata = {} }) => {
    if (!title) return;
    await notifyClientTicketUpdate({
      ticket: ticketOverride || ticket,
      actor: user,
      client,
      title,
      body,
      metadata,
    }).catch(() => {});
  };

  useEffect(() => {
    setDeadlineInput(ticket?.deadline || "");
  }, [ticket?.id, ticket?.deadline]);

  useEffect(() => {
    setReportedOutcomeInput(String(ticket?.reported_outcome || "").trim());
  }, [ticket?.id, ticket?.reported_outcome]);

  useEffect(() => {
    const nextValue =
      ticket?.priority_override === null || ticket?.priority_override === undefined
        ? ""
        : String(ticket.priority_override);
    setManualPriorityInput(nextValue);
  }, [ticket?.id, ticket?.priority_override]);

  const ticketKind = normalizeTicketKind(ticket);
  const isQaReviewTicket = ticketKind === "qa_review";
  const isQaFixTicket = ticketKind === "qa_fix";
  const isLiveOpsTicket = ticketKind === "live_ops";
  const isPostPreviewChangeTicket = ticketKind === "post_preview_change";
  const mainTicketRecord = useMemo(() => {
    if (!ticket) return null;
    if (ticketKind === "main") return ticket;
    return tickets.find((entry) => entry.id === ticket.parent_ticket_id) || null;
  }, [ticket, ticketKind, tickets]);
  const qaSourceTicketRecord = useMemo(() => {
    if (!ticket) return null;
    if (ticketKind === "qa_review") {
      return (
        tickets.find((entry) => entry.id === (ticket.qa_source_ticket_id || ticket.parent_ticket_id)) ||
        mainTicketRecord ||
        null
      );
    }
    return ticket;
  }, [ticket, ticketKind, tickets, mainTicketRecord]);
  const reviewPreviewSource = ticketKind === "qa_review" ? qaSourceTicketRecord : ticket;
  const reviewPreviewLinks = resolveQaPreviewEntries(reviewPreviewSource);
  const hasQaSidebarMeta = Boolean(
    (mainTicketRecord && mainTicketRecord.id !== ticket?.id) ||
    (isQaReviewTicket && qaSourceTicketRecord && qaSourceTicketRecord.id !== mainTicketRecord?.id) ||
    isQaFixTicket ||
    isQaReviewTicket ||
    isPostPreviewChangeTicket
  );
  const qaPhaseEvents = useMemo(() => {
    if (ticketKind !== "main" || !ticket) return [];
    return buildQaPhaseEvents(ticket, tickets);
  }, [ticketKind, ticket, tickets]);
  const livePhaseEvents = useMemo(() => {
    if (ticketKind !== "main" || !ticket) return [];
    return buildLivePhaseEvents(ticket, tickets);
  }, [ticketKind, ticket, tickets]);
  const phaseEvents = useMemo(() => {
    return [...qaPhaseEvents, ...livePhaseEvents].sort((a, b) => {
      const diff = moment(a.timestamp).valueOf() - moment(b.timestamp).valueOf();
      if (diff !== 0) return diff;
      return String(a.id).localeCompare(String(b.id));
    });
  }, [qaPhaseEvents, livePhaseEvents]);

  const applyDeveloperRebalance = async (developerId, options = {}) => {
    if (!developerId) return;
    const dev = developers.find((d) => d.id === developerId);
    const latestTickets = await appClient.entities.Ticket.list();
    const resolvedOptions = getDynamicRebalanceOptions(options);
    const updates = buildWeeklyRebalanceUpdates(
      latestTickets,
      developerId,
      dev,
      resolvedOptions
    );

    if (updates.length > 0) {
      await Promise.all(
        updates.map((entry) => appClient.entities.Ticket.update(entry.id, entry.updates))
      );
    }
  };

  const applyRebalanceForDevelopers = async (developerIds = [], options = {}) => {
    const uniqueIds = [...new Set(developerIds.filter(Boolean))];
    if (uniqueIds.length === 0) return;

    for (const developerId of uniqueIds) {
      await applyDeveloperRebalance(developerId, options);
    }

    await queryClient.invalidateQueries({ queryKey: ["tickets"] });
  };

  const findConcurrentInProgressTicket = (sourceTicket, sourceTickets = tickets) => {
    if (!sourceTicket?.assignee_id) return null;
    return (sourceTickets || []).find(
      (entry) =>
        entry?.id &&
        entry.id !== sourceTicket.id &&
        entry.assignee_id === sourceTicket.assignee_id &&
        normalizeTicketStatus(entry.status) === "in_progress"
    ) || null;
  };

  const openInProgressBlockDialog = (sourceTicket, activeTicket) => {
    if (!sourceTicket?.id || !activeTicket?.id) return;
    setInProgressBlockDialog({ ticket: sourceTicket, activeTicket });
  };

  const buildAuditEntry = (action, details) => ({
    timestamp: new Date().toISOString(),
    user: user?.email || user?.full_name || "user",
    action,
    details,
  });

  const buildCommentIdentityKey = (commentEntry) => {
    if (!commentEntry) return "";

    const explicitId = String(commentEntry.comment_id || commentEntry.id || "").trim();
    if (explicitId) return `id:${explicitId}`;

    const timestamp = String(commentEntry.timestamp || "").trim();
    const owner = String(
      commentEntry.user_id || commentEntry.email || commentEntry.user || ""
    ).trim().toLowerCase();
    const text = String(commentEntry.text || "").trim();
    return `legacy:${timestamp}|${owner}|${text}`;
  };

  const findMatchingCommentIndex = (comments = [], targetComment) => {
    const targetKey = buildCommentIdentityKey(targetComment);
    if (!targetKey) return -1;
    return comments.findIndex((entry) => buildCommentIdentityKey(entry) === targetKey);
  };

  const updateTicketWithAudit = async (targetTicketId, data, auditAction, auditDetails) => {
    const latestTickets = await appClient.entities.Ticket.list();
    const targetTicket = latestTickets.find((entry) => entry.id === targetTicketId);
    if (!targetTicket) {
      throw new Error("Ticket non trovato");
    }

    const auditLog = [...(targetTicket.audit_log || []), buildAuditEntry(auditAction, auditDetails)];
    await appClient.entities.Ticket.update(targetTicketId, {
      ...data,
      audit_log: auditLog,
    });

    return {
      ...targetTicket,
      ...data,
      audit_log: auditLog,
    };
  };

  const updateTicketComments = async (updater, auditAction = null, auditDetails = "") => {
    const latestTickets = await appClient.entities.Ticket.list();
    const targetTicket = latestTickets.find((entry) => entry.id === ticketId);
    if (!targetTicket) {
      throw new Error("Ticket non trovato");
    }

    const currentComments = Array.isArray(targetTicket.comments) ? targetTicket.comments : [];
    const nextComments =
      typeof updater === "function" ? updater(currentComments, targetTicket) : updater;

    if (!Array.isArray(nextComments)) {
      throw new Error("Formato commenti non valido");
    }

    const payload = {
      comments: nextComments,
    };

    if (auditAction) {
      payload.audit_log = [
        ...(targetTicket.audit_log || []),
        buildAuditEntry(auditAction, auditDetails),
      ];
    }

    await appClient.entities.Ticket.update(ticketId, payload);
    await queryClient.invalidateQueries({ queryKey: ["ticket", ticketId] });
    await queryClient.invalidateQueries({ queryKey: ["tickets"] });

    return {
      ...targetTicket,
      ...payload,
    };
  };

  const buildSchedulePayloadFromSlots = (slots = []) => {
    if (!Array.isArray(slots) || slots.length === 0) {
      return {
        scheduled_date: null,
        start_time: null,
        end_time: null,
        continuation_schedule: [],
      };
    }

    const [first, ...rest] = slots;
    return {
      scheduled_date: first.date,
      start_time: first.start_time,
      end_time: first.end_time,
      continuation_schedule: rest.map((segment) => ({
        date: segment.date,
        start_time: segment.start_time,
        end_time: segment.end_time,
      })),
    };
  };

  const resolveTechSupervisorDeveloper = (targetClient = null) => {
    if (!targetClient) return null;

    if (targetClient.tech_supervisor_id) {
      const matchById = developers.find(
        (developer) => developer.id === targetClient.tech_supervisor_id && developer.active !== false
      );
      if (matchById) return matchById;
    }

    const normalizedSupervisor = normalizeText(
      targetClient.tech_supervisor_email || targetClient.tech_supervisor_name
    );

    return (
      developers.find((developer) => {
        if (developer.active === false) return false;
        const developerEmail = normalizeText(developer?.email);
        const developerName = normalizeText(developer?.name);
        return Boolean(
          normalizedSupervisor &&
            (normalizedSupervisor === developerEmail || normalizedSupervisor === developerName)
        );
      }) || null
    );
  };

  const resolveActiveDeveloperById = (developerId) =>
    developers.find(
      (developer) => developer.id === developerId && developer.active !== false
    ) || null;

  const resolveTicketAssigneeDeveloper = (sourceTicket) =>
    resolveActiveDeveloperById(sourceTicket?.assignee_id) ||
    developers.find(
      (developer) =>
        developer.active !== false &&
        normalizeText(developer?.email) === normalizeText(sourceTicket?.assignee_email)
    ) ||
    null;

  const resolveQaCycle = (sourceTicket = null, parentTicket = null) => {
    return Math.max(getQaCycleValue(sourceTicket), getQaCycleValue(parentTicket), 1);
  };

  const schedulePriorityInsertionBeforeNew = async ({
    developer,
    ticketId: targetTicketId,
    insertBeforeNextActivity = false,
  }) => {
    if (!developer?.id || !targetTicketId) return null;

    const latestTickets = await appClient.entities.Ticket.list();
    const sourceDeveloperTickets = latestTickets.filter(
      (entry) => entry.assignee_id === developer.id && isSchedulableTicket(entry)
    );
    const nowInfo = getNowInRome();
    const currentOccupiedTicket = sourceDeveloperTickets.find((entry) => {
      if (entry.id === targetTicketId) return false;
      return getTicketScheduleSegments(entry).some(
        (segment) =>
          segment.date === nowInfo.date &&
          nowInfo.decimal != null &&
          segment.start <= nowInfo.decimal &&
          segment.end > nowInfo.decimal
      );
    });
    const currentOccupiedSegment = currentOccupiedTicket
      ? getTicketScheduleSegments(currentOccupiedTicket).find(
          (segment) =>
            segment.date === nowInfo.date &&
            nowInfo.decimal != null &&
            segment.start <= nowInfo.decimal &&
            segment.end > nowInfo.decimal
        ) || null
      : null;

    const manualAnchorStart = currentOccupiedSegment
      ? currentOccupiedSegment.end
      : (nowInfo.roundedDecimal ?? ceilHalf(nowInfo.decimal));
    const manualInsertionAnchor =
      insertBeforeNextActivity && Number.isFinite(manualAnchorStart)
        ? {
            date: currentOccupiedSegment?.date || nowInfo.date,
            start: manualAnchorStart,
          }
        : currentOccupiedSegment
          ? {
              date: currentOccupiedSegment.date,
              start: currentOccupiedSegment.end,
            }
          : null;

    const freezeTicketIds = sourceDeveloperTickets
      .filter(
        (entry) => {
          if (entry.id === targetTicketId) return false;
          if (entry.id === currentOccupiedTicket?.id) return true;
          if (insertBeforeNextActivity) return false;
          return normalizeTicketStatus(entry.status) !== "new";
        }
      )
      .map((entry) => entry.id);

    const updates = buildWeeklyRebalanceUpdates(
      latestTickets,
      developer.id,
      developer,
      {
        ...getDynamicRebalanceOptions({
          preserveWorkingDaysFromToday: 0,
          preserveExistingSequence: false,
          forceFirstTicketIds: [targetTicketId],
          ...(insertBeforeNextActivity
            ? {
                includeTodayHoles: true,
                freezeCurrentWeekSegments: false,
                preserveTodaySegments: false,
                preserveElapsedTodaySegments: true,
                allowInProgressReplan: true,
              }
            : {}),
        }),
        planningStartDate: manualInsertionAnchor?.date || nowInfo.date,
        manualInsertionAnchor,
        freezeTicketIds,
      }
    );

    if (updates.length > 0) {
      await Promise.all(
        updates.map((entry) => appClient.entities.Ticket.update(entry.id, entry.updates))
      );
    }

    return updates.find((entry) => entry.id === targetTicketId)?.updates || null;
  };

  const updateMutation = useMutation({
    mutationFn: ({ data, auditAction, auditDetails }) => {
      const auditEntry = {
        timestamp: new Date().toISOString(),
        user: user?.email || user?.full_name || "user",
        action: auditAction,
        details: auditDetails,
      };
      return appClient.entities.Ticket.update(ticketId, {
        ...data,
        audit_log: [...(ticket?.audit_log || []), auditEntry],
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["ticket", ticketId] });
      await queryClient.invalidateQueries({ queryKey: ["tickets"] });
    },
  });

  const getCompletionConflictData = (newStatus) => {
    if (!isClosedStatus(newStatus) || isTicketClosed(ticket)) return null;

    const nowInfo = getNowInRome();
    const planned = getPlannedCompletionInfo(ticket);
    const nowRoundedTime = nowInfo.roundedTime || nowInfo.time;
    const samePlanned =
      planned &&
      planned.date === nowInfo.date &&
      planned.time === nowRoundedTime;

    if (!planned || samePlanned) return null;

    return {
      status: newStatus,
      nowDate: nowInfo.date,
      nowTime: nowRoundedTime,
      plannedDate: planned.date,
      plannedTime: planned.time,
    };
  };

  const createQaReviewChildTicket = async ({
    sourceTicket,
    parentTicket,
    qaPayload,
    qaCycle = resolveQaCycle(sourceTicket, parentTicket),
  }) => {
    const supervisor = resolveTechSupervisorDeveloper(client);
    if (!supervisor) {
      throw new Error("Nessun tech supervisor configurato sul cliente.");
    }

    const latestTickets = await appClient.entities.Ticket.list();
    const existingReview = latestTickets.find(
      (entry) =>
        normalizeTicketKind(entry) === "qa_review" &&
        entry.parent_ticket_id === parentTicket.id &&
        getQaCycleValue(entry) === qaCycle &&
        !isClosedStatus(entry.status)
    );
    if (existingReview) {
      throw new Error("Esiste gia una review QA aperta per questo ciclo.");
    }

    const reviewSlots = findOptimalSchedule(
      latestTickets,
      supervisor.id,
      QA_REVIEW_EFFORT_HOURS,
      supervisor.daily_capacity || 8,
      supervisor
    );
    const schedulePayload = buildSchedulePayloadFromSlots(reviewSlots);
    const referencePayload = buildReferenceLinksPayload(
      normalizeReferenceLinks(sourceTicket.reference_links, sourceTicket.link)
    );

    const reviewTicket = await appClient.entities.Ticket.create({
      title: `[QA] ${parentTicket.title}`,
      description:
        sourceTicket.description ||
        parentTicket.description ||
        "Verifica preview e conferma il rilascio del test.",
      required_tracking: sourceTicket.required_tracking || parentTicket.required_tracking || "",
      ...referencePayload,
      client_id: parentTicket.client_id,
      client_name: parentTicket.client_name,
      type: sourceTicket.type || parentTicket.type || "other",
      difficulty: sourceTicket.difficulty || parentTicket.difficulty || "medium",
      status: "new",
      assignee_id: supervisor.id,
      assignee_name: supervisor.name,
      assignee_email: supervisor.email,
      proposed_effort: QA_REVIEW_EFFORT_HOURS,
      priority_score: Math.max(QA_SYSTEM_PRIORITY, getEffectivePriorityScore(sourceTicket)),
      priority_override: QA_SYSTEM_PRIORITY,
      ticket_kind: "qa_review",
      parent_ticket_id: parentTicket.id,
      qa_source_ticket_id: sourceTicket.id,
      qa_cycle: qaCycle,
      ...buildQaPreviewPayload(
        qaPayload.preview_links,
        qaPayload.preview_urls,
        qaPayload.preview_url
      ),
      qa_review_notes: qaPayload.review_notes,
      qa_test_instructions: qaPayload.test_instructions,
      qa_requested_at: new Date().toISOString(),
      qa_requested_by: user?.email || user?.full_name || "user",
      qa_requested_by_id: user?.id || null,
      watchers: normalizeTicketWatchers([
        ...normalizeTicketWatchers(parentTicket),
        ...normalizeTicketWatchers(sourceTicket),
      ]),
      audit_log: [
        buildAuditEntry("qa_review_created", `QA review creata per ${supervisor.name}`),
      ],
      ...schedulePayload,
    });

    await notifyTicketAssigned({
      ticket: reviewTicket,
      actor: user,
    }).catch(() => {});

    return reviewTicket;
  };

  const createQaFixChildTicket = async ({
    sourceTicket,
    parentTicket,
    rejectNotes,
    qaCycle = resolveQaCycle(sourceTicket, parentTicket),
  }) => {
    const sourceDeveloper = developers.find((developer) => developer.id === sourceTicket.assignee_id);
    if (!sourceDeveloper) {
      throw new Error("Developer originale non trovato per creare il ticket di fix.");
    }

    const latestTickets = await appClient.entities.Ticket.list();
    const existingFix = latestTickets.find(
      (entry) =>
        normalizeTicketKind(entry) === "qa_fix" &&
        entry.parent_ticket_id === parentTicket.id &&
        getQaCycleValue(entry) === qaCycle &&
        !isClosedStatus(entry.status)
    );
    if (existingFix) {
      throw new Error("Esiste gia un ticket di fix aperto per questo ciclo QA.");
    }

    const referencePayload = buildReferenceLinksPayload(
      normalizeReferenceLinks(sourceTicket.reference_links, sourceTicket.link)
    );
    const previewPayload = buildQaPreviewPayload(
      resolveQaPreviewEntries(sourceTicket, parentTicket)
    );

    const createdFixTicket = await appClient.entities.Ticket.create({
      title: `[QA Fix] ${parentTicket.title}`,
      description: rejectNotes,
      required_tracking: sourceTicket.required_tracking || parentTicket.required_tracking || "",
      ...referencePayload,
      client_id: parentTicket.client_id,
      client_name: parentTicket.client_name,
      type: "bug_fix",
      difficulty: sourceTicket.difficulty || parentTicket.difficulty || "medium",
      status: "new",
      assignee_id: sourceDeveloper.id,
      assignee_name: sourceDeveloper.name,
      assignee_email: sourceDeveloper.email,
      proposed_effort: QA_FIX_EFFORT_HOURS,
      priority_score: QA_SYSTEM_PRIORITY,
      priority_override: QA_SYSTEM_PRIORITY,
      ticket_kind: "qa_fix",
      parent_ticket_id: parentTicket.id,
      qa_source_ticket_id: sourceTicket.id,
      qa_cycle: qaCycle,
      ...previewPayload,
      qa_review_notes: sourceTicket.qa_review_notes || parentTicket.qa_review_notes || "",
      qa_test_instructions: sourceTicket.qa_test_instructions || parentTicket.qa_test_instructions || "",
      qa_reject_notes: rejectNotes,
      watchers: normalizeTicketWatchers([
        ...normalizeTicketWatchers(parentTicket),
        ...normalizeTicketWatchers(sourceTicket),
      ]),
      audit_log: [
        buildAuditEntry("qa_fix_created", `QA fix creato per ${sourceDeveloper.name}`),
      ],
    });

    const scheduledFixUpdates = await schedulePriorityInsertionBeforeNew({
      developer: sourceDeveloper,
      ticketId: createdFixTicket.id,
    });

    await notifyTicketAssigned({
      ticket: {
        ...createdFixTicket,
        ...(scheduledFixUpdates || {}),
      },
      actor: user,
    }).catch(() => {});

    return createdFixTicket;
  };

  const createPostPreviewChangeChildTicket = async ({
    parentTicket,
    changeNotes,
    effortHours,
    assignedDeveloperId,
  }) => {
    const targetDeveloper =
      resolveActiveDeveloperById(assignedDeveloperId) ||
      resolveTicketAssigneeDeveloper(parentTicket);
    if (!targetDeveloper) {
      throw new Error("Developer non trovato per creare la modifica post-preview.");
    }
    const normalizedEffort = normalizeEffortHours(effortHours);
    if (!normalizedEffort) {
      throw new Error("Effort non valido per creare la modifica post-preview.");
    }

    const latestTickets = await appClient.entities.Ticket.list();
    const existingChange = latestTickets.find(
      (entry) =>
        normalizeTicketKind(entry) === "post_preview_change" &&
        entry.parent_ticket_id === parentTicket.id &&
        !isClosedStatus(entry.status)
    );
    if (existingChange) {
      throw new Error("Esiste gia una modifica post-preview aperta per questo ticket.");
    }

    const referencePayload = buildReferenceLinksPayload(
      normalizeReferenceLinks(parentTicket.reference_links, parentTicket.link)
    );
    const previewPayload = buildQaPreviewPayload(resolveQaPreviewEntries(parentTicket));
    const nowIso = new Date().toISOString();

    const createdChangeTicket = await appClient.entities.Ticket.create({
      title: `[Modifica post-preview] ${parentTicket.title}`,
      description: changeNotes,
      required_tracking: parentTicket.required_tracking || "",
      ...referencePayload,
      client_id: parentTicket.client_id,
      client_name: parentTicket.client_name,
      type: "bug_fix",
      difficulty: parentTicket.difficulty || "medium",
      status: "new",
      assignee_id: targetDeveloper.id,
      assignee_name: targetDeveloper.name,
      assignee_email: targetDeveloper.email,
      proposed_effort: normalizedEffort,
      priority_score: POST_PREVIEW_SYSTEM_PRIORITY,
      priority_override: POST_PREVIEW_SYSTEM_PRIORITY,
      ticket_kind: "post_preview_change",
      parent_ticket_id: parentTicket.id,
      ...previewPayload,
      qa_review_notes: parentTicket.qa_review_notes || "",
      qa_test_instructions: parentTicket.qa_test_instructions || "",
      post_preview_notes: changeNotes,
      post_preview_requested_at: nowIso,
      post_preview_requested_by: user?.email || user?.full_name || "user",
      post_preview_requested_by_id: user?.id || null,
      watchers: normalizeTicketWatchers(parentTicket),
      audit_log: [
        buildAuditEntry(
          "post_preview_change_created",
          `Modifica post-preview creata per ${targetDeveloper.name} (${normalizedEffort}h)`
        ),
      ],
    });

    const scheduledChangeUpdates = await schedulePriorityInsertionBeforeNew({
      developer: targetDeveloper,
      ticketId: createdChangeTicket.id,
      insertBeforeNextActivity: true,
    });

    await notifyTicketAssigned({
      ticket: {
        ...createdChangeTicket,
        ...(scheduledChangeUpdates || {}),
      },
      actor: user,
    }).catch(() => {});

    return {
      ...createdChangeTicket,
      ...(scheduledChangeUpdates || {}),
    };
  };

  const completeQaReviewTransition = async ({
    statusOptions = {},
    qaPayload,
  }) => {
    const sourceTicket = qaSourceTicketRecord || ticket;
    const parentTicket = mainTicketRecord || sourceTicket;
    const previewPayload = buildQaPreviewPayload(
      qaPayload.preview_links,
      qaPayload.preview_urls,
      qaPayload.preview_url
    );

    await finalizeStatusChange("qa_review", {
      ...statusOptions,
      extraData: {
        ...previewPayload,
        qa_review_notes: qaPayload.review_notes,
        qa_test_instructions: qaPayload.test_instructions,
        qa_cycle: resolveQaCycle(sourceTicket, parentTicket),
      },
      auditAction: "qa_requested",
      auditDetails: `Status: ${normalizeTicketStatus(ticket.status)} → qa_review (preview pronta per review)`,
      suppressCompletionNotification: true,
    });

    const refreshedTickets = await appClient.entities.Ticket.list();
    const refreshedSource =
      refreshedTickets.find((entry) => entry.id === sourceTicket.id) ||
      {
        ...sourceTicket,
        status: "qa_review",
        ...previewPayload,
        qa_review_notes: qaPayload.review_notes,
        qa_test_instructions: qaPayload.test_instructions,
      };
    const refreshedParent =
      refreshedTickets.find((entry) => entry.id === parentTicket.id) || parentTicket;

    if (refreshedParent.id !== refreshedSource.id && refreshedParent.status !== "qa_review") {
      await updateTicketWithAudit(
        refreshedParent.id,
        {
          status: "qa_review",
          ...previewPayload,
          qa_review_notes: qaPayload.review_notes,
          qa_test_instructions: qaPayload.test_instructions,
          qa_cycle: resolveQaCycle(refreshedSource, refreshedParent),
        },
        "qa_requested",
        "Ticket principale portato in QA / Review"
      );
    }

    await createQaReviewChildTicket({
      sourceTicket: refreshedSource,
      parentTicket: refreshedParent,
      qaPayload,
      qaCycle: resolveQaCycle(refreshedSource, refreshedParent),
    });

    await queryClient.invalidateQueries({ queryKey: ["ticket", ticketId] });
    await queryClient.invalidateQueries({ queryKey: ["tickets"] });

    toast({
      title: "Preview inviata in review",
      description: "La task QA e stata assegnata al tech supervisor del cliente.",
    });
  };

  const completeQaFixAndRestartReview = async ({ statusOptions = {} } = {}) => {
    const sourceTicket = ticket;
    const parentTicket = mainTicketRecord;
    if (!parentTicket) {
      throw new Error("Ticket principale non trovato per riaprire il ciclo QA.");
    }

    const nextQaCycle = Math.max(getQaCycleValue(sourceTicket), getQaCycleValue(parentTicket), 1) + 1;

    await finalizeStatusChange("done", {
      ...statusOptions,
      extraData: {
        qa_cycle: getQaCycleValue(sourceTicket) || 1,
      },
      auditAction: "qa_fix_completed",
      auditDetails: "QA fix completato; creata una nuova review",
    });

    const latestTickets = await appClient.entities.Ticket.list();
    const refreshedFix =
      latestTickets.find((entry) => entry.id === sourceTicket.id) || sourceTicket;
    const refreshedParent =
      latestTickets.find((entry) => entry.id === parentTicket.id) || parentTicket;
    const previewPayload = buildQaPreviewPayload(
      resolveQaPreviewEntries(refreshedFix, refreshedParent)
    );

    await updateTicketWithAudit(
      refreshedParent.id,
      {
        status: "qa_review",
        qa_cycle: nextQaCycle,
        ...previewPayload,
        qa_review_notes: refreshedFix.qa_review_notes || refreshedParent.qa_review_notes || "",
        qa_test_instructions:
          refreshedFix.qa_test_instructions || refreshedParent.qa_test_instructions || "",
        qa_reject_notes: "",
      },
      "qa_review_reopened",
      "Nuovo giro QA aperto dopo il fix"
    );

    await createQaReviewChildTicket({
      sourceTicket: refreshedFix,
      parentTicket: refreshedParent,
      qaPayload: {
        preview_links: previewPayload.qa_preview_links,
        preview_urls: previewPayload.qa_preview_urls,
        preview_url: previewPayload.qa_preview_url,
        review_notes: refreshedFix.qa_review_notes || refreshedParent.qa_review_notes || "",
        test_instructions:
          refreshedFix.qa_test_instructions || refreshedParent.qa_test_instructions || "",
      },
      qaCycle: nextQaCycle,
    });

    await queryClient.invalidateQueries({ queryKey: ["ticket", ticketId] });
    await queryClient.invalidateQueries({ queryKey: ["tickets"] });

    toast({
      title: "Fix completato",
      description: "E stata creata una nuova review per il tech supervisor.",
    });
  };

  const getOpenLiveOpsTicketByType = async ({ parentTicketId, operationType }) => {
    const latestTickets = await appClient.entities.Ticket.list();
    return (
      latestTickets.find(
        (entry) =>
          normalizeTicketKind(entry) === "live_ops" &&
          String(entry.parent_ticket_id || "") === String(parentTicketId || "") &&
          normalizeLiveOperationType(entry.live_operation_type) === normalizeLiveOperationType(operationType) &&
          !isClosedStatus(entry.status)
      ) || null
    );
  };

  const createLiveOpsChildTicket = async ({
    parentTicket,
    operationType,
    split,
    target,
    notes,
    outcome,
    effortHours,
    assignedDeveloperId,
  }) => {
    const defaultSupervisor = resolveTechSupervisorDeveloper(client);
    const targetDeveloper = resolveActiveDeveloperById(assignedDeveloperId) || defaultSupervisor;
    if (!targetDeveloper) {
      throw new Error("Nessun developer configurato per la richiesta live.");
    }
    const normalizedEffort = normalizeEffortHours(effortHours);
    if (!normalizedEffort) {
      throw new Error("Effort non valido per creare la richiesta live.");
    }

    const existing = await getOpenLiveOpsTicketByType({
      parentTicketId: parentTicket.id,
      operationType,
    });
    if (existing) {
      throw new Error(`Esiste gia una richiesta aperta di ${getLiveOperationLabel(operationType).toLowerCase()}.`);
    }

    const referencePayload = buildReferenceLinksPayload(
      normalizeReferenceLinks(parentTicket.reference_links, parentTicket.link)
    );
    const operationLabel = getLiveOperationLabel(operationType);
    const nowIso = new Date().toISOString();
    const initialConfirmationStatus =
      normalizeLiveOperationType(operationType) === "launch"
        ? "pending"
        : normalizeLiveConfirmationStatus(
            parentTicket.live_confirmation_status,
            parentTicket.live_state
          );

    const liveOpsTicket = await appClient.entities.Ticket.create({
      title: `[Live Ops] ${operationLabel} · ${parentTicket.title}`,
      description:
        notes ||
        `Richiesta ${operationLabel.toLowerCase()} per ${parentTicket.title}`,
      required_tracking: parentTicket.required_tracking || "",
      ...referencePayload,
      client_id: parentTicket.client_id,
      client_name: parentTicket.client_name,
      type: "other",
      difficulty: parentTicket.difficulty || "medium",
      status: "new",
      assignee_id: targetDeveloper.id,
      assignee_name: targetDeveloper.name,
      assignee_email: targetDeveloper.email,
      proposed_effort: normalizedEffort,
      priority_score: Math.max(LIVE_SYSTEM_PRIORITY, getEffectivePriorityScore(parentTicket)),
      priority_override: LIVE_SYSTEM_PRIORITY,
      ticket_kind: "live_ops",
      parent_ticket_id: parentTicket.id,
      live_operation_type: normalizeLiveOperationType(operationType),
      live_split: split,
      live_target: target,
      live_notes: notes,
      live_test_outcome:
        normalizeLiveOperationType(operationType) === "stop"
          ? String(outcome || "").trim()
          : "",
      live_requested_at: nowIso,
      live_requested_by: user?.email || user?.full_name || "user",
      live_requested_by_id: user?.id || null,
      live_confirmation_status: initialConfirmationStatus,
      watchers: normalizeTicketWatchers(parentTicket),
      audit_log: [
        buildAuditEntry(
          "live_ops_created",
          `Task ${operationLabel.toLowerCase()} creata per ${targetDeveloper.name} (${normalizedEffort}h)`
        ),
      ],
    });

    const scheduledLiveOpsUpdates = await schedulePriorityInsertionBeforeNew({
      developer: targetDeveloper,
      ticketId: liveOpsTicket.id,
      insertBeforeNextActivity: true,
    });

    await notifyTicketAssigned({
      ticket: {
        ...liveOpsTicket,
        ...(scheduledLiveOpsUpdates || {}),
      },
      actor: user,
    }).catch(() => {});

    return {
      ...liveOpsTicket,
      ...(scheduledLiveOpsUpdates || {}),
    };
  };

  const completeLiveOpsTransition = async ({ statusOptions = {} } = {}) => {
    if (!isLiveOpsTicket) return;

    const parentTicket = mainTicketRecord;
    if (!parentTicket) {
      throw new Error("Ticket principale non trovato per completare la task live.");
    }

    const operationType = normalizeLiveOperationType(ticket.live_operation_type);
    const operationLabel = getLiveOperationLabel(operationType);
    const completedConfirmationStatus =
      operationType === "launch"
        ? "confirmed"
        : operationType === "stop"
          ? "not_confirmed"
          : normalizeLiveConfirmationStatus(
              ticket.live_confirmation_status,
              parentTicket.live_state
            );

    await finalizeStatusChange("done", {
      ...statusOptions,
      extraData: {
        live_completed_at: new Date().toISOString(),
        live_completed_by: user?.email || user?.full_name || "user",
        live_confirmation_status: completedConfirmationStatus,
      },
      auditAction: "live_ops_completed",
      auditDetails: `${operationLabel} completata`,
      suppressCompletionNotification: true,
    });

    const latestTickets = await appClient.entities.Ticket.list();
    const refreshedLiveOpsTicket =
      latestTickets.find((entry) => entry.id === ticket.id) ||
      {
        ...ticket,
        status: "done",
        live_completed_at: new Date().toISOString(),
        live_completed_by: user?.email || user?.full_name || "user",
        live_confirmation_status: completedConfirmationStatus,
      };
    const refreshedParent =
      latestTickets.find((entry) => entry.id === parentTicket.id) || parentTicket;

    const nextParentLiveState = LIVE_OPERATION_COMPLETED_STATE[operationType] || "not_live";
    const nextParentConfirmationStatus =
      operationType === "launch"
        ? "confirmed"
        : operationType === "stop"
          ? "not_confirmed"
          : normalizeLiveConfirmationStatus(
              refreshedLiveOpsTicket.live_confirmation_status,
              refreshedParent.live_state
            );

    await updateTicketWithAudit(
      refreshedParent.id,
      {
        live_state: nextParentLiveState,
        live_operation_type: operationType,
        live_split: refreshedLiveOpsTicket.live_split || "",
        live_target: refreshedLiveOpsTicket.live_target || "",
        live_notes: refreshedLiveOpsTicket.live_notes || "",
        live_completed_at: refreshedLiveOpsTicket.live_completed_at || new Date().toISOString(),
        live_completed_by: refreshedLiveOpsTicket.live_completed_by || user?.email || user?.full_name || "user",
        live_confirmation_status: nextParentConfirmationStatus,
      },
      "live_ops_completed",
      `${operationLabel} completata da ${user?.full_name || user?.email || "tech supervisor"}`
    );

    await notifyLiveOpsCompleted({
      ticket: refreshedParent,
      actor: user,
      client,
      operationType,
    }).catch(() => {});

    await queryClient.invalidateQueries({ queryKey: ["ticket", ticketId] });
    await queryClient.invalidateQueries({ queryKey: ["tickets"] });

    toast({
      title: `${operationLabel} completata`,
      description: "Il ticket principale e stato aggiornato.",
    });
  };

  const completePostPreviewChangeTransition = async ({ statusOptions = {} } = {}) => {
    if (!isPostPreviewChangeTicket) return;

    await finalizeStatusChange("done", {
      ...statusOptions,
      auditAction: "post_preview_change_completed",
      auditDetails: "Modifica post-preview completata",
      suppressCompletionNotification: true,
    });

    if (!mainTicketRecord) return;

    await updateTicketWithAudit(
      mainTicketRecord.id,
      {
        post_preview_completed_at: new Date().toISOString(),
        post_preview_completed_by: user?.email || user?.full_name || "user",
      },
      "post_preview_change_completed",
      `Modifica post-preview completata da ${user?.full_name || user?.email || "developer"}`
    );

    await notifyClientSupervisor({
      ticketOverride: mainTicketRecord,
      title: "Modifica post-preview completata",
      body: mainTicketRecord.title,
      metadata: {
        reason: "post_preview_change_completed",
        child_ticket_id: ticket.id,
      },
    });
  };

  const handleLiveOpsRequestSubmit = async () => {
    if (ticketKind !== "main") return;

    const operationType = normalizeLiveOperationType(liveOpsForm.operation_type);
    const isStopOperation = operationType === "stop";
    const split = isStopOperation ? "" : String(liveOpsForm.split || "").trim();
    const target = isStopOperation ? "" : String(liveOpsForm.target || "").trim();
    const notes = String(liveOpsForm.notes || "").trim();
    const outcome = String(liveOpsForm.outcome || "").trim();
    const normalizedEffort = normalizeEffortHours(liveOpsForm.effort_hours);
    const selectedDeveloper = resolveActiveDeveloperById(liveOpsForm.assignee_id);
    const validOutcomes = new Set(REPORT_OUTCOME_OPTIONS.map((option) => option.value));

    if (!normalizedEffort) {
      toast({
        variant: "destructive",
        title: "Effort non valido",
        description: "Inserisci un effort positivo prima di inviare la richiesta live.",
      });
      return;
    }
    if (!selectedDeveloper) {
      toast({
        variant: "destructive",
        title: "Developer obbligatorio",
        description: "Seleziona il developer assegnatario della task live.",
      });
      return;
    }
    if (!isStopOperation && (!split || !target)) {
      toast({
        variant: "destructive",
        title: "Campi obbligatori mancanti",
        description: "Inserisci split del traffico e target prima di inviare la richiesta live.",
      });
      return;
    }
    if (isStopOperation && !validOutcomes.has(outcome)) {
      toast({
        variant: "destructive",
        title: "Esito test obbligatorio",
        description: "Per richiedere lo spegnimento devi selezionare un esito test.",
      });
      return;
    }

    const currentLiveState = normalizeLiveState(ticket?.live_state);
    const canRequestLaunch = currentLiveState === "not_live" || currentLiveState === "stopped";
    const canRequestChangeOrStop = currentLiveState === "live";

    if (operationType === "launch" && !canRequestLaunch) {
      toast({
        variant: "destructive",
        title: "Messa live non disponibile",
        description: "Puoi richiedere la messa live solo se il test non e live o e stato spento.",
      });
      return;
    }
    if ((operationType === "change" || operationType === "stop") && !canRequestChangeOrStop) {
      toast({
        variant: "destructive",
        title: "Operazione non disponibile",
        description: "Modifica e spegnimento sono disponibili solo quando il test e live.",
      });
      return;
    }

    setSubmittingLiveOps(true);
    try {
      const liveOpsTicket = await createLiveOpsChildTicket({
        parentTicket: ticket,
        operationType,
        split,
        target,
        notes,
        outcome,
        effortHours: normalizedEffort,
        assignedDeveloperId: selectedDeveloper.id,
      });

      const requestedState = LIVE_OPERATION_REQUESTED_STATE[operationType] || "not_live";
      const requestedConfirmationStatus =
        operationType === "launch"
          ? "pending"
          : normalizeLiveConfirmationStatus(
              ticket?.live_confirmation_status,
              currentLiveState
            );
      await updateTicketWithAudit(
        ticket.id,
        {
          live_state: requestedState,
          live_operation_type: operationType,
          live_split: split,
          live_target: target,
          live_notes: notes,
          live_requested_at: new Date().toISOString(),
          live_requested_by: user?.email || user?.full_name || "user",
          live_requested_by_id: user?.id || null,
          live_confirmation_status: requestedConfirmationStatus,
          ...(isStopOperation ? { reported_outcome: outcome } : {}),
        },
        "live_ops_requested",
        `${getLiveOperationLabel(operationType)} richiesta da ${user?.full_name || user?.email || "analyst"} e assegnata a ${liveOpsTicket.assignee_name || "developer"} (${normalizedEffort}h)`
      );

      await queryClient.invalidateQueries({ queryKey: ["ticket", ticketId] });
      await queryClient.invalidateQueries({ queryKey: ["tickets"] });

      setLiveOpsDialog(false);
      if (isStopOperation) {
        setReportedOutcomeInput(outcome);
      }
      toast({
        title: `${getLiveOperationLabel(operationType)} richiesta`,
        description: `Task operativa creata nella pipeline di ${liveOpsTicket.assignee_name || "developer"}.`,
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Richiesta live non riuscita",
        description: error?.message || "Riprova tra qualche secondo.",
      });
    } finally {
      setSubmittingLiveOps(false);
    }
  };

  const openLiveOpsRequestDialog = (operationType) => {
    const normalizedType = normalizeLiveOperationType(operationType);
    const defaultAssignee = resolveTechSupervisorDeveloper(client);
    setLiveOpsForm({
      operation_type: normalizedType,
      split:
        normalizedType === "stop" ? "" : String(ticket?.live_split || "").trim(),
      target:
        normalizedType === "stop" ? "" : String(ticket?.live_target || "").trim(),
      notes: String(ticket?.live_notes || "").trim(),
      outcome: String(ticket?.reported_outcome || "").trim(),
      effort_hours: String(LIVE_OPS_EFFORT_HOURS),
      assignee_id: defaultAssignee?.id || "",
    });
    setLiveOpsDialog(true);
  };

  const openPostPreviewChangeDialog = () => {
    setPostPreviewNotes("");
    setPostPreviewEffortInput(String(POST_PREVIEW_CHANGE_EFFORT_HOURS));
    setPostPreviewAssigneeId(resolveTicketAssigneeDeveloper(ticket)?.id || "");
    setPostPreviewDialog(true);
  };

  const handleAssign = async (devId) => {
    const dev = developers.find(d => d.id === devId);
    if (!dev) return;
    if (devId === ticket.assignee_id) return;

    const normalizedCurrentStatus = normalizeTicketStatus(ticket?.status);
    if (normalizedCurrentStatus === "in_progress") {
      toast({
        variant: "destructive",
        title: "Cambio developer non consentito",
        description: "Un ticket in corso non puo essere spostato su un altro developer.",
      });
      return;
    }

    const previousAssigneeId = ticket.assignee_id;
    const previousAssigneeName =
      developers.find((developer) => developer.id === previousAssigneeId)?.name ||
      ticket.assignee_name ||
      "Non assegnato";
    const scheduledSegments = getTicketScheduleSegments(ticket);
    const scheduledHours = roundHalf(
      scheduledSegments.reduce((sum, segment) => sum + (segment.end - segment.start), 0)
    );
    const plannedEffort = getPlannedEffortHours(ticket);
    const preservedEffort = plannedEffort > 0 ? plannedEffort : scheduledHours;
    const shouldResetSchedule = !isClosedStatus(ticket?.status);

    const reassignmentPayload = {
      assignee_id: devId,
      assignee_name: dev.name,
      assignee_email: dev.email,
    };

    if (shouldResetSchedule) {
      Object.assign(reassignmentPayload, {
        scheduled_date: null,
        start_time: null,
        end_time: null,
        continuation_schedule: [],
      });

      if (preservedEffort > 0 && plannedEffort <= 0) {
        reassignmentPayload.proposed_effort = preservedEffort;
      }
    }

    await updateMutation.mutateAsync({
      data: reassignmentPayload,
      auditAction: "assigned",
      auditDetails: shouldResetSchedule
        ? `Assigned to ${dev.name}; schedule reset for full replanning`
        : `Assigned to ${dev.name}`,
    });

    if (devId !== previousAssigneeId) {
      await notifyTicketAssigned({
        ticket: {
          ...ticket,
          assignee_id: dev.id,
          assignee_name: dev.name,
          assignee_email: dev.email,
        },
        actor: user,
      }).catch(() => {});

      await notifyClientSupervisor({
        ticketOverride: {
          ...ticket,
          assignee_id: dev.id,
          assignee_name: dev.name,
          assignee_email: dev.email,
        },
        title: "Assignee ticket aggiornato",
        body: `${ticket.title} · ${previousAssigneeName} → ${dev.name}`,
        metadata: {
          reason: "ticket_assignee_updated",
        },
      });
    }

    // Send email notification
    appClient.integrations.Core.SendEmail({
      to: dev.email,
      subject: `Nuovo ticket assegnato: ${ticket.title}`,
      body: `Ciao ${dev.name},\n\nTi è stato assegnato un nuovo ticket:\n\nTitolo: ${ticket.title}\nCliente: ${ticket.client_name || "N/A"}\nDescrizione: ${ticket.description || "Nessuna descrizione"}\n\n${!getPlannedEffortHours(ticket) ? "Per favore inserisci l'effort previsto." : ""}\n\nGrazie!`,
    }).catch(() => {});

    if (previousAssigneeId) {
      await applyRebalanceForDevelopers([previousAssigneeId]);
    }

    await applyRebalanceForDevelopers(
      [devId],
      {
        preserveWorkingDaysFromToday: 3,
      }
    );
  };

  const handlePlannedEffort = async () => {
    const hours = parseFloat(plannedEffortInput);
    if (!hours || hours <= 0) return;
    const workedHours = getWorkedEffortHours(ticket);
    if (workedHours > 0 && hours < workedHours) {
      toast({
        variant: "destructive",
        title: "Effort inferiore al lavoro svolto",
        description: `Sono gia state registrate ${workedHours}h. Imposta un totale almeno pari alle ore lavorate.`,
      });
      return;
    }

    const client = clients.find(c => c.id === ticket.client_id);
    const newScore = calculatePriorityScore({ ...ticket, proposed_effort: hours }, client, config);

    const updates = {
      proposed_effort: hours,
      ...(workedHours > 0
        ? { remaining_effort_hours: roundHalf(Math.max(0, hours - workedHours)) }
        : {}),
      priority_score: newScore,
      planned_effort_locked: true,
    };

    await updateMutation.mutateAsync({
      data: updates,
      auditAction: "planned_effort_set",
      auditDetails: `Planned effort set to ${hours}h; weekly planning rebalanced`,
    });

    await notifyClientSupervisor({
      ticketOverride: { ...ticket, ...updates },
      title: "Effort previsto aggiornato",
      body: `${ticket.title} · ${hours}h`,
      metadata: {
        reason: "planned_effort_updated",
      },
    });

    const normalizedStatus = normalizeTicketStatus(ticket?.status);
    const currentScheduleSegments = getTicketScheduleSegments(ticket);
    const anchorSegment = currentScheduleSegments[0] || null;
    const rebalanceOptions = {
      ...(normalizedStatus === "in_progress"
        ? {
            allowInProgressReplan: true,
          }
        : {}),
      ...(anchorSegment
        ? {
            planningStartDate: anchorSegment.date,
            preserveWorkingDaysFromToday: 0,
            preserveExistingSequence: true,
            manualInsertionAnchor: {
              date: anchorSegment.date,
              start: anchorSegment.start,
            },
          }
        : {}),
    };

    await applyRebalanceForDevelopers([ticket.assignee_id], rebalanceOptions);

    // Notify ticket creator
    if (ticket.created_by) {
      appClient.integrations.Core.SendEmail({
        to: ticket.created_by,
        subject: `Stima effort inserita: ${ticket.title}`,
        body: `L'effort per il ticket "${ticket.title}" è stato stimato a ${hours} ore.`,
      }).catch(() => {});
    }

    setPlannedEffortInput("");
  };

  const handleActualEffort = async () => {
    const hours = parseFloat(actualEffortInput);
    if (!hours || hours <= 0) return;

    await updateMutation.mutateAsync({
      data: { effort_hours: hours },
      auditAction: "actual_effort_set",
      auditDetails: `Actual effort set to ${hours}h`,
    });

    await notifyClientSupervisor({
      ticketOverride: { ...ticket, effort_hours: hours },
      title: "Effort reale aggiornato",
      body: `${ticket.title} · ${hours}h`,
      metadata: {
        reason: "actual_effort_updated",
      },
    });

    if (isClosedStatus(ticket?.status) && ticket?.assignee_id) {
      await applyRebalanceForDevelopers(
        [ticket.assignee_id],
        {
          includeTodayHoles: true,
          planningStartDate: moment().format("YYYY-MM-DD"),
          freezeCurrentWeekSegments: false,
          preserveTodaySegments: false,
        }
      );
    }

    setActualEffortInput("");
  };

  const handleUrgencyRequest = async () => {
    if (!ticket?.id || submittingUrgency) return;
    if (ticket.urgent_requested_at) {
      toast({
        title: "Urgenza gia attiva",
        description: "Questo ticket e gia marcato come urgente.",
      });
      return;
    }

    const developer = resolveTicketAssigneeDeveloper(ticket);
    if (!developer?.id) {
      toast({
        variant: "destructive",
        title: "Assignee mancante",
        description: "Assegna il ticket a un developer prima di portarlo in urgenza.",
      });
      return;
    }

    const hasPlanningEffort =
      getPlannedEffortHours(ticket) > 0 ||
      getTicketScheduleSegments(ticket).length > 0;
    if (!hasPlanningEffort) {
      toast({
        variant: "destructive",
        title: "Effort mancante",
        description: "Inserisci l'effort previsto prima di ripianificare il ticket in urgenza.",
      });
      return;
    }

    setSubmittingUrgency(true);
    try {
      const scheduledUpdates = await schedulePriorityInsertionBeforeNew({
        developer,
        ticketId: ticket.id,
        insertBeforeNextActivity: true,
      });
      const nowIso = new Date().toISOString();
      const nextTicket = { ...ticket, ...(scheduledUpdates || {}) };
      const nextSegments = getTicketScheduleSegments(nextTicket);
      const firstSegment = nextSegments[0] || null;
      const firstSlotLabel = firstSegment
        ? `${firstSegment.date} ${decimalToTime(firstSegment.start)}-${decimalToTime(firstSegment.end)}`
        : "prima finestra utile";
      const urgencyPayload = {
        urgent_requested_at: nowIso,
        urgent_requested_by: user?.email || user?.full_name || "user",
        urgent_requested_by_id: user?.id || null,
        audit_log: [
          ...(ticket.audit_log || []),
          buildAuditEntry(
            "urgency_requested",
            `Urgenza pipeline richiesta; inserita in ${firstSlotLabel}`
          ),
        ],
      };

      await appClient.entities.Ticket.update(ticket.id, urgencyPayload);

      const assigneeUser = users.find(
        (candidate) =>
          normalizeText(candidate?.email) === normalizeText(developer.email || ticket.assignee_email)
      );
      if (assigneeUser?.id) {
        await createNotification({
          recipientId: assigneeUser.id,
          recipientEmail: assigneeUser.email,
          actor: user,
          type: "ticket_urgent",
          title: "Ticket portato in urgenza",
          body: `${ticket.title} · ${firstSlotLabel}`,
          ticket: { ...nextTicket, ...urgencyPayload },
          metadata: {
            reason: "ticket_urgent",
            scheduled_slot: firstSlotLabel,
          },
        }).catch(() => {});
      }

      await notifyClientSupervisor({
        ticketOverride: { ...nextTicket, ...urgencyPayload },
        title: "Ticket portato in urgenza",
        body: `${ticket.title} · ${firstSlotLabel}`,
        metadata: {
          reason: "ticket_urgent",
          assignee_id: developer.id,
          scheduled_slot: firstSlotLabel,
        },
      });

      await queryClient.invalidateQueries({ queryKey: ["ticket", ticketId] });
      await queryClient.invalidateQueries({ queryKey: ["tickets"] });
      toast({
        title: "Urgenza pianificata",
        description: `${ticket.title} inserito in ${firstSlotLabel}.`,
      });
    } finally {
      setSubmittingUrgency(false);
    }
  };

  const handleUrgencyClear = async () => {
    if (!ticket?.id || submittingUrgency) return;

    setSubmittingUrgency(true);
    try {
      const developer = resolveTicketAssigneeDeveloper(ticket);
      const urgencyPayload = {
        urgent_requested_at: null,
        urgent_requested_by: null,
        urgent_requested_by_id: null,
        audit_log: [
          ...(ticket.audit_log || []),
          buildAuditEntry("urgency_removed", "Urgenza pipeline rimossa"),
        ],
      };

      await appClient.entities.Ticket.update(ticket.id, urgencyPayload);

      if (ticket.assignee_id) {
        await applyRebalanceForDevelopers([ticket.assignee_id], {
          includeTodayHoles: true,
          planningStartDate: moment().format("YYYY-MM-DD"),
          freezeCurrentWeekSegments: false,
          preserveTodaySegments: false,
          preserveWorkingDaysFromToday: 0,
          preserveExistingSequence: false,
        });
      }

      const assigneeUser = users.find(
        (candidate) =>
          normalizeText(candidate?.email) === normalizeText(developer?.email || ticket.assignee_email)
      );
      if (assigneeUser?.id) {
        await createNotification({
          recipientId: assigneeUser.id,
          recipientEmail: assigneeUser.email,
          actor: user,
          type: "ticket_urgent",
          title: "Urgenza rimossa",
          body: ticket.title,
          ticket: { ...ticket, ...urgencyPayload },
          metadata: {
            reason: "ticket_urgency_removed",
          },
        }).catch(() => {});
      }

      await notifyClientSupervisor({
        ticketOverride: { ...ticket, ...urgencyPayload },
        title: "Urgenza ticket rimossa",
        body: ticket.title,
        metadata: {
          reason: "ticket_urgency_removed",
          assignee_id: ticket.assignee_id || null,
        },
      });

      await queryClient.invalidateQueries({ queryKey: ["ticket", ticketId] });
      await queryClient.invalidateQueries({ queryKey: ["tickets"] });
      toast({
        title: "Urgenza rimossa",
        description: `${ticket.title} torna alla pianificazione standard.`,
      });
    } finally {
      setSubmittingUrgency(false);
    }
  };

  const handleDeadlineSave = async () => {
    const normalizedDeadline = deadlineInput || null;
    const currentDeadline = ticket?.deadline || null;
    if (normalizedDeadline === currentDeadline) return;

    setSavingDeadline(true);
    try {
      const client = clients.find((c) => c.id === ticket.client_id);
      const nextScore = calculatePriorityScore(
        { ...ticket, deadline: normalizedDeadline },
        client,
        config
      );

      await updateMutation.mutateAsync({
        data: {
          deadline: normalizedDeadline,
          priority_score: nextScore,
        },
        auditAction: "deadline_updated",
        auditDetails: normalizedDeadline
          ? `Deadline set to ${normalizedDeadline}`
          : "Deadline removed",
      });

      await notifyClientSupervisor({
        ticketOverride: { ...ticket, deadline: normalizedDeadline, priority_score: nextScore },
        title: normalizedDeadline ? "Deadline ticket aggiornata" : "Deadline ticket rimossa",
        body: normalizedDeadline ? `${ticket.title} · ${normalizedDeadline}` : ticket.title,
        metadata: {
          reason: "deadline_updated",
        },
      });

      await applyRebalanceForDevelopers([ticket.assignee_id]);
    } finally {
      setSavingDeadline(false);
    }
  };

  const getNowInRome = () => {
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
    const decimalRaw = timeToDecimal(time);
    const decimalRoundedUp = Number.isFinite(decimalRaw)
      ? Math.min(DAY_END, ceilHalf(decimalRaw))
      : null;
    const roundedTime = Number.isFinite(decimalRoundedUp) ? decimalToTime(decimalRoundedUp) : time;

    return { date, time, decimal: decimalRaw, roundedTime, roundedDecimal: decimalRoundedUp };
  };

  const doStatusChange = async (newStatus, options = {}) => {
    const {
      overrideStartTime = null,
      completionMode = "now",
      completionDate = null,
      completionTime = null,
      extraData = {},
      auditAction = "status_change",
      auditDetails = "",
      remainingEffortHours = null,
    } = options;

    const nowInfo = getNowInRome();
    const nowTime = nowInfo.time;
    const previousStatus = normalizeTicketStatus(ticket.status);
    const isReactivatingFromBlocked =
      previousStatus === "blocked" &&
      newStatus !== "blocked" &&
      !isClosedStatus(newStatus);
    const clearMissingDataOnReactivation =
      isReactivatingFromBlocked && ticket?.missing_required_data === true;
    const reactivationData = clearMissingDataOnReactivation
      ? {
          missing_required_data: false,
          missing_required_data_reported_at: null,
          missing_required_data_reported_by: null,
          missing_required_data_reported_by_id: null,
          priority_override: null,
          priority_score: calculatePriorityScore(
            {
              ...ticket,
              status: newStatus,
              missing_required_data: false,
              priority_override: null,
            },
            client,
            config
          ),
        }
      : {};
    const timeData = {};
    const lifecycleData = {};
    let resolvedCompletionDateForRebalance = null;
    let resolvedCompletionTimeForRebalance = null;

    if (newStatus === "in_progress") {
      const latestTickets = await appClient.entities.Ticket.list();
      const activeInProgressTicket = findConcurrentInProgressTicket(ticket, latestTickets);
      if (activeInProgressTicket) {
        openInProgressBlockDialog(ticket, activeInProgressTicket);
        return false;
      }

      const selectedStartTime = overrideStartTime || ticket.start_time || nowTime;
      const movingToNow = selectedStartTime === nowTime;
      const selectedStartDate = movingToNow
        ? moment().format("YYYY-MM-DD")
        : ticket.scheduled_date || moment().format("YYYY-MM-DD");
      const dev = developers.find((d) => d.id === ticket.assignee_id);
      const normalizedRemainingEffort = normalizeEffortHours(remainingEffortHours);
      const workedEffort = getWorkedEffortHours(ticket);
      const isResumingWorkedTicket =
        workedEffort > 0 && ["blocked", "new"].includes(previousStatus);
      const effortToPlan = isResumingWorkedTicket
        ? Number(normalizedRemainingEffort || getRemainingEffortHours(ticket) || 0)
        : Number(getPlannedEffortHours(ticket) || 0);
      const selectedStartDecimal = timeToDecimal(selectedStartTime);
      const unavailableIntervals = getDeveloperUnavailableIntervalsByDate(dev)[selectedStartDate] || [];
      const hasStartConflict = unavailableIntervals.some(
        (interval) =>
          Number.isFinite(selectedStartDecimal) &&
          selectedStartDecimal >= interval.start &&
          selectedStartDecimal < interval.end
      );

      if (hasStartConflict) {
        toast({
          variant: "destructive",
          title: "Orario non disponibile",
          description: "Il ticket non puo iniziare in una fascia bloccata impostata in disponibilita.",
        });
        return false;
      }

      const splitSchedule = buildInProgressSchedule(
        selectedStartDate,
        selectedStartTime,
        effortToPlan,
        dev
      );
      const activeScheduleSegments = splitSchedule
        ? getTicketScheduleSegments(splitSchedule)
        : [];

      if (splitSchedule) {
        if (isResumingWorkedTicket) {
          Object.assign(
            timeData,
            schedulePayloadFromSegments([
              ...getWorkedScheduleSegments(ticket),
              ...activeScheduleSegments,
            ])
          );
        } else {
          Object.assign(timeData, splitSchedule);
        }
      } else {
        timeData.scheduled_date = selectedStartDate;
        timeData.start_time = selectedStartTime;
        timeData.end_time = null;
        timeData.continuation_schedule = [];
      }

      if (isResumingWorkedTicket) {
        const nextRemainingEffort = Number(normalizedRemainingEffort || effortToPlan);
        const nextPlannedEffort = roundHalf(workedEffort + nextRemainingEffort);
        Object.assign(lifecycleData, {
          proposed_effort: nextPlannedEffort,
          remaining_effort_hours: nextRemainingEffort,
          resumed_at: new Date().toISOString(),
          resumed_by: user?.email || user?.full_name || "user",
          resumed_by_id: user?.id || null,
          priority_score: calculatePriorityScore(
            {
              ...ticket,
              status: newStatus,
              missing_required_data: false,
              priority_override: null,
              proposed_effort: nextPlannedEffort,
            },
            client,
            config
          ),
        });
      }

      const candidateSegments = isResumingWorkedTicket
        ? activeScheduleSegments
        : getTicketScheduleSegments({
            ...ticket,
            ...timeData,
            status: newStatus,
          });
      if (candidateSegments.length > 0) {
        for (const segment of candidateSegments) {
          const conflict = checkScheduleConflict(
            latestTickets,
            ticket.assignee_id,
            getEffectivePriorityScore(ticket),
            segment.date,
            decimalToTime(segment.start),
            decimalToTime(segment.end),
            ticket.id,
            dev,
            { allowTicketReflow: true }
          );

          if (conflict.status !== "ok") {
            const suggestion = conflict.suggestedSchedule
              ? ` Slot libero suggerito: ${conflict.suggestedSchedule.date} ${conflict.suggestedSchedule.start_time}-${conflict.suggestedSchedule.end_time}.`
              : "";
            toast({
              variant: "destructive",
              title: "Slot gia occupato",
              description: `${conflict.message}${suggestion}`,
            });
            return false;
          }
        }
      }
    }
    if (newStatus === "blocked") {
      const pauseSnapshot = previousStatus === "in_progress"
        ? buildPauseScheduleSnapshot(ticket, nowInfo.date, nowInfo.roundedTime || nowInfo.time)
        : null;

      if (pauseSnapshot) {
        Object.assign(timeData, pauseSnapshot.schedule);
        Object.assign(lifecycleData, {
          worked_effort_hours: pauseSnapshot.workedEffort,
          remaining_effort_hours: pauseSnapshot.remainingEffort,
          paused_at: new Date().toISOString(),
          paused_by: user?.email || user?.full_name || "user",
          paused_by_id: user?.id || null,
          paused_from_status: previousStatus,
        });
      } else {
        timeData.scheduled_date = null;
        timeData.start_time = null;
        timeData.end_time = null;
        timeData.continuation_schedule = [];
      }
    }
    if (isReactivatingFromBlocked && newStatus !== "in_progress") {
      if (getWorkedEffortHours(ticket) <= 0) {
        timeData.scheduled_date = null;
        timeData.start_time = null;
        timeData.end_time = null;
        timeData.continuation_schedule = [];
      }
    }
    const isCompletionStatus = isClosedStatus(newStatus);
    const wasCompletionStatus = isTicketClosed(ticket);

    if (isCompletionStatus && !wasCompletionStatus) {
      const resolvedCompletionDate =
        completionMode === "planned" && completionDate
          ? completionDate
          : nowInfo.date;
      const resolvedCompletionTime =
        completionMode === "planned" && completionTime
          ? completionTime
          : (nowInfo.roundedTime || nowTime);
      resolvedCompletionDateForRebalance = resolvedCompletionDate;
      resolvedCompletionTimeForRebalance = resolvedCompletionTime;

      const doneSnapshot = buildDoneScheduleSnapshot(
        ticket,
        resolvedCompletionDate,
        resolvedCompletionTime
      );

      if (doneSnapshot) {
        Object.assign(timeData, doneSnapshot);
      } else {
        timeData.end_time = resolvedCompletionTime;
        timeData.continuation_schedule = [];
        const startT = ticket.start_time;
        if (startT) {
          const startDec = timeToDecimal(startT);
          const endDec = completionMode === "planned"
            ? timeToDecimal(resolvedCompletionTime)
            : (Number.isFinite(nowInfo.roundedDecimal)
                ? nowInfo.roundedDecimal
                : timeToDecimal(nowInfo.roundedTime));
          const diffH = Number.isFinite(startDec) && Number.isFinite(endDec)
            ? roundHalf(Math.max(0, endDec - startDec))
            : 0;
          if (diffH > 0) timeData.effort_hours = diffH;
        }
      }
    }

    const auditStartTime = timeData.start_time || null;
    const auditEndTime = isCompletionStatus
      ? (timeData.end_time || completionTime || nowInfo.roundedTime || nowTime)
      : (timeData.end_time || null);

    await updateMutation.mutateAsync({
      data: { status: newStatus, ...timeData, ...reactivationData, ...lifecycleData, ...extraData },
      auditAction,
      auditDetails:
        auditDetails ||
        `Status: ${normalizeTicketStatus(ticket.status)} → ${newStatus}${auditStartTime ? ` (start: ${auditStartTime})` : ""}${auditEndTime ? ` (end: ${auditEndTime})` : ""}`,
    });

    if (isReactivatingFromBlocked && ticket.assignee_id) {
      if (newStatus === "in_progress") {
        const anchorStart = timeToDecimal(timeData.start_time);
        await applyRebalanceForDevelopers([ticket.assignee_id], {
          freezeTicketIds: [ticket.id],
          preserveWorkingDaysFromToday: 0,
          preserveExistingSequence: true,
          includeTodayHoles: true,
          freezeCurrentWeekSegments: false,
          preserveTodaySegments: false,
          allowInProgressReplan: true,
          planningStartDate: timeData.scheduled_date || nowInfo.date,
          ...(Number.isFinite(anchorStart) && timeData.scheduled_date
            ? {
                manualInsertionAnchor: {
                  date: timeData.scheduled_date,
                  start: anchorStart,
                },
              }
            : {}),
        });
        return true;
      }

      const reactivationDeveloper = resolveTicketAssigneeDeveloper(ticket);
      if (reactivationDeveloper) {
        await schedulePriorityInsertionBeforeNew({
          developer: reactivationDeveloper,
          ticketId: ticket.id,
          insertBeforeNextActivity: true,
        });
        await queryClient.invalidateQueries({ queryKey: ["ticket", ticketId] });
        await queryClient.invalidateQueries({ queryKey: ["tickets"] });
        return true;
      }

      await applyRebalanceForDevelopers([ticket.assignee_id], {
        preserveWorkingDaysFromToday: 0,
        preserveExistingSequence: false,
        includeTodayHoles: true,
        freezeCurrentWeekSegments: false,
        preserveTodaySegments: false,
        preserveElapsedTodaySegments: true,
        allowInProgressReplan: true,
        forceFirstTicketIds: [ticket.id],
        planningStartDate: nowInfo.date,
        manualInsertionAnchor: {
          date: nowInfo.date,
          start: nowInfo.roundedDecimal ?? DAY_START,
        },
      });
      return true;
    }

    if (newStatus === "in_progress" && ticket.assignee_id) {
      const anchorStart = timeToDecimal(timeData.start_time);
      await applyRebalanceForDevelopers([ticket.assignee_id], {
        freezeTicketIds: [ticket.id],
        preserveWorkingDaysFromToday: 0,
        preserveExistingSequence: true,
        includeTodayHoles: true,
        freezeCurrentWeekSegments: false,
        preserveTodaySegments: false,
        allowInProgressReplan: true,
        planningStartDate: timeData.scheduled_date || nowInfo.date,
        ...(Number.isFinite(anchorStart) && timeData.scheduled_date
          ? {
              manualInsertionAnchor: {
                date: timeData.scheduled_date,
                start: anchorStart,
              },
            }
          : {}),
      });
      return true;
    }

    const rebalanceOptions = isCompletionStatus && !wasCompletionStatus
      ? (() => {
          if (completionMode === "planned") {
            return {
              preserveWorkingDaysFromToday: 3,
            };
          }

          const completionAnchor = timeToDecimal(resolvedCompletionTimeForRebalance);
          return {
            preserveWorkingDaysFromToday: 0,
            preserveExistingSequence: true,
            includeTodayHoles: true,
            freezeCurrentWeekSegments: false,
            preserveTodaySegments: false,
            planningStartDate: resolvedCompletionDateForRebalance || nowInfo.date,
            ...(Number.isFinite(completionAnchor) && resolvedCompletionDateForRebalance
              ? {
                  manualInsertionAnchor: {
                    date: resolvedCompletionDateForRebalance,
                    start: completionAnchor,
                  },
                }
              : {}),
          };
        })()
      : {};

    await applyRebalanceForDevelopers([ticket.assignee_id], rebalanceOptions);
    return true;
  };

  const finalizeStatusChange = async (newStatus, options = {}) => {
    const updated = await doStatusChange(newStatus, options);
    if (updated === false) return false;

    await notifyClientSupervisor({
      ticketOverride: { ...ticket, status: newStatus },
      title: "Stato ticket aggiornato",
      body: `${ticket.title} · ${STATUS_CONFIG[newStatus]?.label || newStatus}`,
      metadata: {
        reason: "status_updated",
        status: newStatus,
      },
    });

    if (isClosedStatus(newStatus) && ticket.created_by && !options.suppressCompletionNotification) {
      await notifyTicketDone({
        ticket,
        actor: user,
      }).catch(() => {});

      appClient.integrations.Core.SendEmail({
        to: ticket.created_by,
        subject: `Ticket concluso: ${ticket.title}`,
        body: `Il ticket "${ticket.title}" è stato concluso con stato ${newStatus}.`,
      }).catch(() => {});
    }

    return true;
  };

  const handleStatusChange = async (newStatus) => {
    if (newStatus === "in_progress") {
      const activeInProgressTicket = findConcurrentInProgressTicket(ticket);
      if (activeInProgressTicket) {
        openInProgressBlockDialog(ticket, activeInProgressTicket);
        return;
      }
    }

    if (newStatus === "qa_review" && ticketKind === "main") {
      const existingPreviewLinks = resolveQaPreviewEntries(ticket);
      setQaRequestForm({
        preview_links:
          existingPreviewLinks.length > 0
            ? existingPreviewLinks
            : [{ title: "", url: "" }],
        review_notes: ticket?.qa_review_notes || "",
        test_instructions: ticket?.qa_test_instructions || "",
      });
      setQaRequestDialog(true);
      return;
    }

    if (ticketKind === "live_ops" && newStatus === "done") {
      const conflict = getCompletionConflictData("done");
      if (conflict) {
        setDoneConflict({
          ...conflict,
          liveOpsComplete: true,
        });
        return;
      }

      await completeLiveOpsTransition();
      return;
    }

    if (
      newStatus === "in_progress" &&
      ["blocked", "new"].includes(normalizeTicketStatus(ticket.status)) &&
      getWorkedEffortHours(ticket) > 0
    ) {
      const workedEffort = getWorkedEffortHours(ticket);
      const remainingEffort = getRemainingEffortHours(ticket);
      setResumeRemainingInput(String(remainingEffort > 0 ? remainingEffort : 0.5));
      setResumePauseDialog({ workedEffort, remainingEffort });
      return;
    }

    // When moving to in_progress, check if current time differs from planned start_time
    if (newStatus === "in_progress" && ticket.start_time) {
      const nowTime = getNowInRome().time;
      if (nowTime !== ticket.start_time) {
        // Show conflict dialog
        setInProgressConflict({ nowTime, plannedTime: ticket.start_time });
        return;
      }
    }

    if (isClosedStatus(newStatus) && !isTicketClosed(ticket)) {
      const conflict = getCompletionConflictData(newStatus);
      if (conflict) {
        setDoneConflict(conflict);
        return;
      }
    }

    if (ticketKind === "qa_fix" && newStatus === "done") {
      const conflict = getCompletionConflictData("done");
      if (conflict) {
        setDoneConflict({
          ...conflict,
          qaFixReopenReview: true,
        });
        return;
      }

      await completeQaFixAndRestartReview();
      return;
    }

    if (ticketKind === "post_preview_change" && newStatus === "done") {
      const conflict = getCompletionConflictData("done");
      if (conflict) {
        setDoneConflict({
          ...conflict,
          postPreviewChangeComplete: true,
        });
        return;
      }

      await completePostPreviewChangeTransition();
      return;
    }

    await finalizeStatusChange(newStatus);
  };

  const updateQaRequestPreviewLink = (index, field, value) => {
    setQaRequestForm((prev) => ({
      ...prev,
      preview_links: (prev.preview_links || []).map((link, linkIndex) =>
        linkIndex === index ? { ...link, [field]: value } : link
      ),
    }));
  };

  const addQaRequestPreviewLink = () => {
    setQaRequestForm((prev) => ({
      ...prev,
      preview_links: [...(prev.preview_links || []), { title: "", url: "" }],
    }));
  };

  const removeQaRequestPreviewLink = (index) => {
    setQaRequestForm((prev) => {
      const nextLinks = (prev.preview_links || []).filter(
        (_, linkIndex) => linkIndex !== index
      );
      return {
        ...prev,
        preview_links:
          nextLinks.length > 0 ? nextLinks : [{ title: "", url: "" }],
      };
    });
  };

  const handleQaRequestSubmit = async () => {
    const normalizedPreviews = normalizeQaPreviewEntries(qaRequestForm.preview_links);
    if (normalizedPreviews.length === 0) {
      toast({
        variant: "destructive",
        title: "Preview obbligatoria",
        description: "Inserisci almeno una preview da controllare prima di inviare il ticket in QA.",
      });
      return;
    }

    const qaPayload = {
      preview_links: normalizedPreviews,
      preview_urls: normalizedPreviews.map((entry) => entry.url),
      preview_url: normalizedPreviews[0].url,
      review_notes: String(qaRequestForm.review_notes || "").trim(),
      test_instructions: String(qaRequestForm.test_instructions || "").trim(),
    };

    const conflict = getCompletionConflictData("qa_review");
    if (conflict) {
      setDoneConflict({
        ...conflict,
        qaPayload,
      });
      setQaRequestDialog(false);
      return;
    }

    setSubmittingQaRequest(true);
    try {
      await completeQaReviewTransition({ qaPayload });
      setQaRequestDialog(false);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Invio in QA non riuscito",
        description: error?.message || "Riprova tra qualche secondo.",
      });
    } finally {
      setSubmittingQaRequest(false);
    }
  };

  const handleApproveQaReview = async () => {
    if (ticketKind !== "qa_review") return;

    const sourceTicket = qaSourceTicketRecord;
    const parentTicket = mainTicketRecord;
    if (!sourceTicket || !parentTicket) {
      toast({
        variant: "destructive",
        title: "Review non collegata",
        description: "Non riesco a risalire al ticket originale da approvare.",
      });
      return;
    }

    setSubmittingQaDecision(true);
    try {
      await updateMutation.mutateAsync({
        data: {
          status: "done",
          qa_review_outcome: "approved",
          qa_cycle: getQaCycleValue(ticket) || resolveQaCycle(sourceTicket, parentTicket),
          qa_review_resolved_at: new Date().toISOString(),
          qa_review_resolved_by: user?.email || user?.full_name || "user",
        },
        auditAction: "qa_review_approved",
        auditDetails: `Review QA approvata per ${sourceTicket.title}`,
      });

      await updateTicketWithAudit(
        sourceTicket.id,
        {
          status: "done",
          qa_review_outcome: "approved",
          qa_reject_notes: "",
        },
        "qa_review_approved",
        "Ticket approvato dal tech supervisor"
      );

      if (parentTicket.id !== sourceTicket.id) {
        await updateTicketWithAudit(
          parentTicket.id,
          {
            status: "done",
            qa_review_outcome: "approved",
            qa_reject_notes: "",
          },
          "qa_review_approved",
          "Ticket principale approvato dopo review QA"
        );
      }

      await notifyClientSupervisor({
        ticketOverride: { ...parentTicket, status: "done" },
        title: "Preview approvata",
        body: `${parentTicket.title} · review completata`,
        metadata: {
          reason: "qa_review_approved",
        },
      });

      await notifyQaReviewApproved({
        ticket: parentTicket,
        actor: user,
        client,
      }).catch(() => {});

      await queryClient.invalidateQueries({ queryKey: ["ticket", ticketId] });
      await queryClient.invalidateQueries({ queryKey: ["tickets"] });

      toast({
        title: "Preview approvata",
        description: "Il ticket e stato portato in Done.",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Approvazione non riuscita",
        description: error?.message || "Riprova tra qualche secondo.",
      });
    } finally {
      setSubmittingQaDecision(false);
    }
  };

  const handleRejectQaReview = async () => {
    if (ticketKind !== "qa_review") return;

    const normalizedRejectNotes = String(qaRejectNotes || "").trim();
    if (!normalizedRejectNotes) {
      toast({
        variant: "destructive",
        title: "Specifica cosa va fixato",
        description: "Inserisci le indicazioni da correggere prima di rifiutare la preview.",
      });
      return;
    }

    const sourceTicket = qaSourceTicketRecord;
    const parentTicket = mainTicketRecord;
    if (!sourceTicket || !parentTicket) {
      toast({
        variant: "destructive",
        title: "Review non collegata",
        description: "Non riesco a risalire al ticket originale da rimettere in lavorazione.",
      });
      return;
    }

    setSubmittingQaDecision(true);
    try {
      await updateMutation.mutateAsync({
        data: {
          status: "done",
          qa_review_outcome: "rejected",
          qa_cycle: getQaCycleValue(ticket) || resolveQaCycle(sourceTicket, parentTicket),
          qa_reject_notes: normalizedRejectNotes,
          qa_review_resolved_at: new Date().toISOString(),
          qa_review_resolved_by: user?.email || user?.full_name || "user",
        },
        auditAction: "qa_review_rejected",
        auditDetails: "Preview rifiutata; creato ticket di QA fix",
      });

      await updateTicketWithAudit(
        parentTicket.id,
        { status: "qa_review", qa_reject_notes: normalizedRejectNotes },
        "qa_review_rejected",
        "Preview rifiutata dal tech supervisor"
      );

      await createQaFixChildTicket({
        sourceTicket,
        parentTicket,
        rejectNotes: normalizedRejectNotes,
        qaCycle: resolveQaCycle(sourceTicket, parentTicket),
      });

      await notifyClientSupervisor({
        ticketOverride: { ...parentTicket, status: "qa_review" },
        title: "Preview rifiutata",
        body: `${parentTicket.title} · creato ticket di fix`,
        metadata: {
          reason: "qa_review_rejected",
        },
      });

      await notifyQaReviewRejected({
        ticket: parentTicket,
        actor: user,
        client,
        developerEmail: sourceTicket.assignee_email || "",
      }).catch(() => {});

      setQaRejectDialog(false);
      setQaRejectNotes("");
      await queryClient.invalidateQueries({ queryKey: ["ticket", ticketId] });
      await queryClient.invalidateQueries({ queryKey: ["tickets"] });

      toast({
        title: "Preview rifiutata",
        description: "Il fix e stato inserito nella pipeline del developer.",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Rifiuto non riuscito",
        description: error?.message || "Riprova tra qualche secondo.",
      });
    } finally {
      setSubmittingQaDecision(false);
    }
  };

  const handlePostPreviewChangeSubmit = async () => {
    if (ticketKind !== "main") return;

    const normalizedNotes = String(postPreviewNotes || "").trim();
    if (!normalizedNotes) {
      toast({
        variant: "destructive",
        title: "Indicazioni obbligatorie",
        description: "Inserisci cosa va modificato prima di creare la task.",
      });
      return;
    }

    const normalizedEffort = normalizeEffortHours(postPreviewEffortInput);
    const selectedDeveloper = resolveActiveDeveloperById(postPreviewAssigneeId);
    if (!normalizedEffort) {
      toast({
        variant: "destructive",
        title: "Effort non valido",
        description: "Inserisci un effort positivo prima di creare la task.",
      });
      return;
    }
    if (!selectedDeveloper) {
      toast({
        variant: "destructive",
        title: "Developer obbligatorio",
        description: "Seleziona il developer assegnatario della modifica.",
      });
      return;
    }

    setSubmittingPostPreviewChange(true);
    try {
      const changeTicket = await createPostPreviewChangeChildTicket({
        parentTicket: ticket,
        changeNotes: normalizedNotes,
        effortHours: normalizedEffort,
        assignedDeveloperId: selectedDeveloper.id,
      });

      await updateTicketWithAudit(
        ticket.id,
        {
          post_preview_requested_at: new Date().toISOString(),
          post_preview_requested_by: user?.email || user?.full_name || "user",
          post_preview_requested_by_id: user?.id || null,
          post_preview_last_child_ticket_id: changeTicket.id,
          post_preview_notes: normalizedNotes,
        },
        "post_preview_change_requested",
        `Modifica post-preview richiesta e assegnata a ${changeTicket.assignee_name || "developer"} (${normalizedEffort}h)`
      );

      await notifyClientSupervisor({
        ticketOverride: {
          ...ticket,
          post_preview_last_child_ticket_id: changeTicket.id,
          post_preview_notes: normalizedNotes,
        },
        title: "Modifica post-preview richiesta",
        body: `${ticket.title} · task assegnata a ${changeTicket.assignee_name || "developer"} (${normalizedEffort}h)`,
        metadata: {
          reason: "post_preview_change_requested",
          child_ticket_id: changeTicket.id,
        },
      });

      await queryClient.invalidateQueries({ queryKey: ["ticket", ticketId] });
      await queryClient.invalidateQueries({ queryKey: ["tickets"] });

      setPostPreviewDialog(false);
      setPostPreviewNotes("");
      setPostPreviewEffortInput(String(POST_PREVIEW_CHANGE_EFFORT_HOURS));
      setPostPreviewAssigneeId(resolveTicketAssigneeDeveloper(ticket)?.id || "");
      toast({
        title: "Modifica post-preview creata",
        description: `La task e stata inserita nella pipeline di ${changeTicket.assignee_name || "developer"}.`,
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Creazione modifica non riuscita",
        description: error?.message || "Riprova tra qualche secondo.",
      });
    } finally {
      setSubmittingPostPreviewChange(false);
    }
  };

  const handleComment = async () => {
    if (!comment.trim()) return;
    const mentionedUserTokens = extractMentionedUserTokens(comment);
    const mentionedUserIds = mentionedUserTokens.filter((value) => !String(value).includes("@"));
    const mentionedUserEmails = mentionedUserTokens.filter((value) => String(value).includes("@"));
    const newComment = {
      comment_id:
        globalThis.crypto?.randomUUID?.() ||
        `comment_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      timestamp: new Date().toISOString(),
      user_id: user?.id || "",
      user: user?.email || user?.full_name || "user",
      email: user?.email || "",
      text: comment,
    };
    const updatedTicket = await updateTicketComments((currentComments) => [
      ...currentComments,
      newComment,
    ]);

    await notifyTicketComment({
      ticket: updatedTicket,
      actor: user,
      commentText: newComment.text,
      extraRecipientEmails: mentionedUserEmails,
      extraRecipientIds: mentionedUserIds,
      client,
    }).catch(() => {});

    setComment("");
  };

  const canDeleteComment = (commentEntry) => {
    if (!commentEntry || !user) return false;
    if (commentEntry.user_id && user.id) {
      return String(commentEntry.user_id) === String(user.id);
    }

    const commentEmail = normalizeText(commentEntry.email || commentEntry.user);
    return Boolean(
      (normalizedUserEmail && commentEmail === normalizedUserEmail) ||
      (normalizedUserName && commentEmail === normalizedUserName)
    );
  };

  const canEditComment = (commentEntry) => canDeleteComment(commentEntry);

  const startEditingComment = (commentIndex) => {
    const existingComments = Array.isArray(ticket?.comments) ? ticket.comments : [];
    const targetComment = existingComments[commentIndex];
    if (!targetComment || !canEditComment(targetComment)) return;

    setEditingCommentIndex(commentIndex);
    setEditingCommentText(String(targetComment.text || ""));
  };

  const cancelEditingComment = () => {
    setEditingCommentIndex(null);
    setEditingCommentText("");
  };

  const handleSaveEditedComment = async (commentIndex) => {
    const existingComments = Array.isArray(ticket?.comments) ? ticket.comments : [];
    const targetComment = existingComments[commentIndex];
    const nextText = String(editingCommentText || "").trim();

    if (!targetComment || !canEditComment(targetComment) || !nextText) return;

    const previousText = String(targetComment.text || "").trim();
    if (nextText === previousText) {
      cancelEditingComment();
      return;
    }

    await updateTicketComments(
      (currentComments) => {
        const targetIndex = findMatchingCommentIndex(currentComments, targetComment);
        if (targetIndex < 0) {
          throw new Error("Commento non trovato. Ricarica il ticket e riprova.");
        }

        return currentComments.map((entry, index) =>
          index === targetIndex
            ? {
                ...entry,
                text: nextText,
                edited_at: new Date().toISOString(),
                edited_by: user?.email || user?.full_name || "user",
              }
            : entry
        );
      },
      "comment_updated",
      "Commento modificato"
    );

    cancelEditingComment();
    toast({
      title: "Commento aggiornato",
      description: "Le modifiche al commento sono state salvate.",
    });
  };

  const handleDeleteComment = async (commentIndex) => {
    const existingComments = Array.isArray(ticket?.comments) ? ticket.comments : [];
    const targetComment = existingComments[commentIndex];
    if (!targetComment || !canDeleteComment(targetComment)) return;

    await updateTicketComments(
      (currentComments) => {
        const targetIndex = findMatchingCommentIndex(currentComments, targetComment);
        if (targetIndex < 0) {
          throw new Error("Commento non trovato. Ricarica il ticket e riprova.");
        }

        return currentComments.filter((_, index) => index !== targetIndex);
      },
      "comment_deleted",
      "Commento rimosso"
    );

    toast({
      title: "Commento eliminato",
      description: "Il commento e stato rimosso correttamente.",
    });
  };

  const insertCommentFormatting = (format) => {
    const textarea = commentTextareaRef.current;
    const currentValue = comment || "";
    const start = textarea?.selectionStart ?? currentValue.length;
    const end = textarea?.selectionEnd ?? currentValue.length;
    const selectedText = currentValue.slice(start, end);

    let nextChunk = "";
    let nextSelectionStart = start;
    let nextSelectionEnd = start;

    if (format === "bold") {
      const base = selectedText || "testo";
      nextChunk = `**${base}**`;
      nextSelectionStart = start + 2;
      nextSelectionEnd = start + 2 + base.length;
    } else if (format === "italic") {
      const base = selectedText || "testo";
      nextChunk = `*${base}*`;
      nextSelectionStart = start + 1;
      nextSelectionEnd = start + 1 + base.length;
    } else if (format === "link") {
      if (/^https?:\/\//i.test(selectedText.trim())) {
        nextChunk = `<${selectedText.trim()}>`;
        nextSelectionStart = start + 1;
        nextSelectionEnd = start + 1 + selectedText.trim().length;
      } else {
        nextChunk = selectedText ? `[${selectedText}](https://)` : `[link utile](https://)`;
        const urlOffset = nextChunk.indexOf("https://");
        nextSelectionStart = start + urlOffset;
        nextSelectionEnd = start + urlOffset + "https://".length;
      }
    } else if (format === "list") {
      nextChunk = selectedText
        ? selectedText
            .split("\n")
            .map((line) => (line.trim() ? `- ${line}` : line))
            .join("\n")
        : "- ";
      nextSelectionStart = start;
      nextSelectionEnd = start + nextChunk.length;
    }

    const nextValue = `${currentValue.slice(0, start)}${nextChunk}${currentValue.slice(end)}`;
    setComment(nextValue);

    requestAnimationFrame(() => {
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(nextSelectionStart, nextSelectionEnd);
    });
  };

  const insertCommentMention = (target) => {
    if (!target?.name) return;

    const textarea = commentTextareaRef.current;
    const currentValue = comment || "";
    const start = textarea?.selectionStart ?? currentValue.length;
    const end = textarea?.selectionEnd ?? currentValue.length;
    const mentionTarget = String(target.email || target.id || "").trim();
    if (!mentionTarget) return;
    const mentionText = `[@${target.name}](mention:${mentionTarget}) `;
    const nextValue = `${currentValue.slice(0, start)}${mentionText}${currentValue.slice(end)}`;
    const nextCursor = start + mentionText.length;

    setComment(nextValue);

    requestAnimationFrame(() => {
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const handleDelete = async () => {
    const assigneeId = ticket?.assignee_id;
    setDeleting(true);
    try {
      await appClient.entities.Ticket.delete(ticketId);
      await applyRebalanceForDevelopers([assigneeId]);
      window.location.href = createPageUrl(getHomePageForRole(user?.role));
    } finally {
      setDeleting(false);
    }
  };

  const suggested = suggestAssignment(developers, tickets);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500">Ticket not found</p>
        <Link to={backContext.url} className="text-sm text-blue-600 mt-2 inline-block">← {backContext.label}</Link>
      </div>
    );
  }

  const effectivePriority = getEffectivePriorityScore(ticket);
  const plannedEffort = getPlannedEffortHours(ticket);
  const actualEffort = getActualEffortHours(ticket);
  const workedEffort = getWorkedEffortHours(ticket);
  const remainingEffort = getRemainingEffortHours(ticket);
  const priorityPaused = isPriorityPaused(ticket);
  const ticketBlocked = isTicketBlocked(ticket);
  const scheduleSlipCount = Number(ticket.schedule_slip_count) || 0;
  const priority = getPriorityLevel(effectivePriority);
  const normalizedStatus = getTicketWorkflowStatus(ticket);
  const status = STATUS_CONFIG[normalizedStatus] || STATUS_CONFIG.new;
  const type = TYPE_CONFIG[ticket.type] || TYPE_CONFIG.other;
  const diff = DIFFICULTY_CONFIG[ticket.difficulty] || DIFFICULTY_CONFIG.medium;
  const client = clients.find((c) => c.id === ticket.client_id) || null;

  const normalizedUserEmail = normalizeText(user?.email);
  const normalizedUserName = normalizeText(user?.full_name);
  const normalizedTicketAssigneeEmail = normalizeText(ticket?.assignee_email);
  const normalizedTicketAssigneeName = normalizeText(ticket?.assignee_name);
  const isCurrentAssignee =
    Boolean(normalizedUserEmail) && normalizedTicketAssigneeEmail === normalizedUserEmail;
  const loggedDeveloperProfile =
    developers.find((developer) => normalizeText(developer?.email) === normalizedUserEmail) || null;
  const isAssignedDeveloper = isDeveloper && isCurrentAssignee;
  const isClientTechSupervisor = (() => {
    if (!isTechSupervisor || !client) return false;
    if (loggedDeveloperProfile?.id && client.tech_supervisor_id === loggedDeveloperProfile.id) return true;

    const normalizedSupervisor = normalizeText(client.tech_supervisor_name);
    const normalizedDeveloperName = normalizeText(loggedDeveloperProfile?.name);
    return Boolean(
      normalizedSupervisor &&
      (
        normalizedSupervisor === normalizedUserEmail ||
        normalizedSupervisor === normalizedUserName ||
        normalizedSupervisor === normalizedDeveloperName
      )
    );
  })();
  const isOperationsTicket = (() => {
    if (isQaReviewTicket || isLiveOpsTicket) return false;
    if (!client) return false;
    if (ticket.assignee_id && (client.operations_ids || []).includes(ticket.assignee_id)) return true;

    return (client.operations_names || []).some((entry) => {
      const normalizedEntry = normalizeText(entry);
      return Boolean(
        normalizedEntry &&
        (normalizedEntry === normalizedTicketAssigneeEmail || normalizedEntry === normalizedTicketAssigneeName)
      );
    });
  })();
  const canManageAsTechSupervisor = isClientTechSupervisor && isOperationsTicket;
  const canManageLiveOps = isLiveOpsTicket && (isAdmin || isCurrentAssignee);
  const canResolveQaReview =
    isQaReviewTicket && (isAdmin || isClientTechSupervisor);
  const canEditTimes = !isQaReviewTicket && (
    isAdmin ||
    (!isLiveOpsTicket && (isAnalyst || canManageAsTechSupervisor || isAssignedDeveloper))
  );
  const canEditDetails = !isQaReviewTicket && !isLiveOpsTicket && (isAdmin || isAnalyst || canManageAsTechSupervisor);
  const canChangeStatus = isLiveOpsTicket
    ? canManageLiveOps
    : !isQaReviewTicket && (isAdmin || isAnalyst || canManageAsTechSupervisor || isAssignedDeveloper);
  const canReassignTicket = !isQaReviewTicket && !isLiveOpsTicket && (isAdmin || isAnalyst || canManageAsTechSupervisor);
  const canEditDeadline = !isLiveOpsTicket && (isAdmin || isAnalyst || canManageAsTechSupervisor);
  const canEditPlannedEffort = !isLiveOpsTicket && (isAdmin || isAnalyst || canManageAsTechSupervisor || isAssignedDeveloper);
  const canEditActualEffort =
    isTicketClosed(ticket) &&
    (
      isAdmin ||
      (isLiveOpsTicket
        ? canManageLiveOps
        : (isAnalyst || canManageAsTechSupervisor || isAssignedDeveloper))
    );
  const hasUrgencyPlanningEffort =
    plannedEffort > 0 || getTicketScheduleSegments(ticket).length > 0;
  const isUrgent = Boolean(ticket?.urgent_requested_at);
  const canManageUrgency =
    !isQaReviewTicket &&
    !isTicketClosed(ticket) &&
    (isUrgent || !ticketBlocked) &&
    (isAdmin || isAnalyst || canManageAsTechSupervisor || isAssignedDeveloper || canManageLiveOps);
  const urgencyDisabledReason = isUrgent
    ? ""
    : normalizeTicketStatus(ticket.status) === "in_progress"
      ? "Un ticket gia in corso non va portato in urgenza: e gia la task corrente."
      : !ticket.assignee_id
        ? "Assegna un developer prima di portarlo in urgenza."
        : !hasUrgencyPlanningEffort
          ? "Inserisci l'effort previsto prima di portarlo in urgenza."
          : "";
  const clientTeamCommentTargets = (() => {
    if (!client) return [];

    const byKey = new Map();
    const addTarget = ({ userId = "", name = "", email = "", role = "" }) => {
      const resolvedName = String(name || email || "").trim();
      const resolvedEmail = String(email || "").trim();
      const resolvedId = String(userId || "").trim();
      if (!resolvedName && !resolvedEmail && !resolvedId) return;
      const normalizedEmail = resolvedEmail.toLowerCase();
      const normalizedName = resolvedName.toLowerCase();
      const existingKey = [...byKey.entries()].find(([, existing]) => {
        const existingId = String(existing?.id || "").trim();
        const existingEmail = String(existing?.email || "").trim().toLowerCase();
        const existingName = String(existing?.name || "").trim().toLowerCase();
        return Boolean(
          (resolvedId && existingId === resolvedId) ||
          (normalizedEmail && existingEmail === normalizedEmail) ||
          (normalizedName && existingName === normalizedName)
        );
      })?.[0];
      const mapKey = existingKey || resolvedId || normalizedEmail || normalizedName;
      if (!mapKey) return;
      const previous = byKey.get(mapKey);
      byKey.set(mapKey, {
        id: previous?.id || resolvedId,
        name: previous?.name || resolvedName,
        email: previous?.email || resolvedEmail,
        role: previous?.role || role,
      });
    };

    const supervisor = developers.find((developer) => developer.id === client.tech_supervisor_id);
    if (supervisor) {
      addTarget({
        userId: supervisor.user_id,
        name: supervisor.name,
        email: supervisor.email,
        role: "Tech supervisor",
      });
    } else if (client.tech_supervisor_name || client.tech_supervisor_email) {
      const matchedUser = users.find((candidate) => {
        const candidateEmail = normalizeText(candidate?.email);
        const candidateName = normalizeText(candidate?.full_name);
        return (
          (client.tech_supervisor_email && candidateEmail === normalizeText(client.tech_supervisor_email)) ||
          (client.tech_supervisor_name && candidateName === normalizeText(client.tech_supervisor_name))
        );
      });
      addTarget({
        userId: matchedUser?.id || "",
        name: client.tech_supervisor_name || matchedUser?.full_name || "",
        email: client.tech_supervisor_email || matchedUser?.email || "",
        role: "Tech supervisor",
      });
    }

    developers
      .filter((developer) => {
        if ((client.operations_ids || []).includes(developer.id)) return true;
        const normalizedDeveloperEmail = normalizeText(developer?.email);
        const normalizedDeveloperName = normalizeText(developer?.name);
        return (client.operations_names || []).some((entry) => {
          const normalizedEntry = normalizeText(entry);
          return Boolean(
            normalizedEntry &&
            (normalizedEntry === normalizedDeveloperEmail || normalizedEntry === normalizedDeveloperName)
          );
        });
      })
      .forEach((developer) => {
        addTarget({
          userId: developer.user_id,
          name: developer.name,
          email: developer.email,
          role: "Operations",
        });
      });

    users
      .filter((candidate) => {
        if ((client.analyst_team_ids || []).includes(candidate.id)) return true;
        const candidateEmail = normalizeText(candidate?.email);
        const candidateName = normalizeText(candidate?.full_name);
        return (client.analyst_team_names || []).some((entry) => {
          const normalizedEntry = normalizeText(entry);
          return Boolean(
            normalizedEntry &&
            (normalizedEntry === candidateEmail || normalizedEntry === candidateName)
          );
        });
      })
      .forEach((candidate) => {
        addTarget({
          userId: candidate.id,
          name: candidate.full_name || candidate.email,
          email: candidate.email,
          role: "Analyst",
        });
      });

    return [...byKey.values()]
      .filter((target) => Boolean(target.name || target.email))
      .sort((a, b) => a.name.localeCompare(b.name, "it"));
  })();
  const assignableDevelopers = canManageAsTechSupervisor && !(isAdmin || isAnalyst)
    ? developers.filter((developer) => {
        if (developer?.active === false) return false;
        if ((client?.operations_ids || []).includes(developer.id)) return true;
        const normalizedDeveloperEmail = normalizeText(developer?.email);
        const normalizedDeveloperName = normalizeText(developer?.name);
        return (client?.operations_names || []).some((entry) => {
          const normalizedEntry = normalizeText(entry);
          return Boolean(
            normalizedEntry &&
            (normalizedEntry === normalizedDeveloperEmail || normalizedEntry === normalizedDeveloperName)
          );
        });
      })
    : developers.filter((developer) => developer.active !== false);
  const postPreviewAssignableDevelopers = (() => {
    const sourceDeveloper = resolveTicketAssigneeDeveloper(ticket);
    const byId = new Map();
    assignableDevelopers.forEach((developer) => {
      if (developer?.id) byId.set(developer.id, developer);
    });
    if (sourceDeveloper?.id) byId.set(sourceDeveloper.id, sourceDeveloper);
    return [...byId.values()];
  })();
  const analystBelongsToClient = (() => {
    if (!isAnalyst || !client) return false;
    if ((client.analyst_team_ids || []).includes(user?.id)) return true;

    const userEmail = String(user?.email || "").trim().toLowerCase();
    const userName = String(user?.full_name || "").trim().toLowerCase();

    return (client.analyst_team_names || []).some((entry) => {
      const normalized = String(entry || "").trim().toLowerCase();
      return normalized && (normalized === userEmail || normalized === userName);
    });
  })();
  const canSetReportedOutcome =
    ticketKind === "main" &&
    (isAdmin || analystBelongsToClient) &&
    ["done", "reported"].includes(normalizedStatus);
  const missingDataReporterMatchesUser = (() => {
    const reporterId = ticket?.missing_required_data_reported_by_id;
    if (reporterId && user?.id) return reporterId === user.id;

    const reporterRaw = String(ticket?.missing_required_data_reported_by || "").trim().toLowerCase();
    const userEmail = String(user?.email || "").trim().toLowerCase();
    const userName = String(user?.full_name || "").trim().toLowerCase();
    return Boolean(reporterRaw && (reporterRaw === userEmail || reporterRaw === userName));
  })();
  const canFlagMissingData =
    ticketKind === "main" &&
    !isTicketClosed(ticket) &&
    !priorityPaused &&
    (isAssignedDeveloper || isAdmin);
  const canReactivateMissingData =
    ticketKind === "main" &&
    !isTicketClosed(ticket) &&
    priorityPaused &&
    (isAdmin || (isDeveloper && missingDataReporterMatchesUser));
  const canManageMissingData = canFlagMissingData || canReactivateMissingData;
  const ticketWatchers = normalizeTicketWatchers(ticket);
  const isCurrentUserWatching = ticketWatchers.some((watcher) => watcherMatchesUser(watcher, user));
  const canManageWatchers = isAdmin || isAnalyst || canManageAsTechSupervisor || isTechSupervisor;
  const watcherOptions = users
    .filter((candidate) => {
      if (!candidate?.id && !candidate?.email) return false;
      return !ticketWatchers.some((watcher) => watcherMatchesUser(watcher, candidate));
    })
    .sort((a, b) =>
      String(a?.full_name || a?.email || "").localeCompare(String(b?.full_name || b?.email || ""), "it", {
        sensitivity: "base",
      })
    );
  const selectedWatcherToAdd =
    users.find((candidate) => (candidate.id || candidate.email) === watcherToAddId) || null;
  const hiddenReportedStatus = ([key]) => key !== "reported" || normalizedStatus === "reported";
  const availableStatusEntries = isQaFixTicket || isLiveOpsTicket || isPostPreviewChangeTicket
    ? Object.entries(STATUS_CONFIG).filter(
        ([key]) => hiddenReportedStatus([key]) && ["new", "in_progress", "done"].includes(key)
      )
    : Object.entries(STATUS_CONFIG).filter(hiddenReportedStatus);
  const currentLiveState = normalizeLiveState(ticket?.live_state);
  const liveStateLabel = LIVE_STATE_LABELS[currentLiveState] || LIVE_STATE_LABELS.not_live;
  const liveOperationType = normalizeLiveOperationType(ticket?.live_operation_type);
  const liveOperationLabel = getLiveOperationLabel(liveOperationType);
  const liveConfirmationStatus = normalizeLiveConfirmationStatus(
    ticket?.live_confirmation_status,
    currentLiveState
  );
  const liveConfirmationLabel =
    LIVE_CONFIRMATION_STATUS_LABELS[liveConfirmationStatus] ||
    LIVE_CONFIRMATION_STATUS_LABELS.not_confirmed;
  const liveConfirmationBadgeClass =
    LIVE_CONFIRMATION_STATUS_BADGE_CLASSES[liveConfirmationStatus] ||
    LIVE_CONFIRMATION_STATUS_BADGE_CLASSES.not_confirmed;
  const liveOperationMeta = (() => {
    if (currentLiveState === "stop_requested" || currentLiveState === "stopped" || liveOperationType === "stop") {
      return {
        confirmationTitle: "Conferma spegnimento",
        confirmationLabel: currentLiveState === "stop_requested" ? "In attesa conferma" : "Confermato",
        confirmationBadgeClass:
          currentLiveState === "stop_requested"
            ? LIVE_OPS_PENDING_BADGE_CLASS
            : LIVE_OPS_CONFIRMED_BADGE_CLASS,
        showSplitTarget: false,
      };
    }

    if (currentLiveState === "change_requested" || liveOperationType === "change") {
      return {
        confirmationTitle: "Conferma modifica live",
        confirmationLabel: currentLiveState === "change_requested" ? "In attesa conferma" : "Confermata",
        confirmationBadgeClass:
          currentLiveState === "change_requested"
            ? LIVE_OPS_PENDING_BADGE_CLASS
            : LIVE_OPS_CONFIRMED_BADGE_CLASS,
        showSplitTarget: true,
      };
    }

    return {
      confirmationTitle: "Conferma go-live",
      confirmationLabel: liveConfirmationLabel,
      confirmationBadgeClass: liveConfirmationBadgeClass,
      showSplitTarget: true,
    };
  })();
  const liveOperationGridClass = liveOperationMeta.showSplitTarget
    ? "grid gap-3 md:grid-cols-2 xl:grid-cols-4"
    : "grid gap-3 md:grid-cols-2";
  const showLiveConfirmationBadge =
    (ticketKind === "main" || isLiveOpsTicket) &&
    (ticket?.live_operation_type || currentLiveState !== "not_live");
  const openLiveOpsTickets = !ticket?.id
    ? []
    : tickets.filter(
        (entry) =>
          normalizeTicketKind(entry) === "live_ops" &&
          String(entry.parent_ticket_id || "") === String(ticket.id) &&
          !isClosedStatus(entry.status)
      );
  const hasOpenLiveOpsByType = new Set(
    openLiveOpsTickets.map((entry) => normalizeLiveOperationType(entry.live_operation_type))
  );
  const openPostPreviewChangeTickets = !ticket?.id
    ? []
    : tickets.filter(
        (entry) =>
          normalizeTicketKind(entry) === "post_preview_change" &&
          String(entry.parent_ticket_id || "") === String(ticket.id) &&
          !isClosedStatus(entry.status)
      );
  const canRequestPostPreviewChange =
    ticketKind === "main" &&
    (isAdmin || isAnalyst || canManageAsTechSupervisor) &&
    ["done", "reported"].includes(normalizedStatus);
  const canRequestLiveOps = ticketKind === "main" && (isAdmin || analystBelongsToClient);
  const canRequestLaunch = canRequestLiveOps && ["done", "reported"].includes(normalizedStatus) && (currentLiveState === "not_live" || currentLiveState === "stopped");
  const canRequestChange = canRequestLiveOps && ["done", "reported"].includes(normalizedStatus) && currentLiveState === "live";
  const canRequestStop = canRequestLiveOps && ["done", "reported"].includes(normalizedStatus) && currentLiveState === "live";
  const liveOpsOperationType = normalizeLiveOperationType(liveOpsForm.operation_type);
  const isStopLiveOperation = liveOpsOperationType === "stop";
  const postPreviewEffortHours = normalizeEffortHours(postPreviewEffortInput);
  const postPreviewAssigneeIsValid = Boolean(resolveActiveDeveloperById(postPreviewAssigneeId));
  const postPreviewSubmitDisabled =
    submittingPostPreviewChange ||
    !String(postPreviewNotes || "").trim() ||
    !postPreviewEffortHours ||
    !postPreviewAssigneeIsValid;
  const liveOpsEffortHours = normalizeEffortHours(liveOpsForm.effort_hours);
  const liveOpsAssigneeIsValid = Boolean(resolveActiveDeveloperById(liveOpsForm.assignee_id));
  const liveOpsSubmitDisabled =
    submittingLiveOps ||
    !liveOpsEffortHours ||
    !liveOpsAssigneeIsValid ||
    (isStopLiveOperation
      ? !String(liveOpsForm.outcome || "").trim()
      : !String(liveOpsForm.split || "").trim() || !String(liveOpsForm.target || "").trim());

  const updateTicketWatchers = async (nextWatchers, auditAction, auditDetails) => {
    await updateMutation.mutateAsync({
      data: {
        watchers: normalizeTicketWatchers(nextWatchers),
      },
      auditAction,
      auditDetails,
    });
  };

  const handleToggleCurrentWatcher = async () => {
    if (!user?.id && !user?.email) return;

    if (isCurrentUserWatching) {
      const nextWatchers = ticketWatchers.filter((watcher) => !watcherMatchesUser(watcher, user));
      await updateTicketWatchers(
        nextWatchers,
        "watcher_removed",
        `${user?.full_name || user?.email || "Utente"} non segue piu il ticket`
      );
      toast({
        title: "Watcher rimosso",
        description: "Non riceverai piu notifiche dedicate per questo ticket.",
      });
      return;
    }

    const nextWatcher = {
      ...buildWatcherFromUser(user),
      added_by: user?.email || user?.full_name || "user",
    };
    await updateTicketWatchers(
      [...ticketWatchers, nextWatcher],
      "watcher_added",
      `${nextWatcher.name || nextWatcher.email} segue il ticket`
    );
    toast({
      title: "Watcher aggiunto",
      description: "Riceverai notifiche sugli aggiornamenti del ticket.",
    });
  };

  const handleAddWatcher = async () => {
    if (!selectedWatcherToAdd) return;

    const nextWatcher = {
      ...buildWatcherFromUser(selectedWatcherToAdd),
      added_by: user?.email || user?.full_name || "user",
    };
    const nextWatchers = normalizeTicketWatchers([...ticketWatchers, nextWatcher]);

    await updateTicketWatchers(
      nextWatchers,
      "watcher_added",
      `${nextWatcher.name || nextWatcher.email} aggiunto come watcher`
    );

    await notifyWatcherAdded({
      ticket: {
        ...ticket,
        watchers: nextWatchers,
      },
      actor: user,
      watcher: selectedWatcherToAdd,
    }).catch(() => {});

    setWatcherToAddId("");
    toast({
      title: "Watcher aggiunto",
      description: `${nextWatcher.name || nextWatcher.email} ricevera notifiche sul ticket.`,
    });
  };

  const handleRemoveWatcher = async (watcher) => {
    const watcherKey = getWatcherKey(watcher);
    if (!watcherKey) return;
    const canRemove = canManageWatchers || watcherMatchesUser(watcher, user);
    if (!canRemove) return;

    const nextWatchers = ticketWatchers.filter((entry) => getWatcherKey(entry) !== watcherKey);
    await updateTicketWatchers(
      nextWatchers,
      "watcher_removed",
      `${watcher.name || watcher.email || "Watcher"} rimosso dai watcher`
    );
    toast({
      title: "Watcher rimosso",
      description: "La lista watcher e stata aggiornata.",
    });
  };

  const handleMissingDataToggle = async () => {
    if (!ticket?.assignee_id) return;

    const nextPaused = !priorityPaused;
    const currentStatus = normalizeTicketStatus(ticket.status);
    const nextStatus = nextPaused ? "blocked" : (currentStatus === "blocked" ? "new" : currentStatus);
    const nextPriorityScore = nextPaused
      ? 0
      : calculatePriorityScore(
          { ...ticket, status: nextStatus, missing_required_data: false, priority_override: null },
          client,
          config
    );
    const currentScheduleSegments = getTicketScheduleSegments(ticket);
    const anchorSegment = currentScheduleSegments[0] || null;
    const nowInfo = getNowInRome();
    const pauseSnapshot = nextPaused && currentStatus === "in_progress"
      ? buildPauseScheduleSnapshot(ticket, nowInfo.date, nowInfo.roundedTime || nowInfo.time)
      : null;
    const scheduleUpdate = nextPaused
      ? pauseSnapshot?.schedule || {
          scheduled_date: null,
          start_time: null,
          end_time: null,
          continuation_schedule: [],
        }
      : getWorkedEffortHours(ticket) > 0
        ? {}
        : {
            scheduled_date: null,
            start_time: null,
            end_time: null,
            continuation_schedule: [],
          };

    await updateMutation.mutateAsync({
      data: {
        missing_required_data: nextPaused,
        missing_required_data_reported_at: nextPaused ? new Date().toISOString() : null,
        missing_required_data_reported_by: nextPaused ? (user?.email || user?.full_name || "developer") : null,
        missing_required_data_reported_by_id: nextPaused ? (user?.id || null) : null,
        priority_override: nextPaused ? 0 : null,
        priority_score: nextPriorityScore,
        status: nextStatus,
        ...scheduleUpdate,
        ...(pauseSnapshot
          ? {
              worked_effort_hours: pauseSnapshot.workedEffort,
              remaining_effort_hours: pauseSnapshot.remainingEffort,
              paused_at: new Date().toISOString(),
              paused_by: user?.email || user?.full_name || "developer",
              paused_by_id: user?.id || null,
              paused_from_status: currentStatus,
            }
          : {}),
      },
      auditAction: nextPaused ? "missing_data_reported" : "missing_data_cleared",
      auditDetails: nextPaused
        ? "Developer reported missing data required to proceed; priority forced to 0"
        : "Missing-data block cleared; ticket priority restored",
    });

    if (nextPaused && client) {
      await notifyTicketMissingData({
        ticket: {
          ...ticket,
          missing_required_data: true,
          priority_override: 0,
          priority_score: 0,
        },
        actor: user,
        client,
      }).catch(() => {});
    } else if (!nextPaused) {
      await notifyClientSupervisor({
        ticketOverride: {
          ...ticket,
          missing_required_data: false,
          priority_override: null,
          status: nextStatus,
        },
        title: "Ticket riattivato",
        body: `${ticket.title} · dati ricevuti`,
        metadata: {
          reason: "missing_data_cleared",
        },
      });
    }

    if (nextPaused) {
      await applyRebalanceForDevelopers([ticket.assignee_id], {
        preserveWorkingDaysFromToday: 0,
        preserveExistingSequence: true,
        includeTodayHoles: true,
        freezeCurrentWeekSegments: false,
        preserveTodaySegments: false,
        allowInProgressReplan: true,
        forceLastTicketIds: [ticket.id],
        ...(anchorSegment
          ? {
              planningStartDate: anchorSegment.date,
              manualInsertionAnchor: {
                date: anchorSegment.date,
                start: anchorSegment.start,
              },
            }
          : {
              planningStartDate: moment().format("YYYY-MM-DD"),
            }),
      });
    } else {
      const reactivationDeveloper = resolveTicketAssigneeDeveloper(ticket);
      if (reactivationDeveloper) {
        await schedulePriorityInsertionBeforeNew({
          developer: reactivationDeveloper,
          ticketId: ticket.id,
          insertBeforeNextActivity: true,
        });
        await queryClient.invalidateQueries({ queryKey: ["ticket", ticketId] });
        await queryClient.invalidateQueries({ queryKey: ["tickets"] });
      } else {
        await applyRebalanceForDevelopers([ticket.assignee_id], {
          preserveWorkingDaysFromToday: 0,
          preserveExistingSequence: false,
          includeTodayHoles: true,
          freezeCurrentWeekSegments: false,
          preserveTodaySegments: false,
          preserveElapsedTodaySegments: true,
          allowInProgressReplan: true,
          forceFirstTicketIds: [ticket.id],
          planningStartDate: nowInfo.date,
          manualInsertionAnchor: {
            date: nowInfo.date,
            start: nowInfo.roundedDecimal ?? DAY_START,
          },
        });
      }
    }

    toast({
      title: nextPaused ? "Ticket sospeso per mancanza dati" : "Ticket riattivato",
      description: nextPaused
        ? "Priorita portata a 0 e team cliente notificato."
        : "Il ticket e stato reinserito in pipeline spostando le attivita successive.",
    });
  };

  const handleReportedOutcomeSave = async () => {
    const normalizedOutcome = String(reportedOutcomeInput || "").trim();
    if (!normalizedOutcome) return;

    await updateMutation.mutateAsync({
      data: {
        status: "reported",
        reported_outcome: normalizedOutcome,
        reported_at: new Date().toISOString(),
        reported_by: user?.email || user?.full_name || "analyst",
        reported_by_id: user?.id || null,
        reported_industry: client?.industry || "",
      },
      auditAction: "reported_outcome_set",
      auditDetails: `Test marked as ${normalizedOutcome.replaceAll("_", " ")}`,
    });

    await notifyClientSupervisor({
      ticketOverride: {
        ...ticket,
        status: "reported",
        reported_outcome: normalizedOutcome,
      },
      title: "Esito test aggiornato",
      body: `${ticket.title} · ${normalizedOutcome.replaceAll("_", " ")}`,
      metadata: {
        reason: "reported_outcome_set",
        outcome: normalizedOutcome,
      },
    });

    toast({
      title: "Esito test aggiornato",
      description: "Il ticket e stato marcato come reported.",
    });
  };

  const handleManualPrioritySave = async () => {
    if (!isAdmin) return;

    const rawValue = String(manualPriorityInput || "").trim();
    if (!rawValue) {
      toast({
        variant: "destructive",
        title: "Inserisci un punteggio valido",
        description: "La priorita manuale deve essere un numero maggiore o uguale a 0.",
      });
      return;
    }

    const parsedValue = Number(rawValue.replace(",", "."));
    if (!Number.isFinite(parsedValue) || parsedValue < 0) {
      toast({
        variant: "destructive",
        title: "Inserisci un punteggio valido",
        description: "La priorita manuale deve essere un numero maggiore o uguale a 0.",
      });
      return;
    }

    const nextOverride = Math.round(parsedValue);
    if (Number(ticket?.priority_override) === nextOverride) {
      toast({
        title: "Priorita gia aggiornata",
        description: "Il ticket usa gia questo punteggio manuale.",
      });
      return;
    }

    await updateMutation.mutateAsync({
      data: {
        priority_override: nextOverride,
        priority_score: ticket.priority_score,
      },
      auditAction: "priority_override_set",
      auditDetails: `Manual priority override set to ${nextOverride}`,
    });

    await notifyClientSupervisor({
      ticketOverride: {
        ...ticket,
        priority_override: nextOverride,
        priority_score: ticket.priority_score,
      },
      title: "Priorita manuale aggiornata",
      body: `${ticket.title} · priorita forzata a ${nextOverride}`,
      metadata: {
        reason: "ticket_priority_override_set",
        priority_override: nextOverride,
      },
    });

    await applyRebalanceForDevelopers([ticket.assignee_id], {
      preserveWorkingDaysFromToday: 3,
    });

    toast({
      title: "Priorita manuale salvata",
      description: `Il ticket usa ora il punteggio ${nextOverride}.`,
    });
  };

  const handleManualPriorityReset = async () => {
    if (!isAdmin || ticket?.priority_override === null || ticket?.priority_override === undefined) return;

    const restoredPriorityScore = calculatePriorityScore(
      { ...ticket, priority_override: null },
      client,
      config
    );

    await updateMutation.mutateAsync({
      data: {
        priority_override: null,
        priority_score: restoredPriorityScore,
      },
      auditAction: "priority_override_cleared",
      auditDetails: "Manual priority override cleared",
    });

    await notifyClientSupervisor({
      ticketOverride: {
        ...ticket,
        priority_override: null,
        priority_score: restoredPriorityScore,
      },
      title: "Priorita manuale rimossa",
      body: `${ticket.title} · priorita tornata al calcolo standard`,
      metadata: {
        reason: "ticket_priority_override_cleared",
        priority_override: null,
      },
    });

    await applyRebalanceForDevelopers([ticket.assignee_id], {
      preserveWorkingDaysFromToday: 3,
    });

    toast({
      title: "Priorita manuale rimossa",
      description: "Il ticket e tornato alla priorita calcolata standard.",
    });
  };

  const referenceLinks = normalizeReferenceLinks(ticket.reference_links, ticket.link);

  const handleEditOpen = () => {
    setEditForm({
      title: ticket.title,
      description: ticket.description || "",
      required_tracking: ticket.required_tracking || "",
      deadline: ticket.deadline,
      reference_links: normalizeReferenceLinks(ticket.reference_links, ticket.link),
      type: ticket.type,
      qa_preview_links: (() => {
        const previewLinks = resolveQaPreviewEntries(ticket);
        return previewLinks.length > 0
          ? previewLinks
          : [{ title: "", url: "" }];
      })(),
      qa_review_notes: ticket.qa_review_notes || "",
      qa_test_instructions: ticket.qa_test_instructions || "",
    });
    setEditingDetails(true);
  };

  const updateEditReferenceLink = (index, value) => {
    setEditForm((prev) => ({
      ...prev,
      reference_links: (prev.reference_links || []).map((link, linkIndex) => (linkIndex === index ? value : link)),
    }));
  };

  const addEditReferenceLink = () => {
    setEditForm((prev) => ({
      ...prev,
      reference_links: [...(prev.reference_links || []), ""],
    }));
  };

  const removeEditReferenceLink = (index) => {
    setEditForm((prev) => {
      const nextLinks = (prev.reference_links || []).filter((_, linkIndex) => linkIndex !== index);
      return {
        ...prev,
        reference_links: nextLinks.length > 0 ? nextLinks : [""],
      };
    });
  };

  const updateEditPreviewLink = (index, field, value) => {
    setEditForm((prev) => ({
      ...prev,
      qa_preview_links: (prev.qa_preview_links || []).map((link, linkIndex) =>
        linkIndex === index ? { ...link, [field]: value } : link
      ),
    }));
  };

  const addEditPreviewLink = () => {
    setEditForm((prev) => ({
      ...prev,
      qa_preview_links: [
        ...(prev.qa_preview_links || []),
        { title: "", url: "" },
      ],
    }));
  };

  const removeEditPreviewLink = (index) => {
    setEditForm((prev) => {
      const nextLinks = (prev.qa_preview_links || []).filter(
        (_, linkIndex) => linkIndex !== index
      );
      return {
        ...prev,
        qa_preview_links:
          nextLinks.length > 0 ? nextLinks : [{ title: "", url: "" }],
      };
    });
  };

  const handleEditSave = async () => {
    const normalizedDescription = String(editForm.description || "").trim();
    if (!normalizedDescription) {
      toast({
        variant: "destructive",
        title: "Descrizione obbligatoria",
        description: "Inserisci una descrizione prima di salvare il ticket.",
      });
      return;
    }

    const client = clients.find(c => c.id === ticket.client_id);
    const referencePayload = buildReferenceLinksPayload(editForm.reference_links);
    const previewPayload = buildQaPreviewPayload(editForm.qa_preview_links);
    const payload = {
      ...editForm,
      description: normalizedDescription,
      required_tracking: String(editForm.required_tracking || "").trim(),
      ...previewPayload,
      qa_review_notes: String(editForm.qa_review_notes || "").trim(),
      qa_test_instructions: String(editForm.qa_test_instructions || "").trim(),
      ...referencePayload,
    };
    const nextTicket = { ...ticket, ...payload };
    const nextPriorityScore = calculatePriorityScore(nextTicket, client, config);

    await updateMutation.mutateAsync({
      data: { ...payload, priority_score: nextPriorityScore },
      auditAction: "details_updated",
      auditDetails: "Ticket details updated",
    });

    await notifyClientSupervisor({
      ticketOverride: { ...ticket, ...payload, priority_score: nextPriorityScore },
      title: "Dettagli ticket aggiornati",
      body: ticket.title,
      metadata: {
        reason: "ticket_details_updated",
      },
    });

    setEditingDetails(false);
  };

  const surfaceCardClass = "rounded-[28px] border border-border/70 bg-card/95 shadow-[var(--shadow-soft)]";
  const sectionEyebrowClass = "text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground";
  const sidebarLabelClass = "text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground";

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {resumePauseDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-border/70 bg-card p-6 shadow-xl">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-500/15">
                <Clock className="h-5 w-5 text-violet-600 dark:text-violet-300" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">Riprendi ticket in pausa</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Le {resumePauseDialog.workedEffort}h gia lavorate restano bloccate nel calendario. Verra pianificato solo l&apos;effort residuo.
                </p>
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-border/70 bg-muted/25 p-4">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="text-muted-foreground">Effort gia lavorato</span>
                <span className="font-semibold text-foreground">{resumePauseDialog.workedEffort}h</span>
              </div>
              <div className="mt-3 space-y-1.5">
                <label className={sidebarLabelClass}>Effort rimanente (h)</label>
                <Input
                  type="number"
                  min="0.5"
                  step="0.5"
                  value={resumeRemainingInput}
                  onChange={(event) => setResumeRemainingInput(event.target.value)}
                  className="h-10"
                  autoFocus
                />
                <p className="text-[11px] text-muted-foreground">
                  Stima precedente: {resumePauseDialog.remainingEffort}h. Puoi correggerla prima di ripartire.
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setResumePauseDialog(null)}
              >
                Annulla
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!normalizeEffortHours(resumeRemainingInput) || updateMutation.isPending}
                onClick={async () => {
                  const nextRemaining = normalizeEffortHours(resumeRemainingInput);
                  if (!nextRemaining) return;
                  const nowInfo = getNowInRome();
                  setResumePauseDialog(null);
                  await finalizeStatusChange("in_progress", {
                    overrideStartTime: nowInfo.roundedTime || nowInfo.time,
                    remainingEffortHours: nextRemaining,
                    auditAction: "ticket_resumed",
                    auditDetails: `Ticket resumed with ${nextRemaining}h remaining after ${resumePauseDialog.workedEffort}h worked`,
                  });
                }}
              >
                Riprendi e ripianifica
              </Button>
            </div>
          </div>
        </div>
      )}

      {inProgressBlockDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-border/70 bg-card p-6 shadow-xl">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-500/15">
                <AlertTriangle className="h-5 w-5 text-violet-600 dark:text-violet-300" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-foreground">Ticket gia in progress</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Non puoi avere piu ticket in progress contemporaneamente. Chiudi, metti in pausa o sposta prima quello gia attivo.
                </p>
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-violet-200 bg-violet-50/70 p-4 dark:border-violet-500/30 dark:bg-violet-500/10">
              {(() => {
                const activeTicket = inProgressBlockDialog.activeTicket;
                const client = clients.find(
                  (entry) =>
                    entry.id === activeTicket.client_id ||
                    String(entry.name || "").toLowerCase() === String(activeTicket.client_name || "").toLowerCase()
                );
                const segments = getTicketScheduleSegments(activeTicket);
                const lastSegment = segments[segments.length - 1] || null;
                const plannedEnd = lastSegment
                  ? `${moment(lastSegment.date, "YYYY-MM-DD", true).isValid() ? moment(lastSegment.date, "YYYY-MM-DD").format("DD/MM") : lastSegment.date} ${decimalToTime(lastSegment.end)}`
                  : "";

                return (
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-violet-200 bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-800 dark:border-violet-500/35 dark:bg-violet-500/15 dark:text-violet-200">
                        In progress
                      </span>
                      <span className="text-[11px] font-medium text-muted-foreground">
                        {activeTicket.client_name || client?.name || "Cliente non indicato"}
                      </span>
                    </div>
                    <p className="mt-2 truncate text-sm font-semibold text-foreground">
                      {activeTicket.title}
                    </p>
                    {plannedEnd && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Fine prevista: {plannedEnd}
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setInProgressBlockDialog(null)}
              >
                Chiudi
              </Button>
              <Button asChild size="sm" onClick={() => setInProgressBlockDialog(null)}>
                <Link to={buildTicketUrl(inProgressBlockDialog.activeTicket.id)}>
                  Apri ticket attivo
                </Link>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* In-progress time conflict dialog */}
      {inProgressConflict && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-900">Orario di inizio diverso</h3>
                <p className="text-xs text-gray-500 mt-1">
                  L'orario pianificato è <strong>{inProgressConflict.plannedTime}</strong>, ma ora sono le <strong>{inProgressConflict.nowTime}</strong>.
                </p>
              </div>
            </div>
            <p className="text-xs text-gray-600 mb-4 bg-amber-50 rounded-lg p-3 border border-amber-100">
              Puoi usare <strong>{inProgressConflict.nowTime}</strong> solo se lo slot e libero. Se e occupato, la piattaforma blocchera l'avvio.
            </p>
            <div className="flex flex-col gap-2">
              <Button
                size="sm"
                className="w-full bg-amber-500 hover:bg-amber-600 text-white h-9 text-xs"
                onClick={async () => {
                  const t = inProgressConflict.nowTime;
                  setInProgressConflict(null);
                  await doStatusChange("in_progress", { overrideStartTime: t });
                }}
              >
                Sì, aggiorna a {inProgressConflict.nowTime}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="w-full h-9 text-xs"
                onClick={async () => {
                  setInProgressConflict(null);
                  await doStatusChange("in_progress", { overrideStartTime: inProgressConflict.plannedTime });
                }}
              >
                No, mantieni {inProgressConflict.plannedTime}
              </Button>
              <button
                className="text-xs text-gray-400 hover:text-gray-600 mt-1"
                onClick={() => setInProgressConflict(null)}
              >
                Annulla
              </button>
            </div>
          </div>
        </div>
      )}

      {doneConflict && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-900">Conferma orario di chiusura</h3>
                <p className="text-xs text-gray-500 mt-1">
                  Il fine pianificato è{" "}
                  <strong>{formatDateTimeLabel(doneConflict.plannedDate, doneConflict.plannedTime)}</strong>, ma ora sono le{" "}
                  <strong>{formatDateTimeLabel(doneConflict.nowDate, doneConflict.nowTime)}</strong>.
                </p>
              </div>
            </div>

            <p className="text-xs text-gray-600 mb-4 bg-amber-50 rounded-lg p-3 border border-amber-100">
              Scegli se chiudere con orario attuale (riorganizza la pipeline) oppure mantenere l'orario pianificato.
            </p>

            <div className="flex flex-col gap-2">
              <Button
                size="sm"
                className="w-full bg-amber-500 hover:bg-amber-600 text-white h-9 text-xs"
                onClick={async () => {
                  const payload = doneConflict;
                  setDoneConflict(null);
                  if (payload.qaFixReopenReview) {
                    await completeQaFixAndRestartReview({
                      statusOptions: {
                        completionMode: "now",
                        completionDate: payload.nowDate,
                        completionTime: payload.nowTime,
                      },
                    });
                    return;
                  }
                  if (payload.liveOpsComplete) {
                    await completeLiveOpsTransition({
                      statusOptions: {
                        completionMode: "now",
                        completionDate: payload.nowDate,
                        completionTime: payload.nowTime,
                      },
                    });
                    return;
                  }
                  if (payload.postPreviewChangeComplete) {
                    await completePostPreviewChangeTransition({
                      statusOptions: {
                        completionMode: "now",
                        completionDate: payload.nowDate,
                        completionTime: payload.nowTime,
                      },
                    });
                    return;
                  }
                  if (payload.qaPayload) {
                    await completeQaReviewTransition({
                      qaPayload: payload.qaPayload,
                      statusOptions: {
                        completionMode: "now",
                        completionDate: payload.nowDate,
                        completionTime: payload.nowTime,
                      },
                    });
                    return;
                  }
                  await finalizeStatusChange(payload.status, {
                    completionMode: "now",
                    completionDate: payload.nowDate,
                    completionTime: payload.nowTime,
                  });
                }}
              >
                Usa orario attuale ({doneConflict.nowTime})
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="w-full h-9 text-xs"
                onClick={async () => {
                  const payload = doneConflict;
                  setDoneConflict(null);
                  if (payload.qaFixReopenReview) {
                    await completeQaFixAndRestartReview({
                      statusOptions: {
                        completionMode: "planned",
                        completionDate: payload.plannedDate,
                        completionTime: payload.plannedTime,
                      },
                    });
                    return;
                  }
                  if (payload.liveOpsComplete) {
                    await completeLiveOpsTransition({
                      statusOptions: {
                        completionMode: "planned",
                        completionDate: payload.plannedDate,
                        completionTime: payload.plannedTime,
                      },
                    });
                    return;
                  }
                  if (payload.postPreviewChangeComplete) {
                    await completePostPreviewChangeTransition({
                      statusOptions: {
                        completionMode: "planned",
                        completionDate: payload.plannedDate,
                        completionTime: payload.plannedTime,
                      },
                    });
                    return;
                  }
                  if (payload.qaPayload) {
                    await completeQaReviewTransition({
                      qaPayload: payload.qaPayload,
                      statusOptions: {
                        completionMode: "planned",
                        completionDate: payload.plannedDate,
                        completionTime: payload.plannedTime,
                      },
                    });
                    return;
                  }
                  await finalizeStatusChange(payload.status, {
                    completionMode: "planned",
                    completionDate: payload.plannedDate,
                    completionTime: payload.plannedTime,
                  });
                }}
              >
                Mantieni orario pianificato ({doneConflict.plannedTime})
              </Button>
              <button
                className="text-xs text-gray-400 hover:text-gray-600 mt-1"
                onClick={() => setDoneConflict(null)}
              >
                Annulla
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <Link to={backContext.url} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> {backContext.label}
          </Link>
          <div className="space-y-3">
            <p className={sectionEyebrowClass}>Ticket detail</p>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={`${status.color} text-xs`}>{status.label}</Badge>
                <Badge variant="outline" className={`${type.color} border-0 text-xs`}>{type.label}</Badge>
                <Badge variant="outline" className={`${diff.color} border-0 text-xs`}>{diff.label}</Badge>
                {isQaReviewTicket && (
                  <Badge variant="outline" className="border-0 bg-cyan-100 text-cyan-700 text-xs dark:bg-cyan-500/15 dark:text-cyan-300">
                    Review task
                  </Badge>
                )}
                {isQaFixTicket && (
                  <Badge variant="outline" className="border-0 bg-rose-100 text-rose-700 text-xs dark:bg-rose-500/15 dark:text-rose-300">
                    QA fix
                  </Badge>
                )}
                {isLiveOpsTicket && (
                  <Badge variant="outline" className="border-0 bg-indigo-100 text-indigo-700 text-xs dark:bg-indigo-500/15 dark:text-indigo-300">
                    Live ops
                  </Badge>
                )}
                {isPostPreviewChangeTicket && (
                  <Badge variant="outline" className="border-0 bg-amber-100 text-amber-800 text-xs dark:bg-amber-500/15 dark:text-amber-300">
                    Post-preview
                  </Badge>
                )}
                {ticketKind === "main" && (
                  <Badge variant="outline" className="border-0 bg-slate-100 text-slate-700 text-xs dark:bg-slate-500/15 dark:text-slate-200">
                    {liveStateLabel}
                  </Badge>
                )}
                {showLiveConfirmationBadge && (
                  <Badge
                    variant="outline"
                    className={`border-0 text-xs ${liveOperationMeta.confirmationBadgeClass}`}
                  >
                    Conferma: {liveOperationMeta.confirmationLabel}
                  </Badge>
                )}
                {ticketBlocked && (
                  <Badge variant="outline" className="border-0 bg-amber-100 text-amber-700 text-xs dark:bg-amber-500/15 dark:text-amber-300">
                    {priorityPaused ? "Mancano dati" : "In pausa"}
                  </Badge>
                )}
                {scheduleSlipCount > 0 && (
                  <Badge variant="outline" className="border-0 bg-amber-100 text-amber-800 text-xs dark:bg-amber-500/15 dark:text-amber-300">
                    Slittato {scheduleSlipCount}x
                  </Badge>
                )}
                {isAdmin && (
                  <Badge variant="outline" className={`${priority.bgLight} ${priority.textColor} border-0 text-xs font-bold`}>
                    {effectivePriority} pts
                  </Badge>
                )}
              </div>
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">{ticket.title}</h1>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
                <span>Cliente: <span className="font-medium text-foreground">{ticket.client_name || "—"}</span></span>
                <span>Assignee: <span className="font-medium text-foreground">{ticket.assignee_name || "Non assegnato"}</span></span>
                <span>ID: <span className="font-mono text-foreground">#{ticket.id?.slice(-6)}</span></span>
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEditDetails && (
            <Button
              type="button"
              variant="outline"
              className="h-9 rounded-xl"
              onClick={handleEditOpen}
            >
              <Pencil className="w-4 h-4" /> Edit Details
            </Button>
          )}
          {(isAdmin || isAnalyst) && (
            <Button
              type="button"
              variant="outline"
              className="h-9 rounded-xl border-rose-200 text-rose-600 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-500/30 dark:hover:bg-rose-500/10"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="w-4 h-4" /> Delete
            </Button>
          )}
        </div>
      </div>

      {/* Edit Details Dialog */}
      <Dialog open={editingDetails} onOpenChange={setEditingDetails}>
        <DialogContent className="flex w-[calc(100vw-32px)] max-h-[calc(100vh-112px)] max-w-3xl flex-col gap-0 overflow-hidden rounded-[30px] border border-border/70 bg-card p-0 shadow-[var(--shadow-hover)] sm:w-[calc(100vw-64px)] sm:max-h-[calc(100vh-128px)]">
          <DialogHeader className="shrink-0 border-b border-border/70 px-6 py-5 text-left sm:px-7 sm:py-6">
            <p className={sectionEyebrowClass}>Ticket detail</p>
            <DialogTitle className="text-2xl font-semibold tracking-tight text-foreground">
              Modifica dettagli ticket
            </DialogTitle>
            <DialogDescription className="text-sm">
              Aggiorna brief, contesto operativo e link di supporto senza uscire dal ticket.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 sm:px-7 sm:py-5">
            <div className="space-y-4">
              <section className="space-y-4 rounded-[24px] bg-muted/20 p-4 sm:p-5">
                <div className="space-y-1">
                  <p className={sectionEyebrowClass}>Brief del test</p>
                  <h4 className="text-base font-semibold text-foreground">Contenuti principali</h4>
                </div>

                <div className="space-y-1.5">
                  <label className={sidebarLabelClass}>Titolo</label>
                  <Input
                    value={editForm.title}
                    onChange={e => setEditForm({ ...editForm, title: e.target.value })}
                    className="h-11 text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className={sidebarLabelClass}>Descrizione *</label>
                  <MarkdownEditor
                    value={editForm.description || ""}
                    onChange={value => setEditForm({ ...editForm, description: value })}
                    minHeightClass="min-h-[144px]"
                    label="descrizione del ticket"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className={sidebarLabelClass}>Tracciamenti richiesti</label>
                  <MarkdownEditor
                    value={editForm.required_tracking || ""}
                    onChange={value => setEditForm({ ...editForm, required_tracking: value })}
                    minHeightClass="min-h-[120px]"
                    label="tracciamenti richiesti"
                  />
                </div>
              </section>

              <section className="space-y-4 rounded-[24px] bg-muted/20 p-4 sm:p-5">
                <div className="space-y-1">
                  <p className={sectionEyebrowClass}>Contesto operativo</p>
                  <h4 className="text-base font-semibold text-foreground">Meta informazioni del ticket</h4>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className={sidebarLabelClass}>Tipo</label>
                    <Select value={editForm.type} onValueChange={val => setEditForm({ ...editForm, type: val })}>
                      <SelectTrigger className="h-11 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(TYPE_CONFIG).map(([k, v]) => (
                          <SelectItem key={k} value={k}>{v.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <label className={sidebarLabelClass}>Deadline</label>
                    <Input
                      type="date"
                      value={editForm.deadline || ""}
                      onChange={e => setEditForm({ ...editForm, deadline: e.target.value })}
                      className="h-11 text-sm"
                    />
                  </div>
                </div>
              </section>

              <section className="space-y-4 rounded-[24px] bg-muted/20 p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1">
                    <p className={sectionEyebrowClass}>Reference</p>
                    <h4 className="text-base font-semibold text-foreground">Link utili per il team</h4>
                  </div>
                  <Button type="button" variant="outline" size="sm" className="h-9 rounded-xl text-xs" onClick={addEditReferenceLink}>
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Aggiungi link
                  </Button>
                </div>

                <div className="space-y-2.5">
                  {(editForm.reference_links || [""]).map((referenceLink, index) => (
                    <div key={index} className="flex gap-2">
                      <Input
                        value={referenceLink}
                        onChange={e => updateEditReferenceLink(index, e.target.value)}
                        placeholder="https://..."
                        className="h-11 text-sm"
                      />
                      {(editForm.reference_links || []).length > 1 && (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-11 w-11 shrink-0 rounded-xl"
                          onClick={() => removeEditReferenceLink(index)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              {(ticketKind === "main" || ticketKind === "qa_fix" || normalizeQaPreviewEntries(editForm.qa_preview_links).length > 0 || editForm.qa_review_notes || editForm.qa_test_instructions) && (
                <section className="space-y-4 rounded-[24px] bg-muted/20 p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-1">
                      <p className={sectionEyebrowClass}>QA / Review</p>
                      <h4 className="text-base font-semibold text-foreground">Contesto preview</h4>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 rounded-xl text-xs"
                      onClick={addEditPreviewLink}
                    >
                      <Plus className="mr-1.5 h-3.5 w-3.5" />
                      Aggiungi preview
                    </Button>
                  </div>

                  <div className="space-y-1.5">
                    <label className={sidebarLabelClass}>Link preview</label>
                    <div className="space-y-2.5">
                      {(editForm.qa_preview_links || [{ title: "", url: "" }]).map((previewLink, index) => (
                        <div key={index} className="flex flex-col gap-2 sm:flex-row">
                          <Input
                            value={previewLink.title || ""}
                            onChange={(event) =>
                              updateEditPreviewLink(index, "title", event.target.value)
                            }
                            placeholder={`Titolo preview ${index + 1}`}
                            className="h-11 text-sm sm:w-2/5"
                          />
                          <Input
                            value={previewLink.url || ""}
                            onChange={(event) =>
                              updateEditPreviewLink(index, "url", event.target.value)
                            }
                            placeholder="https://..."
                            className="h-11 min-w-0 flex-1 text-sm"
                          />
                          {(editForm.qa_preview_links || []).length > 1 && (
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="h-11 w-11 shrink-0 rounded-xl"
                              onClick={() => removeEditPreviewLink(index)}
                              aria-label={`Rimuovi preview ${index + 1}`}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className={sidebarLabelClass}>Note per il review</label>
                    <MarkdownEditor
                      value={editForm.qa_review_notes || ""}
                      onChange={value => setEditForm({ ...editForm, qa_review_notes: value })}
                      minHeightClass="min-h-[120px]"
                      label="note per il review"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className={sidebarLabelClass}>Come testarlo</label>
                    <MarkdownEditor
                      value={editForm.qa_test_instructions || ""}
                      onChange={value => setEditForm({ ...editForm, qa_test_instructions: value })}
                      minHeightClass="min-h-[120px]"
                      label="istruzioni di test"
                    />
                  </div>
                </section>
              )}
            </div>
          </div>

          <div className="shrink-0 border-t border-border/70 px-6 py-4 sm:px-7 sm:py-5">
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                className="h-10 rounded-xl text-sm sm:min-w-[140px]"
                onClick={() => setEditingDetails(false)}
              >
                Annulla
              </Button>
              <Button
                className="h-10 rounded-xl bg-violet-600 text-sm text-white hover:bg-violet-700 sm:min-w-[160px]"
                onClick={handleEditSave}
                disabled={!String(editForm.description || "").trim()}
              >
                Salva modifiche
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={qaRequestDialog} onOpenChange={setQaRequestDialog}>
        <DialogContent className="flex w-[calc(100vw-32px)] max-h-[calc(100vh-112px)] max-w-2xl flex-col gap-0 overflow-hidden rounded-[30px] border border-border/70 bg-card p-0 shadow-[var(--shadow-hover)] sm:w-[calc(100vw-64px)] sm:max-h-[calc(100vh-128px)]">
          <DialogHeader className="shrink-0 border-b border-border/70 px-6 py-5 text-left sm:px-7 sm:py-6">
            <p className={sectionEyebrowClass}>QA / Review</p>
            <DialogTitle className="text-2xl font-semibold tracking-tight text-foreground">
              Invia preview in review
            </DialogTitle>
            <DialogDescription className="text-sm">
              Il tech supervisor ricevera una task da 30 minuti nel primo slot utile della sua pipeline.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 sm:px-7 sm:py-5">
            <div className="space-y-4 rounded-[24px] bg-muted/20 p-4 sm:p-5">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className={sidebarLabelClass}>Link preview *</label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 rounded-xl text-xs"
                    onClick={addQaRequestPreviewLink}
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Aggiungi preview
                  </Button>
                </div>
                <div className="space-y-2.5">
                  {(qaRequestForm.preview_links || [{ title: "", url: "" }]).map((previewLink, index) => (
                    <div key={index} className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        value={previewLink.title || ""}
                        onChange={(event) =>
                          updateQaRequestPreviewLink(index, "title", event.target.value)
                        }
                        placeholder={`Titolo preview ${index + 1}`}
                        className="h-11 text-sm sm:w-2/5"
                      />
                      <Input
                        value={previewLink.url || ""}
                        onChange={(event) =>
                          updateQaRequestPreviewLink(index, "url", event.target.value)
                        }
                        placeholder="https://..."
                        className="h-11 min-w-0 flex-1 text-sm"
                      />
                      {(qaRequestForm.preview_links || []).length > 1 && (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-11 w-11 shrink-0 rounded-xl"
                          onClick={() => removeQaRequestPreviewLink(index)}
                          aria-label={`Rimuovi preview ${index + 1}`}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className={sidebarLabelClass}>Note per il review</label>
                <Textarea
                  value={qaRequestForm.review_notes}
                  onChange={(event) =>
                    setQaRequestForm((prev) => ({ ...prev, review_notes: event.target.value }))
                  }
                  placeholder="Contesto, punti critici o note utili per il controllo."
                  className="min-h-[120px] resize-y text-sm leading-6"
                />
              </div>

              <div className="space-y-1.5">
                <label className={sidebarLabelClass}>Come testarlo</label>
                <Textarea
                  value={qaRequestForm.test_instructions}
                  onChange={(event) =>
                    setQaRequestForm((prev) => ({ ...prev, test_instructions: event.target.value }))
                  }
                  placeholder="Passaggi rapidi per validare la preview."
                  className="min-h-[120px] resize-y text-sm leading-6"
                />
              </div>
            </div>
          </div>

          <div className="shrink-0 border-t border-border/70 px-6 py-4 sm:px-7 sm:py-5">
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                className="h-10 rounded-xl text-sm sm:min-w-[140px]"
                onClick={() => setQaRequestDialog(false)}
                disabled={submittingQaRequest}
              >
                Annulla
              </Button>
              <Button
                className="h-10 rounded-xl bg-violet-600 text-sm text-white hover:bg-violet-700 sm:min-w-[180px]"
                onClick={handleQaRequestSubmit}
                disabled={
                  submittingQaRequest ||
                  normalizeQaPreviewEntries(qaRequestForm.preview_links).length === 0
                }
              >
                {submittingQaRequest ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Invia in review
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={qaRejectDialog} onOpenChange={setQaRejectDialog}>
        <DialogContent className="flex w-[calc(100vw-32px)] max-h-[calc(100vh-112px)] max-w-xl flex-col gap-0 overflow-hidden rounded-[30px] border border-border/70 bg-card p-0 shadow-[var(--shadow-hover)] sm:w-[calc(100vw-64px)] sm:max-h-[calc(100vh-128px)]">
          <DialogHeader className="shrink-0 border-b border-border/70 px-6 py-5 text-left sm:px-7 sm:py-6">
            <p className={sectionEyebrowClass}>QA / Review</p>
            <DialogTitle className="text-2xl font-semibold tracking-tight text-foreground">
              Rifiuta preview
            </DialogTitle>
            <DialogDescription className="text-sm">
              Il developer ricevera un ticket di bug fix prima del prossimo ticket in new.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 sm:px-7 sm:py-5">
            <div className="space-y-1.5 rounded-[24px] bg-muted/20 p-4 sm:p-5">
              <label className={sidebarLabelClass}>Cosa va fixato *</label>
              <Textarea
                value={qaRejectNotes}
                onChange={(event) => setQaRejectNotes(event.target.value)}
                placeholder="Spiega cosa non va e cosa deve essere corretto prima di chiudere il test."
                className="min-h-[160px] resize-y text-sm leading-6"
              />
            </div>
          </div>

          <div className="shrink-0 border-t border-border/70 px-6 py-4 sm:px-7 sm:py-5">
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                className="h-10 rounded-xl text-sm sm:min-w-[140px]"
                onClick={() => setQaRejectDialog(false)}
                disabled={submittingQaDecision}
              >
                Annulla
              </Button>
              <Button
                variant="destructive"
                className="h-10 rounded-xl text-sm sm:min-w-[180px]"
                onClick={handleRejectQaReview}
                disabled={submittingQaDecision || !String(qaRejectNotes || "").trim()}
              >
                {submittingQaDecision ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Rifiuta preview
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={postPreviewDialog} onOpenChange={setPostPreviewDialog}>
        <DialogContent className="flex w-[calc(100vw-32px)] max-h-[calc(100vh-112px)] max-w-xl flex-col gap-0 overflow-hidden rounded-[30px] border border-border/70 bg-card p-0 shadow-[var(--shadow-hover)] sm:w-[calc(100vw-64px)] sm:max-h-[calc(100vh-128px)]">
          <DialogHeader className="shrink-0 border-b border-border/70 px-6 py-5 text-left sm:px-7 sm:py-6">
            <p className={sectionEyebrowClass}>Post-preview</p>
            <DialogTitle className="text-2xl font-semibold tracking-tight text-foreground">
              Richiedi modifica post-preview
            </DialogTitle>
            <DialogDescription className="text-sm">
              Viene creata una task collegata al ticket principale e inserita prima della prossima attivita pianificata del developer scelto.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 sm:px-7 sm:py-5">
            <div className="space-y-1.5 rounded-[24px] bg-muted/20 p-4 sm:p-5">
              <label className={sidebarLabelClass}>Cosa va modificato *</label>
              <Textarea
                value={postPreviewNotes}
                onChange={(event) => setPostPreviewNotes(event.target.value)}
                placeholder="Riassumi la richiesta del cliente e cosa deve essere aggiornato."
                className="min-h-[160px] resize-y text-sm leading-6"
              />
              <div className="grid gap-4 pt-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <label className={sidebarLabelClass}>Effort previsto (h) *</label>
                  <Input
                    type="number"
                    min="0.5"
                    step="0.5"
                    value={postPreviewEffortInput}
                    onChange={(event) => setPostPreviewEffortInput(event.target.value)}
                    className="h-11 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className={sidebarLabelClass}>Developer assegnatario *</label>
                  <Select
                    value={postPreviewAssigneeId}
                    onValueChange={setPostPreviewAssigneeId}
                  >
                    <SelectTrigger className="h-11 text-sm">
                      <SelectValue placeholder="Seleziona developer" />
                    </SelectTrigger>
                    <SelectContent>
                      {postPreviewAssignableDevelopers.map((developer) => (
                        <SelectItem key={developer.id} value={developer.id}>
                          {developer.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>

          <div className="shrink-0 border-t border-border/70 px-6 py-4 sm:px-7 sm:py-5">
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                className="h-10 rounded-xl text-sm sm:min-w-[140px]"
                onClick={() => setPostPreviewDialog(false)}
                disabled={submittingPostPreviewChange}
              >
                Annulla
              </Button>
              <Button
                className="h-10 rounded-xl bg-amber-600 text-sm text-white hover:bg-amber-700 sm:min-w-[180px]"
                onClick={handlePostPreviewChangeSubmit}
                disabled={postPreviewSubmitDisabled}
              >
                {submittingPostPreviewChange ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Crea task
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={liveOpsDialog} onOpenChange={setLiveOpsDialog}>
        <DialogContent className="flex w-[calc(100vw-32px)] max-h-[calc(100vh-112px)] max-w-2xl flex-col gap-0 overflow-hidden rounded-[30px] border border-border/70 bg-card p-0 shadow-[var(--shadow-hover)] sm:w-[calc(100vw-64px)] sm:max-h-[calc(100vh-128px)]">
          <DialogHeader className="shrink-0 border-b border-border/70 px-6 py-5 text-left sm:px-7 sm:py-6">
            <p className={sectionEyebrowClass}>Live operations</p>
            <DialogTitle className="text-2xl font-semibold tracking-tight text-foreground">
              Richiedi {getLiveOperationLabel(liveOpsForm.operation_type).toLowerCase()}
            </DialogTitle>
            <DialogDescription className="text-sm">
              Viene creata una task operativa e inserita prima della prossima attivita pianificata del developer scelto.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 sm:px-7 sm:py-5">
            <div className="space-y-4 rounded-[24px] bg-muted/20 p-4 sm:p-5">
              <div className="space-y-1.5">
                <label className={sidebarLabelClass}>Operazione</label>
                <Select
                  value={liveOpsForm.operation_type}
                  onValueChange={(value) =>
                    setLiveOpsForm((prev) => {
                      const nextType = normalizeLiveOperationType(value);
                      return {
                        ...prev,
                        operation_type: nextType,
                        split: nextType === "stop" ? "" : prev.split,
                        target: nextType === "stop" ? "" : prev.target,
                      };
                    })
                  }
                >
                  <SelectTrigger className="h-11 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(LIVE_OPERATION_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <label className={sidebarLabelClass}>Effort previsto (h) *</label>
                  <Input
                    type="number"
                    min="0.5"
                    step="0.5"
                    value={liveOpsForm.effort_hours}
                    onChange={(event) =>
                      setLiveOpsForm((prev) => ({ ...prev, effort_hours: event.target.value }))
                    }
                    className="h-11 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className={sidebarLabelClass}>Developer assegnatario *</label>
                  <Select
                    value={liveOpsForm.assignee_id || ""}
                    onValueChange={(value) =>
                      setLiveOpsForm((prev) => ({ ...prev, assignee_id: value }))
                    }
                  >
                    <SelectTrigger className="h-11 text-sm">
                      <SelectValue placeholder="Seleziona developer" />
                    </SelectTrigger>
                    <SelectContent>
                      {assignableDevelopers.map((developer) => (
                        <SelectItem key={developer.id} value={developer.id}>
                          {developer.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {isStopLiveOperation ? (
                <div className="space-y-1.5">
                  <label className={sidebarLabelClass}>Esito test *</label>
                  <Select
                    value={liveOpsForm.outcome || ""}
                    onValueChange={(value) =>
                      setLiveOpsForm((prev) => ({ ...prev, outcome: value }))
                    }
                  >
                    <SelectTrigger className="h-11 text-sm">
                      <SelectValue placeholder="Seleziona esito" />
                    </SelectTrigger>
                    <SelectContent>
                      {REPORT_OUTCOME_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    L&apos;esito verra salvato automaticamente nel ticket principale.
                  </p>
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className={sidebarLabelClass}>Split traffico *</label>
                    <Input
                      value={liveOpsForm.split}
                      onChange={(event) =>
                        setLiveOpsForm((prev) => ({ ...prev, split: event.target.value }))
                      }
                      placeholder="Es. 50/50, 100% variant"
                      className="h-11 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className={sidebarLabelClass}>Target *</label>
                    <Input
                      value={liveOpsForm.target}
                      onChange={(event) =>
                        setLiveOpsForm((prev) => ({ ...prev, target: event.target.value }))
                      }
                      placeholder="Es. Mobile returning users"
                      className="h-11 text-sm"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label className={sidebarLabelClass}>Note operative</label>
                <Textarea
                  value={liveOpsForm.notes}
                  onChange={(event) =>
                    setLiveOpsForm((prev) => ({ ...prev, notes: event.target.value }))
                  }
                  placeholder="Dettagli utili per esecuzione e controllo."
                  className="min-h-[120px] resize-y text-sm leading-6"
                />
              </div>
            </div>
          </div>

          <div className="shrink-0 border-t border-border/70 px-6 py-4 sm:px-7 sm:py-5">
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                className="h-10 rounded-xl text-sm sm:min-w-[140px]"
                onClick={() => setLiveOpsDialog(false)}
                disabled={submittingLiveOps}
              >
                Annulla
              </Button>
              <Button
                className="h-10 rounded-xl bg-violet-600 text-sm text-white hover:bg-violet-700 sm:min-w-[190px]"
                onClick={handleLiveOpsRequestSubmit}
                disabled={liveOpsSubmitDisabled}
              >
                {submittingLiveOps ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Invia richiesta
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-900">Elimina ticket</h3>
                <p className="text-xs text-gray-500 mt-1">
                  Sei sicuro? Questa azione non può essere annullata.
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Button
                size="sm"
                className="w-full bg-red-600 hover:bg-red-700 text-white h-9 text-xs"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? "Eliminazione..." : "Sì, elimina"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="w-full h-9 text-xs"
                onClick={() => setConfirmDelete(false)}
              >
                Annulla
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1.65fr)_360px]">
         {/* Main content */}
         <div className="min-w-0 space-y-4">
          <Card className={surfaceCardClass}>
            <CardContent className="p-6 lg:p-7">
              <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_240px]">
                <div className="min-w-0 space-y-5">
                  {ticket.description && (
                    <div className="space-y-2">
                      <p className={sectionEyebrowClass}>Descrizione</p>
                      <div className="rounded-2xl bg-muted/35 p-5">
                        <MarkdownContent className="text-[15px] text-foreground/90">
                          {ticket.description}
                        </MarkdownContent>
                      </div>
                    </div>
                  )}
                  {!ticket.description && (
                    <div className="space-y-2">
                      <p className={sectionEyebrowClass}>Descrizione</p>
                      <div className="rounded-2xl border border-dashed border-border/70 bg-muted/15 p-5 text-sm text-muted-foreground">
                        Nessuna descrizione disponibile.
                      </div>
                    </div>
                  )}
                  <div className="grid gap-4 xl:grid-cols-2">
                    <div className="space-y-2">
                      <p className={sectionEyebrowClass}>Tracciamenti richiesti</p>
                      <div className="rounded-2xl bg-muted/35 p-5">
                        <MarkdownContent emptyText="Nessun tracking specificato.">
                          {ticket.required_tracking}
                        </MarkdownContent>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <p className={sectionEyebrowClass}>Reference links</p>
                      <div className="overflow-hidden rounded-2xl bg-muted/35 p-5">
                        {referenceLinks.length > 0 ? (
                          <div className="flex flex-col gap-2.5">
                            {referenceLinks.map((referenceLink, index) => (
                              <a
                                key={`${referenceLink}-${index}`}
                                href={referenceLink}
                                target="_blank"
                                rel="noreferrer"
                                className="flex w-full max-w-full min-w-0 overflow-hidden items-center gap-2 rounded-2xl border border-border/60 bg-background/90 px-3.5 py-3 text-sm transition-colors hover:border-primary/25 hover:bg-primary/5"
                              >
                                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-primary" />
                                <div className="min-w-0 flex-1 overflow-hidden">
                                  <p className="truncate font-medium text-foreground">{getReferenceLinkLabel(referenceLink, index)}</p>
                                  <p className="truncate text-xs text-muted-foreground">{referenceLink}</p>
                                </div>
                              </a>
                            ))}
                          </div>
                        ) : (
                          <div className="text-sm text-muted-foreground">Nessuna reference disponibile.</div>
                        )}
                      </div>
                    </div>
                  </div>
                  {isPostPreviewChangeTicket && mainTicketRecord && mainTicketRecord.id !== ticket.id && (
                    <div className="space-y-2">
                      <p className={sectionEyebrowClass}>Collegamento ticket</p>
                      <div className="rounded-2xl border border-amber-200/80 bg-amber-50/80 p-5 dark:border-amber-500/30 dark:bg-amber-500/10">
                        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
                          <div className="min-w-0">
                            <p className={sidebarLabelClass}>Ticket principale</p>
                            <Link
                              to={buildTicketUrl(mainTicketRecord.id)}
                              className="mt-2 inline-flex max-w-full text-sm font-semibold text-primary hover:underline"
                            >
                              <span className="truncate">{mainTicketRecord.title}</span>
                            </Link>
                            <p className="mt-2 text-xs leading-5 text-amber-900/80 dark:text-amber-100/80">
                              Questa task e collegata alla richiesta originale: usa il ticket principale per recuperare brief, contesto e stato del test.
                            </p>
                          </div>
                          <div className="rounded-2xl bg-background/80 px-4 py-3">
                            <p className={sidebarLabelClass}>Tipo task</p>
                            <p className="mt-1 text-sm font-semibold text-foreground">Modifica post-preview</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  {(reviewPreviewLinks.length > 0 || reviewPreviewSource?.qa_review_notes || reviewPreviewSource?.qa_test_instructions || isQaReviewTicket) && (
                    <div className="space-y-2">
                      <p className={sectionEyebrowClass}>QA / Review</p>
                      <div className="overflow-hidden rounded-2xl border border-cyan-200/70 bg-cyan-50/70 p-5 dark:border-cyan-500/25 dark:bg-cyan-500/10">
                        <div className={`grid gap-4 ${hasQaSidebarMeta ? "2xl:grid-cols-[minmax(0,1fr)_220px]" : ""}`}>
                          <div className="min-w-0 space-y-4">
                            {reviewPreviewLinks.length > 0 && (
                              <div className="min-w-0 space-y-1.5">
                                <p className={sidebarLabelClass}>
                                  {reviewPreviewLinks.length === 1 ? "Preview" : "Preview disponibili"}
                                </p>
                                <div className="space-y-2">
                                  {reviewPreviewLinks.map((previewLink) => (
                                    <a
                                      key={previewLink.url}
                                      href={previewLink.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      title={previewLink.url}
                                      className="flex w-full max-w-full min-w-0 overflow-hidden items-center gap-2 rounded-2xl border border-cyan-200/70 bg-background/90 px-3.5 py-3 text-sm transition-colors hover:border-primary/25 hover:bg-primary/5 dark:border-cyan-500/25"
                                    >
                                      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-primary" />
                                      <div className="min-w-0 flex-1">
                                        <p className="truncate font-medium text-foreground">
                                          {previewLink.title}
                                        </p>
                                        <p className="truncate text-xs text-muted-foreground">
                                          {previewLink.url}
                                        </p>
                                      </div>
                                    </a>
                                  ))}
                                </div>
                              </div>
                            )}

                            {reviewPreviewSource?.qa_review_notes && (
                              <div className="min-w-0 space-y-1.5">
                                <p className={sidebarLabelClass}>Note per il review</p>
                                <div className="rounded-2xl bg-background/80 px-4 py-3">
                                  <MarkdownContent>{reviewPreviewSource.qa_review_notes}</MarkdownContent>
                                </div>
                              </div>
                            )}

                            {reviewPreviewSource?.qa_test_instructions && (
                              <div className="min-w-0 space-y-1.5">
                                <p className={sidebarLabelClass}>Come testarlo</p>
                                <div className="rounded-2xl bg-background/80 px-4 py-3">
                                  <MarkdownContent>{reviewPreviewSource.qa_test_instructions}</MarkdownContent>
                                </div>
                              </div>
                            )}
                          </div>

                          {hasQaSidebarMeta && (
                            <div className="space-y-3">
                              {mainTicketRecord && mainTicketRecord.id !== ticket.id && (
                                <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
                                  <p className={sidebarLabelClass}>Ticket principale</p>
                                  <Link
                                    to={buildTicketUrl(mainTicketRecord.id)}
                                    className="mt-2 inline-flex text-sm font-medium text-primary hover:underline"
                                  >
                                    {mainTicketRecord.title}
                                  </Link>
                                </div>
                              )}
                              {isQaReviewTicket && qaSourceTicketRecord && qaSourceTicketRecord.id !== mainTicketRecord?.id && (
                                <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
                                  <p className={sidebarLabelClass}>Ticket da validare</p>
                                  <Link
                                    to={buildTicketUrl(qaSourceTicketRecord.id)}
                                    className="mt-2 inline-flex text-sm font-medium text-primary hover:underline"
                                  >
                                    {qaSourceTicketRecord.title}
                                  </Link>
                                </div>
                              )}
                              {(isQaFixTicket || isQaReviewTicket || isPostPreviewChangeTicket) && (
                                <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
                                  <p className={sidebarLabelClass}>Tipo task</p>
                                  <p className="mt-2 text-sm font-medium text-foreground">
                                    {isQaReviewTicket
                                      ? "Review preview"
                                      : isPostPreviewChangeTicket
                                        ? "Modifica post-preview"
                                        : "QA fix"}
                                  </p>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                  {(ticketKind === "main" || isLiveOpsTicket) && (ticket?.live_operation_type || ticket?.live_split || ticket?.live_target || ticket?.live_notes || ticket?.live_confirmation_status) && (
                    <div className="space-y-2">
                      <p className={sectionEyebrowClass}>Live operation</p>
                      <div className="rounded-2xl border border-indigo-200/70 bg-indigo-50/70 p-5 dark:border-indigo-500/25 dark:bg-indigo-500/10">
                        <div className={liveOperationGridClass}>
                          <div className="rounded-2xl bg-background/85 px-4 py-3">
                            <p className={sidebarLabelClass}>Tipo richiesta</p>
                            <p className="mt-1 text-sm font-semibold text-foreground">
                              {liveOperationLabel}
                            </p>
                          </div>
                          {liveOperationMeta.showSplitTarget && (
                            <div className="rounded-2xl bg-background/85 px-4 py-3">
                              <p className={sidebarLabelClass}>Split traffico</p>
                              <p className="mt-1 text-sm font-semibold text-foreground">
                                {ticket.live_split || "—"}
                              </p>
                            </div>
                          )}
                          {liveOperationMeta.showSplitTarget && (
                            <div className="rounded-2xl bg-background/85 px-4 py-3">
                              <p className={sidebarLabelClass}>Target</p>
                              <p className="mt-1 text-sm font-semibold text-foreground">
                                {ticket.live_target || "—"}
                              </p>
                            </div>
                          )}
                          <div className="rounded-2xl bg-background/85 px-4 py-3">
                            <p className={sidebarLabelClass}>{liveOperationMeta.confirmationTitle}</p>
                            <Badge
                              variant="outline"
                              className={`mt-1 border-0 text-xs ${liveOperationMeta.confirmationBadgeClass}`}
                            >
                              {liveOperationMeta.confirmationLabel}
                            </Badge>
                          </div>
                        </div>
                        {ticket.live_notes && (
                          <div className="mt-3 rounded-2xl bg-background/85 px-4 py-3">
                            <p className={sidebarLabelClass}>Note operative</p>
                            <div className="mt-1 whitespace-pre-wrap text-sm leading-6 text-foreground/85">
                              {ticket.live_notes}
                            </div>
                          </div>
                        )}
                        {isLiveOpsTicket && mainTicketRecord && (
                          <div className="mt-3 rounded-2xl bg-background/85 px-4 py-3">
                            <p className={sidebarLabelClass}>Ticket principale</p>
                            <Link
                              to={buildTicketUrl(mainTicketRecord.id)}
                              className="mt-1 inline-flex text-sm font-medium text-primary hover:underline"
                            >
                              {mainTicketRecord.title}
                            </Link>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {ticketKind === "main" && phaseEvents.length > 0 && (
                    <div className="space-y-2">
                      <p className={sectionEyebrowClass}>Fasi del test</p>
                      <div className="rounded-2xl border border-border/65 bg-muted/20 p-5">
                        <div className="space-y-3">
                          {phaseEvents.map((event, index) => {
                            const toneClasses =
                              event.tone === "success"
                                ? "bg-emerald-500/80"
                                : event.tone === "warning"
                                  ? "bg-amber-500/80"
                                  : "bg-primary/75";
                            return (
                              <div key={event.id} className="flex gap-3">
                                <div className="flex w-4 flex-col items-center pt-1">
                                  <div className={`h-2.5 w-2.5 rounded-full ${toneClasses}`} />
                                  {index < phaseEvents.length - 1 && (
                                    <div className="mt-1 h-full w-px bg-border/70" />
                                  )}
                                </div>
                                <div className="min-w-0 flex-1 rounded-2xl border border-border/60 bg-background/80 px-4 py-3">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-sm font-semibold text-foreground">{event.title}</p>
                                    {event.cycle > 1 && (
                                      <Badge variant="outline" className="rounded-full px-2 py-0 text-[10px] uppercase tracking-[0.16em]">
                                        Ciclo {event.cycle}
                                      </Badge>
                                    )}
                                  </div>
                                  {event.description && (
                                    <p className="mt-1 text-sm leading-6 text-foreground/80">{event.description}</p>
                                  )}
                                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                                    <span>{event.actor}</span>
                                    <span>•</span>
                                    <span>{moment(event.timestamp).format("DD MMM YYYY · HH:mm")}</span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                  {priorityPaused && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50/90 px-4 py-4 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                      Il developer assegnato ha segnalato che mancano i dati necessari per procedere. Il ticket resta a priorita 0 finche il blocco non viene rimosso.
                    </div>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-3 2xl:grid-cols-1">
                  <div className="rounded-2xl border border-border/65 bg-muted/25 p-4">
                    <p className={sectionEyebrowClass}>Created</p>
                    <p className="mt-3 text-sm font-medium text-foreground">{moment(ticket.created_date).format("DD MMM YYYY")}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{ticket.created_by || "—"}</p>
                  </div>
                  <div className="rounded-2xl border border-border/65 bg-muted/25 p-4">
                    <p className={sectionEyebrowClass}>Deadline</p>
                    <p className={`mt-3 text-sm font-medium ${ticket.deadline && moment(ticket.deadline).isBefore(moment()) ? "text-rose-600" : "text-foreground"}`}>
                      {ticket.deadline ? moment(ticket.deadline).format("DD MMM YYYY") : "Nessuna deadline"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {ticket.deadline ? (moment(ticket.deadline).isBefore(moment()) ? "Scaduta" : "Pianificata") : "Da definire"}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border/65 bg-muted/25 p-4">
                    <p className={sectionEyebrowClass}>Effort</p>
                    <div className="mt-3 space-y-1">
                      <p className="text-sm font-medium text-foreground">Previsto: {plannedEffort ? `${plannedEffort}h` : "—"}</p>
                      <p className="text-sm font-medium text-foreground">Reale: {actualEffort ? `${actualEffort}h` : "—"}</p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Comments */}
          <Card className={surfaceCardClass}>
            <CardHeader className="pb-0">
              <div className="space-y-1">
                <p className={sectionEyebrowClass}>Collaborazione</p>
                <CardTitle className="text-lg font-semibold">Comments</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {(ticket.comments || []).map((c, i) => (
                <div key={i} className="flex gap-3 rounded-2xl border border-border/60 bg-muted/20 p-4">
                  <Avatar className="w-8 h-8 flex-shrink-0 border border-border/60">
                    <AvatarFallback className="text-[10px] bg-background">{c.user?.[0]?.toUpperCase() || "U"}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-xs font-semibold text-foreground">{c.user}</span>
                        <span className="text-[10px] text-muted-foreground">{moment(c.timestamp).fromNow()}</span>
                        {c.edited_at && (
                          <span className="text-[10px] text-muted-foreground/80">(modificato)</span>
                        )}
                      </div>
                      {(canEditComment(c) || canDeleteComment(c)) && (
                        <div className="flex items-center gap-1.5">
                          {canEditComment(c) && editingCommentIndex !== i && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 rounded-lg px-2 text-[11px] text-muted-foreground hover:text-foreground"
                              onClick={() => startEditingComment(i)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Modifica
                            </Button>
                          )}
                          {canDeleteComment(c) && editingCommentIndex !== i && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 rounded-lg px-2 text-[11px] text-muted-foreground hover:text-destructive"
                              onClick={() => handleDeleteComment(i)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Elimina
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                    {editingCommentIndex === i ? (
                      <div className="mt-2 space-y-3 rounded-xl border border-primary/20 bg-background/90 px-3 py-3">
                        <Textarea
                          ref={editingCommentTextareaRef}
                          value={editingCommentText}
                          onChange={(e) => setEditingCommentText(e.target.value)}
                          className="min-h-[110px] resize-y text-sm leading-6"
                          placeholder="Aggiorna il commento..."
                          onKeyDown={(e) => {
                            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                              e.preventDefault();
                              handleSaveEditedComment(i);
                            }
                            if (e.key === "Escape") {
                              e.preventDefault();
                              cancelEditingComment();
                            }
                          }}
                        />
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[11px] text-muted-foreground">
                            Supporta markdown. Salva con Cmd/Ctrl + Invio.
                          </span>
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-9 rounded-xl px-3"
                              onClick={cancelEditingComment}
                            >
                              <X className="h-3.5 w-3.5" />
                              Annulla
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              className="h-9 rounded-xl px-3"
                              disabled={!editingCommentText.trim() || updateMutation.isPending}
                              onClick={() => handleSaveEditedComment(i)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Salva modifiche
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-1.5 overflow-hidden rounded-xl border border-border/50 bg-background/80 px-3 py-2.5">
                        <MarkdownContent allowMentions>{c.text}</MarkdownContent>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {(!ticket.comments || ticket.comments.length === 0) && (
                <div className="rounded-2xl border border-dashed border-border/65 bg-muted/15 px-4 py-8 text-center text-sm text-muted-foreground">
                  Nessun commento ancora.
                </div>
              )}
              <div className="space-y-3 border-t border-border/70 pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 rounded-lg px-2.5 text-xs font-semibold"
                    onClick={() => insertCommentFormatting("bold")}
                  >
                    B
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 rounded-lg px-2.5 text-xs italic"
                    onClick={() => insertCommentFormatting("italic")}
                  >
                    I
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 rounded-lg px-2.5 text-xs"
                    onClick={() => insertCommentFormatting("link")}
                  >
                    Link
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 rounded-lg px-2.5 text-xs"
                    onClick={() => insertCommentFormatting("list")}
                  >
                    Lista
                  </Button>
                  <span className="text-[11px] text-muted-foreground">
                    Supporta grassetto, corsivo e link. Invia con Cmd/Ctrl + Invio.
                  </span>
                </div>
                {clientTeamCommentTargets.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-medium text-muted-foreground">Tagga team cliente:</span>
                    {clientTeamCommentTargets.map((target) => (
                      <Button
                        key={`${target.id || target.email}-${target.role}`}
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 rounded-full px-2.5 text-[11px]"
                        onClick={() => insertCommentMention(target)}
                      >
                        @{target.name}
                      </Button>
                    ))}
                  </div>
                )}
                <Textarea
                  ref={commentTextareaRef}
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  placeholder="Scrivi un commento, aggiungi un link o lascia indicazioni operative..."
                  className="min-h-[132px] resize-y text-sm leading-6"
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      e.preventDefault();
                      handleComment();
                    }
                  }}
                />
                <div className="flex justify-end">
                  <Button size="sm" onClick={handleComment} disabled={!comment.trim()} className="h-10 rounded-xl px-4">
                    <Send className="w-3.5 h-3.5" />
                    Invia commento
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Audit Log */}
          <Card className={surfaceCardClass}>
            <CardHeader className="pb-0">
              <div className="space-y-1">
                <p className={sectionEyebrowClass}>Storico</p>
                <CardTitle className="text-lg font-semibold">Activity log</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {(ticket.audit_log || []).slice().reverse().map((entry, i) => (
                  <div key={i} className="flex items-start gap-3 rounded-2xl border border-border/60 bg-muted/20 px-4 py-3 text-xs last:border-border/60">
                    <div className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary/60" />
                    <div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-foreground/90">{entry.details}</span>
                        <span className="text-[11px] font-medium text-muted-foreground">
                          da {entry.user || "Sistema"}
                        </span>
                        <span className="text-muted-foreground">{moment(entry.timestamp).fromNow()}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-4 2xl:sticky 2xl:top-4 self-start">
          <TimeScheduleCard
            ticket={ticket}
            canEdit={canEditTimes}
            onUpdate={async (options = {}) => {
              await applyRebalanceForDevelopers([ticket.assignee_id], options);
              await queryClient.invalidateQueries({ queryKey: ["ticket", ticketId] });
              await queryClient.invalidateQueries({ queryKey: ["tickets"] });
              await notifyClientSupervisor({
                title: "Pianificazione ticket aggiornata",
                body: ticket.title,
                metadata: {
                  reason: "ticket_schedule_updated",
                },
              });
            }}
          />

          <Card className={surfaceCardClass}>
            <CardHeader className="pb-0">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className={sectionEyebrowClass}>Notifiche</p>
                  <CardTitle className="text-lg font-semibold">Watcher</CardTitle>
                </div>
                <Badge variant="secondary" className="rounded-full px-2.5 py-1 text-[10px]">
                  {ticketWatchers.length}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                type="button"
                variant={isCurrentUserWatching ? "secondary" : "outline"}
                className="h-9 w-full rounded-xl text-xs"
                onClick={handleToggleCurrentWatcher}
                disabled={!user?.id && !user?.email}
              >
                <Bell className="h-3.5 w-3.5" />
                {isCurrentUserWatching ? "Non seguire piu" : "Segui ticket"}
              </Button>

              {canManageWatchers && (
                <div className="flex gap-2">
                  <Select value={watcherToAddId} onValueChange={setWatcherToAddId}>
                    <SelectTrigger className="h-9 min-w-0 flex-1 text-sm">
                      <SelectValue placeholder="Aggiungi watcher" />
                    </SelectTrigger>
                    <SelectContent>
                      {watcherOptions.map((candidate) => (
                        <SelectItem key={candidate.id || candidate.email} value={candidate.id || candidate.email}>
                          {candidate.full_name || candidate.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    size="sm"
                    className="h-9 shrink-0 rounded-xl"
                    onClick={handleAddWatcher}
                    disabled={!selectedWatcherToAdd}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}

              {ticketWatchers.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {ticketWatchers.map((watcher) => {
                    const canRemoveWatcher = canManageWatchers || watcherMatchesUser(watcher, user);
                    return (
                      <span
                        key={getWatcherKey(watcher)}
                        className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/70 bg-muted/35 px-2.5 py-1 text-[11px] text-foreground"
                      >
                        <span className="truncate">{watcher.name || watcher.email}</span>
                        {canRemoveWatcher && (
                          <button
                            type="button"
                            className="rounded-full text-muted-foreground transition-colors hover:text-destructive"
                            onClick={() => handleRemoveWatcher(watcher)}
                            aria-label={`Rimuovi ${watcher.name || watcher.email} dai watcher`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </span>
                    );
                  })}
                </div>
              ) : (
                <p className="rounded-2xl border border-dashed border-border/65 bg-muted/15 px-3 py-3 text-xs text-muted-foreground">
                  Nessun watcher impostato.
                </p>
              )}
            </CardContent>
          </Card>
          
          {/* Continuation indicator */}
          {ticket.audit_log && ticket.audit_log.some(a => a.action === "auto_split") && (
            <Card className="rounded-[28px] border border-blue-200 bg-blue-50/90 shadow-[var(--shadow-soft)] dark:border-blue-500/30 dark:bg-blue-500/10">
              <CardContent className="p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-700 dark:text-blue-300 mb-2">Continua il giorno dopo</p>
                {(() => {
                  const splitEntry = ticket.audit_log.find(a => a.action === "auto_split");
                  return splitEntry ? (
                    <p className="text-[11px] text-blue-700/80 dark:text-blue-200/80">{splitEntry.details}</p>
                  ) : null;
                })()}
              </CardContent>
            </Card>
          )}
          
          <Card className={surfaceCardClass}>
            <CardHeader className="pb-0">
              <div className="space-y-1">
                <p className={sectionEyebrowClass}>Gestione</p>
                <CardTitle className="text-lg font-semibold">Azioni e planning</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {(canResolveQaReview ||
                canRequestPostPreviewChange ||
                canRequestLiveOps ||
                (isLiveOpsTicket && canManageLiveOps && !isTicketClosed(ticket)) ||
                canManageUrgency) && (
                <div className="space-y-3 rounded-2xl border border-border/60 bg-muted/10 p-3">
                  <p className={sectionEyebrowClass}>Azioni operative</p>
              {canResolveQaReview && (
                <div className="rounded-2xl border border-cyan-200 bg-cyan-50/90 p-4 dark:border-cyan-500/30 dark:bg-cyan-500/10">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-700 dark:text-cyan-300">
                    Review actions
                  </p>
                  <p className="mt-2 text-sm text-cyan-800 dark:text-cyan-100">
                    Controlla la preview, poi approva per chiudere il ticket oppure rifiuta e crea un fix in pipeline dev.
                  </p>
                  <div className="mt-4 flex flex-col gap-2">
                    <Button
                      type="button"
                      className="h-9 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700"
                      onClick={handleApproveQaReview}
                      disabled={submittingQaDecision}
                    >
                      {submittingQaDecision ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Approva preview
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 rounded-xl border-rose-200 text-rose-600 hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-300 dark:hover:bg-rose-500/10"
                      onClick={() => setQaRejectDialog(true)}
                      disabled={submittingQaDecision}
                    >
                      Rifiuta preview
                    </Button>
                  </div>
                </div>
              )}

              {canRequestPostPreviewChange && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50/90 p-4 sm:p-5 dark:border-amber-500/30 dark:bg-amber-500/10">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-800 dark:text-amber-300">
                    Post-preview
                  </p>
                  <p className="mt-2 text-sm text-amber-900 dark:text-amber-100">
                    Se il cliente chiede modifiche dopo l&apos;approvazione, crea una task collegata e scegli effort e developer.
                  </p>
                  {openPostPreviewChangeTickets.length > 0 && (
                    <p className="mt-2 text-[11px] text-amber-800/90 dark:text-amber-200/90">
                      C&apos;e gia una modifica post-preview aperta in pipeline dev.
                    </p>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-3 h-auto min-h-10 w-full rounded-xl px-3 py-2 text-center text-xs leading-tight whitespace-normal"
                    onClick={openPostPreviewChangeDialog}
                    disabled={openPostPreviewChangeTickets.length > 0}
                  >
                    Richiedi modifica post-preview
                  </Button>
                </div>
              )}

              {canRequestLiveOps && (
                <div className="rounded-2xl border border-indigo-200 bg-indigo-50/90 p-4 sm:p-5 dark:border-indigo-500/30 dark:bg-indigo-500/10">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-indigo-700 dark:text-indigo-300">
                    Live operations
                  </p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-xl bg-background/65 px-3.5 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-700/80 dark:text-indigo-200/80">
                        Stato corrente
                      </p>
                      <p className="mt-1 text-sm font-semibold text-indigo-900 dark:text-indigo-50">
                        {liveStateLabel}
                      </p>
                    </div>
                    <div className="rounded-xl bg-background/65 px-3.5 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-700/80 dark:text-indigo-200/80">
                        {liveOperationMeta.confirmationTitle}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-indigo-900 dark:text-indigo-50">
                        {liveOperationMeta.confirmationLabel}
                      </p>
                    </div>
                  </div>
                  {openLiveOpsTickets.length > 0 && (
                    <p className="mt-1 text-[11px] text-indigo-700/90 dark:text-indigo-200/90">
                      C&apos;e gia una richiesta operativa aperta in pipeline tech supervisor.
                    </p>
                  )}
                  <div className="mt-4 space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-700/80 dark:text-indigo-200/80">
                      Azioni disponibili
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-auto min-h-10 rounded-xl px-3 py-2 text-center text-xs leading-tight whitespace-normal"
                      onClick={() => openLiveOpsRequestDialog("launch")}
                      disabled={!canRequestLaunch || hasOpenLiveOpsByType.has("launch")}
                    >
                      Richiedi live
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-auto min-h-10 rounded-xl px-3 py-2 text-center text-xs leading-tight whitespace-normal"
                      onClick={() => openLiveOpsRequestDialog("change")}
                      disabled={!canRequestChange || hasOpenLiveOpsByType.has("change")}
                    >
                      Richiedi modifica
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-auto min-h-10 rounded-xl px-3 py-2 text-center text-xs leading-tight whitespace-normal"
                      onClick={() => openLiveOpsRequestDialog("stop")}
                      disabled={!canRequestStop || hasOpenLiveOpsByType.has("stop")}
                    >
                      Richiedi spegnimento
                    </Button>
                    </div>
                  </div>
                </div>
              )}

              {isLiveOpsTicket && canManageLiveOps && !isTicketClosed(ticket) && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/90 p-4 dark:border-emerald-500/30 dark:bg-emerald-500/10">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-700 dark:text-emerald-300">
                    Task live ops
                  </p>
                  <p className="mt-2 text-sm text-emerald-800 dark:text-emerald-100">
                    Quando finisci l&apos;attivita puoi completare la task e aggiornare automaticamente il ticket principale.
                  </p>
                  <Button
                    type="button"
                    className="mt-3 h-9 w-full rounded-xl bg-emerald-600 text-white hover:bg-emerald-700"
                    onClick={async () => {
                      const conflict = getCompletionConflictData("done");
                      if (conflict) {
                        setDoneConflict({
                          ...conflict,
                          liveOpsComplete: true,
                        });
                        return;
                      }
                      await completeLiveOpsTransition();
                    }}
                    disabled={updateMutation.isPending}
                  >
                    Segna operazione completata
                  </Button>
                </div>
              )}

              {canManageUrgency && (
                <div className={`rounded-2xl border p-4 ${
                  isUrgent
                    ? "border-amber-300 bg-amber-50/95 dark:border-amber-400/40 dark:bg-amber-500/15"
                    : "border-amber-200 bg-amber-50/90 dark:border-amber-500/30 dark:bg-amber-500/10"
                }`}>
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-800 dark:text-amber-300">
                          Urgenza pipeline
                        </p>
                        {isUrgent && (
                          <Badge className="rounded-full bg-amber-600 px-2 py-0.5 text-[10px] text-white hover:bg-amber-600">
                            Attiva
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-[11px] text-amber-800/85 dark:text-amber-100/85">
                        {isUrgent
                          ? "Questo ticket resta sopra le priorita normali finche non togli l'urgenza."
                          : "Inserisce questo ticket subito dopo l'attivita in corso del developer e fa slittare il resto."}
                      </p>
                      {isUrgent && ticket.urgent_requested_by && (
                        <p className="mt-1 text-[11px] text-amber-800/75 dark:text-amber-100/75">
                          Attivata da {ticket.urgent_requested_by}
                          {ticket.urgent_requested_at
                            ? ` · ${moment(ticket.urgent_requested_at).format("DD/MM HH:mm")}`
                            : ""}
                        </p>
                      )}
                      {urgencyDisabledReason && (
                        <p className="mt-2 text-[11px] font-medium text-amber-900 dark:text-amber-100">
                          {urgencyDisabledReason}
                        </p>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant={isUrgent ? "outline" : "default"}
                        className={
                          isUrgent
                            ? "mt-3 h-8 rounded-xl border-amber-300 px-3 text-xs text-amber-800 hover:bg-amber-100 dark:border-amber-400/40 dark:text-amber-100 dark:hover:bg-amber-500/20"
                            : "mt-3 h-8 rounded-xl bg-amber-600 px-3 text-xs text-white hover:bg-amber-700"
                        }
                        onClick={isUrgent ? handleUrgencyClear : handleUrgencyRequest}
                        disabled={submittingUrgency || (!isUrgent && Boolean(urgencyDisabledReason))}
                      >
                        {submittingUrgency ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                        {isUrgent ? "Togli urgenza" : "Porta in urgenza"}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
                </div>
              )}

              {/* Status - analysts & admins can change freely; devs can change their assigned tickets */}
              <div className="space-y-4 rounded-2xl border border-border/60 bg-background/40 p-3">
                <p className={sectionEyebrowClass}>Stato e ownership</p>
              {canChangeStatus && (
                <div>
                  <label className={`${sidebarLabelClass} mb-1.5 block`}>Status</label>
                    <Select value={normalizedStatus} onValueChange={handleStatusChange}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {availableStatusEntries.map(([k, v]) => (
                            <SelectItem key={k} value={k}>
                              {v.label}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
              )}

              {canSetReportedOutcome && (
                <div>
                  <label className={`${sidebarLabelClass} mb-1.5 block`}>Esito test</label>
                  <div className="flex gap-2">
                    <Select value={reportedOutcomeInput || ""} onValueChange={setReportedOutcomeInput}>
                      <SelectTrigger className="h-9 text-sm flex-1">
                        <SelectValue placeholder="Seleziona esito" />
                      </SelectTrigger>
                      <SelectContent>
                        {REPORT_OUTCOME_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      onClick={handleReportedOutcomeSave}
                      disabled={!reportedOutcomeInput || reportedOutcomeInput === ticket.reported_outcome}
                      className="h-9"
                    >
                      Set
                    </Button>
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Solo l'analyst del cliente o un admin puo marcare il test come winner, loser o not significant.
                  </p>
                </div>
              )}

              {/* Assignee - only analyst/admin */}
              {canReassignTicket && (
                <div>
                  <label className={`${sidebarLabelClass} mb-1.5 block`}>Assignee</label>
                  <Select value={ticket.assignee_id || ""} onValueChange={handleAssign}>
                    <SelectTrigger
                      className="h-9 text-sm"
                      disabled={normalizeTicketStatus(ticket.status) === "in_progress"}
                    >
                      <SelectValue placeholder="Unassigned" />
                    </SelectTrigger>
                    <SelectContent>
                      {assignableDevelopers.map(d => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name} {suggested && suggested.id === d.id ? "⭐" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {normalizeTicketStatus(ticket.status) === "in_progress" && (
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Un ticket in corso non puo essere riassegnato a un altro developer.
                    </p>
                  )}
                  {suggested && !ticket.assignee_id && (
                    <p className="text-[10px] text-gray-400 mt-1">
                      Suggested: <button onClick={() => handleAssign(suggested.id)} className="text-blue-600 hover:underline">{suggested.name}</button>
                    </p>
                  )}
                </div>
              )}

              {/* Deadline quick edit */}
              <div>
                <label className={`${sidebarLabelClass} mb-1.5 block`}>Deadline</label>
                {canEditDeadline ? (
                  <div className="flex gap-2">
                    <Input
                      type="date"
                      value={deadlineInput}
                      onChange={e => setDeadlineInput(e.target.value)}
                      className="h-9 text-sm flex-1"
                    />
                    <Button
                      size="sm"
                      onClick={handleDeadlineSave}
                      disabled={savingDeadline || (deadlineInput || null) === (ticket.deadline || null)}
                      className="h-9"
                    >
                      {savingDeadline ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Set"}
                    </Button>
                  </div>
                ) : ticket.deadline ? (
                  <p className="text-sm font-medium text-gray-700">{moment(ticket.deadline).format("MMM D, YYYY")}</p>
                ) : (
                  <p className="text-sm text-gray-400 italic">Nessuna deadline</p>
                )}
              </div>

              {/* Effort previsto (planning) */}
              </div>

              <div className="space-y-4 rounded-2xl border border-border/60 bg-background/40 p-3">
                <p className={sectionEyebrowClass}>Effort</p>
              {/* Effort previsto (planning) */}
              <div>
                <label className={`${sidebarLabelClass} mb-1.5 block`}>Effort previsto (h)</label>
                {canEditPlannedEffort ? (
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      value={plannedEffortInput}
                      onChange={e => setPlannedEffortInput(e.target.value)}
                      placeholder={plannedEffort ? `~${plannedEffort}` : "ore previste"}
                      className="h-9 text-sm flex-1"
                    />
                    <Button
                      size="sm"
                      onClick={handlePlannedEffort}
                      disabled={!plannedEffortInput}
                      className="h-9 bg-violet-600 hover:bg-violet-700 text-white"
                    >
                      Set
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-sm font-semibold">
                    <Clock className="w-4 h-4 text-gray-400" /> {plannedEffort ? `${plannedEffort}h` : "—"}
                  </div>
                )}
                {plannedEffort > 0 && (
                  <p className="text-[11px] text-gray-500 mt-1">Attuale: {plannedEffort}h</p>
                )}
                {workedEffort > 0 && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-muted/45 px-3 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Lavorato</p>
                      <p className="mt-0.5 text-sm font-semibold text-foreground">{workedEffort}h</p>
                    </div>
                    <div className="rounded-xl bg-muted/45 px-3 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Rimanente</p>
                      <p className="mt-0.5 text-sm font-semibold text-foreground">{remainingEffort}h</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Effort reale (consuntivo) */}
              <div>
                <label className={`${sidebarLabelClass} mb-1.5 block`}>Effort reale (h)</label>
                {actualEffort > 0 ? (
                  <div className="flex items-center gap-1.5 text-sm font-semibold">
                    <Clock className="w-4 h-4 text-gray-400" /> {actualEffort}h
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 italic">
                    {isTicketClosed(ticket) ? "Non ancora valorizzato" : "Disponibile a consuntivo"}
                  </p>
                )}
                {canEditActualEffort && (
                  <div className="flex gap-2 mt-2">
                    <Input
                      type="number"
                      value={actualEffortInput}
                      onChange={e => setActualEffortInput(e.target.value)}
                      placeholder={actualEffort ? `${actualEffort}` : "ore reali"}
                      className="h-9 text-sm flex-1"
                    />
                    <Button
                      size="sm"
                      onClick={handleActualEffort}
                      disabled={!actualEffortInput}
                      className="h-9"
                    >
                      Set
                    </Button>
                  </div>
                )}
              </div>

              {/* Dev-only call to action */}
              {isAssignedDeveloper && !plannedEffort && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50/90 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
                  <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">Inserisci effort previsto</p>
                  <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-200/85">La pianificazione usa l’effort previsto; quello reale si consuntiva a fine attività.</p>
                </div>
              )}
              </div>

              <div className="space-y-4 rounded-2xl border border-border/60 bg-background/40 p-3">
                <p className={sectionEyebrowClass}>Blocchi e dati tecnici</p>

              {canManageMissingData && (
                <div className={`rounded-2xl border p-3 ${priorityPaused ? "border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10" : "border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10"}`}>
                  <div className="flex items-start gap-2">
                    <AlertTriangle className={`mt-0.5 h-4 w-4 ${priorityPaused ? "text-emerald-600" : "text-amber-600"}`} />
                    <div className="min-w-0 flex-1">
                      <p className={`text-xs font-semibold ${priorityPaused ? "text-emerald-800" : "text-amber-800"}`}>
                        {priorityPaused ? "Ticket sospeso: dati mancanti segnalati" : "Mancano dati per procedere?"}
                      </p>
                      <p className={`mt-1 text-[11px] ${priorityPaused ? "text-emerald-700" : "text-amber-700"}`}>
                        {priorityPaused
                          ? "Puoi riattivare il ticket quando il cliente o il team ha fornito le informazioni necessarie."
                          : "Segnalando il blocco il ticket torna in backlog, va a priorita 0 e il team del cliente riceve una notifica."}
                      </p>
                      <Button
                        size="sm"
                        variant={priorityPaused ? "outline" : "secondary"}
                        className="mt-3 h-8 text-xs"
                        onClick={handleMissingDataToggle}
                      >
                        {priorityPaused ? "Dati ricevuti, riattiva ticket" : "Segnala dati mancanti"}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-2 border-t border-border/70 pt-3">
                {isAdmin && !isLiveOpsTicket && (
                  <>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Priority Score</span>
                      <span className="font-semibold text-foreground">{effectivePriority}</span>
                    </div>
                    <div className="rounded-2xl border border-border/70 bg-muted/25 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                            Priorita manuale
                          </p>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            Forza un punteggio per casi limite. Lascia vuoto per usare la regola standard.
                          </p>
                        </div>
                        {ticket?.priority_override !== null && ticket?.priority_override !== undefined && (
                          <Badge variant="secondary" className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold">
                            Override attivo
                          </Badge>
                        )}
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          value={manualPriorityInput}
                          onChange={(e) => setManualPriorityInput(e.target.value)}
                          placeholder={`${effectivePriority}`}
                          className="h-9"
                        />
                        <Button
                          size="sm"
                          className="h-9 shrink-0"
                          onClick={handleManualPrioritySave}
                        >
                          Set
                        </Button>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                        <span>
                          {ticket?.priority_override !== null && ticket?.priority_override !== undefined
                            ? `Attuale override: ${ticket.priority_override}`
                            : "Nessun override manuale attivo"}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-[11px]"
                          onClick={handleManualPriorityReset}
                          disabled={ticket?.priority_override === null || ticket?.priority_override === undefined}
                        >
                          Reset
                        </Button>
                      </div>
                    </div>
                  </>
                )}
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Created</span>
                  <span className="text-foreground">{moment(ticket.created_date).format("MMM D, YYYY")}</span>
                </div>
                {ticket.deadline && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Deadline</span>
                    <span className={moment(ticket.deadline).isBefore(moment()) ? "text-red-600 font-semibold" : ""}>
                      {moment(ticket.deadline).format("MMM D, YYYY")}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Created by</span>
                  <span className="text-right text-foreground">{ticket.created_by || "—"}</span>
                </div>
              </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
