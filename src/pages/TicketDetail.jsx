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
import { ArrowLeft, Clock, ExternalLink, Plus, Send, Loader2, AlertTriangle, Trash2, Pencil, X } from "lucide-react";
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
  getTicketWorkflowStatus,
  isPriorityPaused,
  isClosedStatus,
  normalizeTicketStatus,
} from "../components/shared/priorityUtils";
import {
  buildWeeklyRebalanceUpdates,
  findOptimalSchedule,
  getDynamicRebalanceOptions,
  getDeveloperUnavailableIntervalsByDate,
} from "./DevPipeline";
import { useCurrentUser } from "../components/shared/useCurrentUser";
import TimeScheduleCard from "../components/tickets/TimeScheduleCard";
import { buildReferenceLinksPayload, getReferenceLinkLabel, normalizeReferenceLinks } from "../components/shared/ticketReferenceLinks";
import {
  notifyClientTicketUpdate,
  notifyLiveOpsCompleted,
  notifyQaReviewApproved,
  notifyQaReviewRejected,
  notifyTicketAssigned,
  notifyTicketComment,
  notifyTicketDone,
  notifyTicketMissingData,
} from "@/lib/notificationService";
import moment from "moment";
import ReactMarkdown from "react-markdown";

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

function normalizeCommentMarkdown(text = "") {
  return String(text || "")
    .split(/(\s+)/)
    .map((token) => {
      if (!/^https?:\/\/\S+$/i.test(token)) return token;

      const match = token.match(/^(https?:\/\/[^\s<]+?)([.,!?;:)]*)$/i);
      if (!match) return token;

      const [, url, trailing = ""] = match;
      return `<${url}>${trailing}`;
    })
    .join("");
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

function ceilHalf(value) {
  return Math.ceil((Number(value) || 0) * 2) / 2;
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

function getPlanningStartAfterSafeDays(baseDate = null, protectedWorkingDays = 3) {
  const cursor = baseDate
    ? moment(baseDate, "YYYY-MM-DD", true).startOf("day")
    : moment().startOf("day");
  if (!cursor.isValid()) {
    return moment().startOf("day").format("YYYY-MM-DD");
  }

  let protectedCount = 0;
  while (protectedCount < protectedWorkingDays) {
    if (cursor.isoWeekday() <= 5) {
      protectedCount += 1;
    }
    cursor.add(1, "day");
  }

  while (cursor.isoWeekday() > 5) {
    cursor.add(1, "day");
  }

  return cursor.format("YYYY-MM-DD");
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
      return kind === "qa_review" || kind === "qa_fix";
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
  const [doneConflict, setDoneConflict] = useState(null); // { status, nowDate, nowTime, plannedDate, plannedTime }
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editingDetails, setEditingDetails] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [reportedOutcomeInput, setReportedOutcomeInput] = useState("");
  const [manualPriorityInput, setManualPriorityInput] = useState("");
  const [qaRequestDialog, setQaRequestDialog] = useState(false);
  const [qaRequestForm, setQaRequestForm] = useState({
    preview_url: "",
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
  });
  const [submittingLiveOps, setSubmittingLiveOps] = useState(false);
  const [submittingQaRequest, setSubmittingQaRequest] = useState(false);
  const [qaRejectDialog, setQaRejectDialog] = useState(false);
  const [qaRejectNotes, setQaRejectNotes] = useState("");
  const [submittingQaDecision, setSubmittingQaDecision] = useState(false);
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

  const { data: ticket, isLoading } = useQuery({
    queryKey: ["ticket", ticketId],
    queryFn: () => appClient.entities.Ticket.list().then(all => all.find(t => t.id === ticketId)),
    enabled: !!ticketId,
  });

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
  const hasQaSidebarMeta = Boolean(
    (mainTicketRecord && mainTicketRecord.id !== ticket?.id) ||
    (isQaReviewTicket && qaSourceTicketRecord && qaSourceTicketRecord.id !== mainTicketRecord?.id) ||
    isQaFixTicket ||
    isQaReviewTicket
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

  const resolveQaCycle = (sourceTicket = null, parentTicket = null) => {
    return Math.max(getQaCycleValue(sourceTicket), getQaCycleValue(parentTicket), 1);
  };

  const schedulePriorityInsertionBeforeNew = async ({ developer, ticketId: targetTicketId }) => {
    if (!developer?.id || !targetTicketId) return null;

    const latestTickets = await appClient.entities.Ticket.list();
    const sourceDeveloperTickets = latestTickets.filter(
      (entry) => entry.assignee_id === developer.id && !isClosedStatus(entry.status)
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

    const freezeTicketIds = sourceDeveloperTickets
      .filter(
        (entry) =>
          entry.id !== targetTicketId &&
          (
            normalizeTicketStatus(entry.status) !== "new" ||
            entry.id === currentOccupiedTicket?.id
          )
      )
      .map((entry) => entry.id);

    const updates = buildWeeklyRebalanceUpdates(
      latestTickets,
      developer.id,
      developer,
      {
        ...getDynamicRebalanceOptions({
          preserveWorkingDaysFromToday: 0,
        }),
        planningStartDate: currentOccupiedSegment?.date || nowInfo.date,
        manualInsertionAnchor: currentOccupiedSegment
          ? {
              date: currentOccupiedSegment.date,
              start: currentOccupiedSegment.end,
            }
          : null,
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
    if (!isClosedStatus(newStatus) || isClosedStatus(ticket?.status)) return null;

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
      qa_preview_url: qaPayload.preview_url,
      qa_review_notes: qaPayload.review_notes,
      qa_test_instructions: qaPayload.test_instructions,
      qa_requested_at: new Date().toISOString(),
      qa_requested_by: user?.email || user?.full_name || "user",
      qa_requested_by_id: user?.id || null,
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
      qa_preview_url: sourceTicket.qa_preview_url || parentTicket.qa_preview_url || "",
      qa_review_notes: sourceTicket.qa_review_notes || parentTicket.qa_review_notes || "",
      qa_test_instructions: sourceTicket.qa_test_instructions || parentTicket.qa_test_instructions || "",
      qa_reject_notes: rejectNotes,
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

  const completeQaReviewTransition = async ({
    statusOptions = {},
    qaPayload,
  }) => {
    const sourceTicket = qaSourceTicketRecord || ticket;
    const parentTicket = mainTicketRecord || sourceTicket;

    await finalizeStatusChange("qa_review", {
      ...statusOptions,
      extraData: {
        qa_preview_url: qaPayload.preview_url,
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
        qa_preview_url: qaPayload.preview_url,
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
          qa_preview_url: qaPayload.preview_url,
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

    await updateTicketWithAudit(
      refreshedParent.id,
      {
        status: "qa_review",
        qa_cycle: nextQaCycle,
        qa_preview_url: refreshedFix.qa_preview_url || refreshedParent.qa_preview_url || "",
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
        preview_url: refreshedFix.qa_preview_url || refreshedParent.qa_preview_url || "",
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
  }) => {
    const supervisor = resolveTechSupervisorDeveloper(client);
    if (!supervisor) {
      throw new Error("Nessun tech supervisor configurato sul cliente.");
    }

    const existing = await getOpenLiveOpsTicketByType({
      parentTicketId: parentTicket.id,
      operationType,
    });
    if (existing) {
      throw new Error(`Esiste gia una richiesta aperta di ${getLiveOperationLabel(operationType).toLowerCase()}.`);
    }

    const latestTickets = await appClient.entities.Ticket.list();
    const schedule = findOptimalSchedule(
      latestTickets,
      supervisor.id,
      LIVE_OPS_EFFORT_HOURS,
      supervisor.daily_capacity || 8,
      supervisor
    );
    const schedulePayload = buildSchedulePayloadFromSlots(schedule);
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
      assignee_id: supervisor.id,
      assignee_name: supervisor.name,
      assignee_email: supervisor.email,
      proposed_effort: LIVE_OPS_EFFORT_HOURS,
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
      audit_log: [
        buildAuditEntry("live_ops_created", `Task ${operationLabel.toLowerCase()} creata per ${supervisor.name}`),
      ],
      ...schedulePayload,
    });

    await notifyTicketAssigned({
      ticket: liveOpsTicket,
      actor: user,
    }).catch(() => {});

    return liveOpsTicket;
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

  const handleLiveOpsRequestSubmit = async () => {
    if (ticketKind !== "main") return;

    const operationType = normalizeLiveOperationType(liveOpsForm.operation_type);
    const isStopOperation = operationType === "stop";
    const split = isStopOperation ? "" : String(liveOpsForm.split || "").trim();
    const target = isStopOperation ? "" : String(liveOpsForm.target || "").trim();
    const notes = String(liveOpsForm.notes || "").trim();
    const outcome = String(liveOpsForm.outcome || "").trim();
    const validOutcomes = new Set(REPORT_OUTCOME_OPTIONS.map((option) => option.value));

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
      await createLiveOpsChildTicket({
        parentTicket: ticket,
        operationType,
        split,
        target,
        notes,
        outcome,
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
        `${getLiveOperationLabel(operationType)} richiesta da ${user?.full_name || user?.email || "analyst"}`
      );

      await queryClient.invalidateQueries({ queryKey: ["ticket", ticketId] });
      await queryClient.invalidateQueries({ queryKey: ["tickets"] });

      setLiveOpsDialog(false);
      if (isStopOperation) {
        setReportedOutcomeInput(outcome);
      }
      toast({
        title: `${getLiveOperationLabel(operationType)} richiesta`,
        description: "Task operativa creata nella pipeline del tech supervisor.",
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
    setLiveOpsForm({
      operation_type: normalizedType,
      split:
        normalizedType === "stop" ? "" : String(ticket?.live_split || "").trim(),
      target:
        normalizedType === "stop" ? "" : String(ticket?.live_target || "").trim(),
      notes: String(ticket?.live_notes || "").trim(),
      outcome: String(ticket?.reported_outcome || "").trim(),
    });
    setLiveOpsDialog(true);
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

    const client = clients.find(c => c.id === ticket.client_id);
    const newScore = calculatePriorityScore({ ...ticket, proposed_effort: hours }, client, config);

    const updates = {
      proposed_effort: hours,
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
    } = options;

    const nowInfo = getNowInRome();
    const nowTime = nowInfo.time;
    const timeData = {};
    let resolvedCompletionDateForRebalance = null;
    let resolvedCompletionTimeForRebalance = null;

    if (newStatus === "in_progress") {
      const selectedStartTime = overrideStartTime || ticket.start_time || nowTime;
      const movingToNow = selectedStartTime === nowTime;
      const selectedStartDate = movingToNow
        ? moment().format("YYYY-MM-DD")
        : ticket.scheduled_date || moment().format("YYYY-MM-DD");
      const dev = developers.find((d) => d.id === ticket.assignee_id);
      const effortToPlan = Number(getPlannedEffortHours(ticket) || 0);
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
        return;
      }

      const splitSchedule = buildInProgressSchedule(
        selectedStartDate,
        selectedStartTime,
        effortToPlan,
        dev
      );

      if (splitSchedule) {
        Object.assign(timeData, splitSchedule);
      } else {
        timeData.scheduled_date = selectedStartDate;
        timeData.start_time = selectedStartTime;
        timeData.end_time = null;
        timeData.continuation_schedule = [];
      }
    }
    const isCompletionStatus = isClosedStatus(newStatus);
    const wasCompletionStatus = isClosedStatus(ticket.status);

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
      data: { status: newStatus, ...timeData, ...extraData },
      auditAction,
      auditDetails:
        auditDetails ||
        `Status: ${normalizeTicketStatus(ticket.status)} → ${newStatus}${auditStartTime ? ` (start: ${auditStartTime})` : ""}${auditEndTime ? ` (end: ${auditEndTime})` : ""}`,
    });

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
  };

  const finalizeStatusChange = async (newStatus, options = {}) => {
    await doStatusChange(newStatus, options);

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
  };

  const handleStatusChange = async (newStatus) => {
    if (newStatus === "qa_review" && ticketKind === "main") {
      setQaRequestForm({
        preview_url: ticket?.qa_preview_url || "",
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

    // When moving to in_progress, check if current time differs from planned start_time
    if (newStatus === "in_progress" && ticket.start_time) {
      const nowTime = getNowInRome().time;
      if (nowTime !== ticket.start_time) {
        // Show conflict dialog
        setInProgressConflict({ nowTime, plannedTime: ticket.start_time });
        return;
      }
    }

    if (isClosedStatus(newStatus) && !isClosedStatus(ticket.status)) {
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

    await finalizeStatusChange(newStatus);
  };

  const handleQaRequestSubmit = async () => {
    const normalizedPreview = String(qaRequestForm.preview_url || "").trim();
    if (!normalizedPreview) {
      toast({
        variant: "destructive",
        title: "Preview obbligatoria",
        description: "Inserisci la preview da controllare prima di inviare il ticket in QA.",
      });
      return;
    }

    const qaPayload = {
      preview_url: normalizedPreview,
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
  const priorityPaused = isPriorityPaused(ticket);
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
    isClosedStatus(ticket.status) &&
    (
      isAdmin ||
      (isLiveOpsTicket
        ? canManageLiveOps
        : (isAnalyst || canManageAsTechSupervisor || isAssignedDeveloper))
    );
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
    !isClosedStatus(ticket.status) &&
    !priorityPaused &&
    (isAssignedDeveloper || isAdmin);
  const canReactivateMissingData =
    ticketKind === "main" &&
    !isClosedStatus(ticket.status) &&
    priorityPaused &&
    (isAdmin || (isDeveloper && missingDataReporterMatchesUser));
  const canManageMissingData = canFlagMissingData || canReactivateMissingData;
  const hiddenReportedStatus = ([key]) => key !== "reported" || normalizedStatus === "reported";
  const availableStatusEntries = isQaFixTicket || isLiveOpsTicket
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
  const canRequestLiveOps = ticketKind === "main" && (isAdmin || analystBelongsToClient);
  const canRequestLaunch = canRequestLiveOps && ["done", "reported"].includes(normalizedStatus) && (currentLiveState === "not_live" || currentLiveState === "stopped");
  const canRequestChange = canRequestLiveOps && ["done", "reported"].includes(normalizedStatus) && currentLiveState === "live";
  const canRequestStop = canRequestLiveOps && ["done", "reported"].includes(normalizedStatus) && currentLiveState === "live";
  const liveOpsOperationType = normalizeLiveOperationType(liveOpsForm.operation_type);
  const isStopLiveOperation = liveOpsOperationType === "stop";
  const liveOpsSubmitDisabled =
    submittingLiveOps ||
    (isStopLiveOperation
      ? !String(liveOpsForm.outcome || "").trim()
      : !String(liveOpsForm.split || "").trim() || !String(liveOpsForm.target || "").trim());

  const handleMissingDataToggle = async () => {
    if (!ticket?.assignee_id) return;

    const nextPaused = !priorityPaused;
    const nextStatus = nextPaused ? "new" : normalizedStatus;
    const nextPriorityScore = nextPaused
      ? 0
      : calculatePriorityScore(
          { ...ticket, missing_required_data: false, priority_override: null },
          client,
          config
        );
    const currentScheduleSegments = getTicketScheduleSegments(ticket);
    const anchorSegment = currentScheduleSegments[0] || null;
    const planningAfterSafeDays = getPlanningStartAfterSafeDays(moment().format("YYYY-MM-DD"), 3);

    await updateMutation.mutateAsync({
      data: {
        missing_required_data: nextPaused,
        missing_required_data_reported_at: nextPaused ? new Date().toISOString() : null,
        missing_required_data_reported_by: nextPaused ? (user?.email || user?.full_name || "developer") : null,
        missing_required_data_reported_by_id: nextPaused ? (user?.id || null) : null,
        priority_override: nextPaused ? 0 : null,
        priority_score: nextPriorityScore,
        status: nextStatus,
        ...(nextPaused
          ? {
              scheduled_date: null,
              start_time: null,
              end_time: null,
              continuation_schedule: [],
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

    await applyRebalanceForDevelopers([ticket.assignee_id], {
      ...(nextPaused
        ? {
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
          }
        : {
            planningStartDate: planningAfterSafeDays,
            preserveWorkingDaysFromToday: 0,
            includeTodayHoles: true,
            freezeCurrentWeekSegments: false,
            preserveTodaySegments: false,
          }),
    });

    toast({
      title: nextPaused ? "Ticket sospeso per mancanza dati" : "Ticket riattivato",
      description: nextPaused
        ? "Priorita portata a 0 e team cliente notificato."
        : "La priorita del ticket e stata ricalcolata dopo i giorni protetti.",
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
      qa_preview_url: ticket.qa_preview_url || "",
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
    const payload = {
      ...editForm,
      description: normalizedDescription,
      required_tracking: String(editForm.required_tracking || "").trim(),
      qa_preview_url: String(editForm.qa_preview_url || "").trim(),
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
              Vuoi spostare l'orario di inizio a <strong>{inProgressConflict.nowTime}</strong>? Questo causerà l'adattamento della pipeline.
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
                {priorityPaused && (
                  <Badge variant="outline" className="border-0 bg-amber-100 text-amber-700 text-xs dark:bg-amber-500/15 dark:text-amber-300">
                    Mancano dati
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
                  <Textarea
                    value={editForm.description || ""}
                    onChange={e => setEditForm({ ...editForm, description: e.target.value })}
                    className="min-h-[144px] resize-y text-sm leading-6"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className={sidebarLabelClass}>Tracciamenti richiesti</label>
                  <Textarea
                    value={editForm.required_tracking || ""}
                    onChange={e => setEditForm({ ...editForm, required_tracking: e.target.value })}
                    className="min-h-[120px] resize-y text-sm leading-6"
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

              {(ticketKind === "main" || ticketKind === "qa_fix" || editForm.qa_preview_url || editForm.qa_review_notes || editForm.qa_test_instructions) && (
                <section className="space-y-4 rounded-[24px] bg-muted/20 p-4 sm:p-5">
                  <div className="space-y-1">
                    <p className={sectionEyebrowClass}>QA / Review</p>
                    <h4 className="text-base font-semibold text-foreground">Contesto preview</h4>
                  </div>

                  <div className="space-y-1.5">
                    <label className={sidebarLabelClass}>Preview URL</label>
                    <Input
                      value={editForm.qa_preview_url || ""}
                      onChange={e => setEditForm({ ...editForm, qa_preview_url: e.target.value })}
                      placeholder="https://..."
                      className="h-11 text-sm"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className={sidebarLabelClass}>Note per il review</label>
                    <Textarea
                      value={editForm.qa_review_notes || ""}
                      onChange={e => setEditForm({ ...editForm, qa_review_notes: e.target.value })}
                      className="min-h-[120px] resize-y text-sm leading-6"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className={sidebarLabelClass}>Come testarlo</label>
                    <Textarea
                      value={editForm.qa_test_instructions || ""}
                      onChange={e => setEditForm({ ...editForm, qa_test_instructions: e.target.value })}
                      className="min-h-[120px] resize-y text-sm leading-6"
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
                <label className={sidebarLabelClass}>Preview URL *</label>
                <Input
                  value={qaRequestForm.preview_url}
                  onChange={(event) =>
                    setQaRequestForm((prev) => ({ ...prev, preview_url: event.target.value }))
                  }
                  placeholder="https://..."
                  className="h-11 text-sm"
                />
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
                disabled={submittingQaRequest || !String(qaRequestForm.preview_url || "").trim()}
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

      <Dialog open={liveOpsDialog} onOpenChange={setLiveOpsDialog}>
        <DialogContent className="flex w-[calc(100vw-32px)] max-h-[calc(100vh-112px)] max-w-2xl flex-col gap-0 overflow-hidden rounded-[30px] border border-border/70 bg-card p-0 shadow-[var(--shadow-hover)] sm:w-[calc(100vw-64px)] sm:max-h-[calc(100vh-128px)]">
          <DialogHeader className="shrink-0 border-b border-border/70 px-6 py-5 text-left sm:px-7 sm:py-6">
            <p className={sectionEyebrowClass}>Live operations</p>
            <DialogTitle className="text-2xl font-semibold tracking-tight text-foreground">
              Richiedi {getLiveOperationLabel(liveOpsForm.operation_type).toLowerCase()}
            </DialogTitle>
            <DialogDescription className="text-sm">
              Viene creata una task operativa nella pipeline del tech supervisor del cliente.
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
                        <div className="whitespace-pre-wrap text-[15px] leading-7 text-foreground/90">
                          {ticket.description}
                        </div>
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
                        <div className="whitespace-pre-wrap text-sm leading-6 text-foreground/85">
                          {ticket.required_tracking || "Nessun tracking specificato."}
                        </div>
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
                  {(reviewPreviewSource?.qa_preview_url || reviewPreviewSource?.qa_review_notes || reviewPreviewSource?.qa_test_instructions || isQaReviewTicket) && (
                    <div className="space-y-2">
                      <p className={sectionEyebrowClass}>QA / Review</p>
                      <div className="overflow-hidden rounded-2xl border border-cyan-200/70 bg-cyan-50/70 p-5 dark:border-cyan-500/25 dark:bg-cyan-500/10">
                        <div className={`grid gap-4 ${hasQaSidebarMeta ? "2xl:grid-cols-[minmax(0,1fr)_220px]" : ""}`}>
                          <div className="min-w-0 space-y-4">
                            {reviewPreviewSource?.qa_preview_url && (
                              <div className="min-w-0 space-y-1.5">
                                <p className={sidebarLabelClass}>Preview</p>
                                <a
                                  href={reviewPreviewSource.qa_preview_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  title={reviewPreviewSource.qa_preview_url}
                                  className="flex w-full max-w-full min-w-0 overflow-hidden items-center gap-2 rounded-2xl border border-cyan-200/70 bg-background/90 px-3.5 py-3 text-sm transition-colors hover:border-primary/25 hover:bg-primary/5 dark:border-cyan-500/25"
                                >
                                  <ExternalLink className="h-3.5 w-3.5 shrink-0 text-primary" />
                                  <span className="block min-w-0 flex-1 truncate font-medium text-foreground">
                                    {reviewPreviewSource.qa_preview_url}
                                  </span>
                                </a>
                              </div>
                            )}

                            {reviewPreviewSource?.qa_review_notes && (
                              <div className="min-w-0 space-y-1.5">
                                <p className={sidebarLabelClass}>Note per il review</p>
                                <div className="whitespace-pre-wrap rounded-2xl bg-background/80 px-4 py-3 text-sm leading-6 text-foreground/85">
                                  {reviewPreviewSource.qa_review_notes}
                                </div>
                              </div>
                            )}

                            {reviewPreviewSource?.qa_test_instructions && (
                              <div className="min-w-0 space-y-1.5">
                                <p className={sidebarLabelClass}>Come testarlo</p>
                                <div className="whitespace-pre-wrap rounded-2xl bg-background/80 px-4 py-3 text-sm leading-6 text-foreground/85">
                                  {reviewPreviewSource.qa_test_instructions}
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
                              {(isQaFixTicket || isQaReviewTicket) && (
                                <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
                                  <p className={sidebarLabelClass}>Tipo task</p>
                                  <p className="mt-2 text-sm font-medium text-foreground">
                                    {isQaReviewTicket ? "Review preview" : "QA fix"}
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
                        <ReactMarkdown
                          components={{
                            p: ({ children }) => (
                              <p className="text-sm leading-6 text-foreground/85 [&:not(:first-child)]:mt-3">{children}</p>
                            ),
                            strong: ({ children }) => (
                              <strong className="font-semibold text-foreground">{children}</strong>
                            ),
                            em: ({ children }) => (
                              <em className="italic text-foreground/90">{children}</em>
                            ),
                            a: ({ href, children }) =>
                              String(href || "").startsWith("mention:")
                                ? (
                                  <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                                    {children}
                                  </span>
                                )
                                : (
                                  <a
                                    href={href}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="break-all font-medium text-primary underline decoration-primary/35 underline-offset-4"
                                  >
                                    {children}
                                  </a>
                                ),
                            ul: ({ children }) => (
                              <ul className="ml-5 list-disc space-y-1 text-sm leading-6 text-foreground/85">{children}</ul>
                            ),
                            ol: ({ children }) => (
                              <ol className="ml-5 list-decimal space-y-1 text-sm leading-6 text-foreground/85">{children}</ol>
                            ),
                            li: ({ children }) => <li>{children}</li>,
                          }}
                        >
                          {normalizeCommentMarkdown(c.text)}
                        </ReactMarkdown>
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
              await notifyClientSupervisor({
                title: "Pianificazione ticket aggiornata",
                body: ticket.title,
                metadata: {
                  reason: "ticket_schedule_updated",
                },
              });
            }}
          />
          
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
            <CardContent className="p-5 space-y-4">
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

              {isLiveOpsTicket && canManageLiveOps && !isClosedStatus(ticket.status) && (
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

              {/* Status - analysts & admins can change freely; devs can change their assigned tickets */}
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
                    {isClosedStatus(ticket.status) ? "Non ancora valorizzato" : "Disponibile a consuntivo"}
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
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
