// Priority calculation utilities

export const DEFAULT_CONFIG = {
  age_coefficient: 2,
  tier_scores: { P1: 50, P2: 35, P3: 20 },
  deadline_bonus: { overdue: 35, today: 20, next_3_days: 10, next_7_days: 4 },
  effort_penalty_per_hour: 0.5,
  industry_options: [
    "Telco",
    "Fashion e-commerce",
    "Energy",
    "Travel & Hospitality",
    "Editorial",
    "Banking",
  ],
  report_permissions: {
    edit_roles: ["admin", "analyst"],
  },
};

export const DEFAULT_INDUSTRY_OPTIONS = [...DEFAULT_CONFIG.industry_options];
export const REPORT_OUTCOME_VALUES = ["winner", "loser", "not_significant"];

const REPORT_OUTCOME_ALIASES = {
  win: "winner",
  winner: "winner",
  lose: "loser",
  loser: "loser",
  lost: "loser",
  not_significant: "not_significant",
  notsignificant: "not_significant",
  "not significant": "not_significant",
};

export function normalizeReportOutcome(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[-\s]+/g, "_");
  if (!normalized) return "";
  return REPORT_OUTCOME_ALIASES[normalized] || "";
}

export function getTicketReportedOutcome(ticket) {
  return (
    normalizeReportOutcome(ticket?.reported_outcome) ||
    normalizeReportOutcome(ticket?.test_report?.outcome)
  );
}

export function hasTicketReportedOutcome(ticket) {
  return Boolean(getTicketReportedOutcome(ticket));
}

export function getIndustryOptions(config) {
  const options = Array.isArray(config?.industry_options)
    ? config.industry_options
        .map((entry) => String(entry || "").trim())
        .filter(Boolean)
    : [];

  return options.length > 0 ? Array.from(new Set(options)) : [...DEFAULT_INDUSTRY_OPTIONS];
}

export function normalizeClientTier(tier) {
  const safeTier = String(tier || "").trim().toUpperCase();
  return ["P1", "P2", "P3"].includes(safeTier) ? safeTier : "P3";
}

export function getPlannedEffortHours(ticket) {
  const planned = Number(ticket?.proposed_effort);
  if (Number.isFinite(planned) && planned > 0) return planned;

  // Legacy fallback: old records used effort_hours as estimate.
  const legacy = Number(ticket?.effort_hours);
  if (Number.isFinite(legacy) && legacy > 0) return legacy;

  return 0;
}

export function getActualEffortHours(ticket) {
  const actual = Number(ticket?.effort_hours);
  return Number.isFinite(actual) && actual > 0 ? actual : 0;
}

export function getWorkedEffortHours(ticket) {
  const worked = Number(ticket?.worked_effort_hours);
  return Number.isFinite(worked) && worked > 0 ? worked : 0;
}

export function getRemainingEffortHours(ticket) {
  const explicitRemaining = Number(ticket?.remaining_effort_hours);
  if (Number.isFinite(explicitRemaining) && explicitRemaining >= 0) {
    return explicitRemaining;
  }

  const planned = getPlannedEffortHours(ticket);
  const worked = getWorkedEffortHours(ticket);
  return Math.max(0, planned - worked);
}

function toReportNumber(value) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function reportMatrixHasValues(matrix) {
  return Object.values(matrix || {}).some((segmentRow) =>
    Object.values(segmentRow || {}).some((value) => toReportNumber(value) !== 0)
  );
}

export function hasTicketReportContent(ticket) {
  const report = ticket?.test_report;
  if (!report || typeof report !== "object") return false;

  if (report.version === 2) {
    const hasDirectText = [
      report.industry,
      report.outcome,
      report.go_live_date,
      report.end_date,
      report.primary_metric_name,
      report.results_commentary,
      report.generated_report,
      report.generated_by,
      report.generated_at,
      report.updated_at,
    ].some((value) => String(value || "").trim().length > 0);

    if (hasDirectText) return true;
    if (reportMatrixHasValues(report.sessions) || reportMatrixHasValues(report.primary_metric_conversions)) {
      return true;
    }

    return Array.isArray(report.secondary_metrics) && report.secondary_metrics.some((metric) => {
      if (!metric || typeof metric !== "object") return false;
      if (String(metric.name || "").trim().length > 0) return true;
      return reportMatrixHasValues(metric.conversions);
    });
  }

  const hasDirectText = [
    report.objective,
    report.tested_variants,
    report.monitored_metrics,
    report.personalization_scope,
    report.personalization_rules,
    report.insights,
    report.recommendations,
    report.generated_report,
    report.generated_by,
    report.generated_at,
    report.updated_at,
  ].some((value) => String(value || "").trim().length > 0);

  if (hasDirectText) return true;
  if (!Array.isArray(report.analysis_blocks)) return false;

  return report.analysis_blocks.some((row) => {
    if (!row || typeof row !== "object") return false;
    return Object.values(row).some((value) => {
      if (value === null || value === undefined) return false;
      if (typeof value === "number") return value !== 0;
      return String(value).trim().length > 0;
    });
  });
}

export function isPriorityPaused(ticket) {
  return ticket?.missing_required_data === true;
}

export function isBlockedStatus(status) {
  return normalizeTicketStatus(status) === "blocked";
}

export function isTicketBlocked(ticket) {
  return isBlockedStatus(ticket?.status) || isPriorityPaused(ticket);
}

export function calculatePriorityScore(ticket, client, config = DEFAULT_CONFIG) {
  if (isTicketBlocked(ticket)) return 0;
  if (!client) return 0;

  const safeConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    tier_scores: { ...DEFAULT_CONFIG.tier_scores, ...(config?.tier_scores || {}) },
    deadline_bonus: { ...DEFAULT_CONFIG.deadline_bonus, ...(config?.deadline_bonus || {}) },
  };

  const mediumTierFallback = safeConfig.tier_scores.P3 ?? DEFAULT_CONFIG.tier_scores.P3;
  const tierScore = safeConfig.tier_scores[normalizeClientTier(client.priority_tier)] ?? mediumTierFallback;

  const createdTs = Date.parse(ticket?.created_date || "");
  const daysSinceCreation = Number.isFinite(createdTs)
    ? Math.max(0, Math.floor((Date.now() - createdTs) / (1000 * 60 * 60 * 24)))
    : 0;
  const ageScore = daysSinceCreation * (safeConfig.age_coefficient || 0);

  let deadlineBonus = 0;
  const deadlineTs = Date.parse(ticket?.deadline || "");
  if (Number.isFinite(deadlineTs)) {
    const daysToDeadline = Math.ceil((deadlineTs - Date.now()) / (1000 * 60 * 60 * 24));
    if (daysToDeadline < 0) {
      deadlineBonus = safeConfig.deadline_bonus.overdue || 0;
    } else if (daysToDeadline <= 0) {
      deadlineBonus = safeConfig.deadline_bonus.today || 0;
    } else if (daysToDeadline <= 3) {
      deadlineBonus = safeConfig.deadline_bonus.next_3_days || 0;
    } else if (daysToDeadline <= 7) {
      deadlineBonus = safeConfig.deadline_bonus.next_7_days || 0;
    }
  }

  const effortHours = Math.max(0, Number(getPlannedEffortHours(ticket)) || 0);
  const effortPenalty = effortHours * (Number(safeConfig.effort_penalty_per_hour) || 0);

  const score = tierScore + ageScore + deadlineBonus - effortPenalty;
  return Math.max(0, Math.round(score));
}

export function getEffectivePriorityScore(ticket) {
  if (!ticket) return 0;
  if (isTicketBlocked(ticket)) return 0;
  const rawOverride = ticket.priority_override;
  const hasOverride =
    rawOverride !== null &&
    rawOverride !== undefined &&
    String(rawOverride).trim() !== "";
  if (hasOverride) {
    const override = Number(rawOverride);
    if (Number.isFinite(override)) return override;
  }

  const score = Number(ticket.priority_score);
  return Number.isFinite(score) ? score : 0;
}

export function compareTicketsByPriority(a, b) {
  const scoreA = getEffectivePriorityScore(a);
  const scoreB = getEffectivePriorityScore(b);
  if (scoreB !== scoreA) return scoreB - scoreA;

  const createdA = Date.parse(a?.created_date || "") || 0;
  const createdB = Date.parse(b?.created_date || "") || 0;
  return createdA - createdB;
}

export function getPriorityLevel(score) {
  // These thresholds are calibrated against the current formula:
  // tier + ticket age + deadline urgency - effort penalty.
  // The previous cutoffs were inherited from an older, higher scoring model,
  // which caused most tickets to collapse into "Low" despite valid scores.
  if (score >= 80) {
    return {
      label: "Critical",
      color: "bg-red-500",
      textColor: "text-red-700 dark:text-red-300",
      bgLight: "bg-red-50 dark:bg-red-500/15",
    };
  }
  if (score >= 60) {
    return {
      label: "High",
      color: "bg-orange-500",
      textColor: "text-orange-700 dark:text-orange-300",
      bgLight: "bg-orange-50 dark:bg-orange-500/15",
    };
  }
  if (score >= 35) {
    return {
      label: "Medium",
      color: "bg-yellow-500",
      textColor: "text-yellow-700 dark:text-yellow-300",
      bgLight: "bg-yellow-50 dark:bg-yellow-500/15",
    };
  }
  return {
    label: "Low",
    color: "bg-green-500",
    textColor: "text-green-700 dark:text-green-300",
    bgLight: "bg-green-50 dark:bg-green-500/15",
  };
}

export const STATUS_CONFIG = {
  new: {
    label: "New",
    color: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-500/15 dark:text-slate-200 dark:border-slate-500/35",
    icon: "circle",
  },
  in_progress: {
    label: "In Progress",
    color: "bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-500/35",
    icon: "play",
  },
  qa_review: {
    label: "QA / Review",
    color: "bg-cyan-100 text-cyan-700 border-cyan-200 dark:bg-cyan-500/15 dark:text-cyan-300 dark:border-cyan-500/35",
    icon: "search",
  },
  done: {
    label: "Done",
    color: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/35",
    icon: "check",
  },
  reported: {
    label: "Reported",
    color: "bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/35",
    icon: "file",
  },
  blocked: {
    label: "In pausa",
    color: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/35",
    icon: "pause",
  },
};

export const PIPELINE_ORDER = ["new", "in_progress", "qa_review", "done", "blocked"];
export const NEW_TICKET_ALLOWED_NEXT_STATUSES = ["in_progress", "blocked"];
export const NEW_TICKET_STATUS_TRANSITION_MESSAGE =
  "Un ticket New puo passare solo a In Progress o In pausa.";

const LEGACY_STATUS_MAP = {
  needs_effort: "new",
  ready: "new",
};

export function normalizeTicketStatus(status) {
  const raw = String(status || "").trim();
  if (!raw) return "new";
  const normalized = LEGACY_STATUS_MAP[raw] || raw;
  return STATUS_CONFIG[normalized] ? normalized : "new";
}

export function getTicketWorkflowStatus(ticket) {
  const normalized = normalizeTicketStatus(ticket?.status);
  if (normalized === "reported") return "reported";
  return hasTicketReportedOutcome(ticket) || hasTicketReportContent(ticket) ? "reported" : normalized;
}

export function canTransitionTicketStatus(currentStatus, nextStatus) {
  const normalizedCurrent = normalizeTicketStatus(currentStatus);
  const normalizedNext = normalizeTicketStatus(nextStatus);

  if (normalizedCurrent === normalizedNext) return true;
  if (normalizedCurrent === "new") {
    return NEW_TICKET_ALLOWED_NEXT_STATUSES.includes(normalizedNext);
  }

  return true;
}

export function isClosedStatus(status) {
  const normalized = normalizeTicketStatus(status);
  return normalized === "done" || normalized === "qa_review" || normalized === "reported";
}

export function isTicketClosed(ticket) {
  return isClosedStatus(getTicketWorkflowStatus(ticket));
}

export function isOpenStatus(status) {
  return !isClosedStatus(status);
}

export function isSchedulableTicket(ticket) {
  return Boolean(ticket?.assignee_id) && !isTicketClosed(ticket) && !isTicketBlocked(ticket);
}

export const DIFFICULTY_CONFIG = {
  easy: { label: "Easy", color: "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300" },
  medium: { label: "Medium", color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-300" },
  hard: { label: "Hard", color: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300" },
};

export const TYPE_CONFIG = {
  ab_test: { label: "A/B Test", color: "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300" },
  cro: { label: "CRO", color: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300" },
  tracking: { label: "Tracking", color: "bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300" },
  ui_change: { label: "UI Change", color: "bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300" },
  bug_fix: { label: "Bug Fix", color: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300" },
  other: { label: "Other", color: "bg-gray-100 text-gray-700 dark:bg-slate-500/15 dark:text-slate-200" },
};

export function suggestAssignment(developers, tickets) {
  // Calculate allocated hours per dev
  const devLoad = {};
  developers.forEach(d => { devLoad[d.id] = 0; });
  
  tickets
    .filter((t) => isSchedulableTicket(t))
    .forEach(t => {
      if (devLoad[t.assignee_id] !== undefined) {
        devLoad[t.assignee_id] += getPlannedEffortHours(t);
      }
    });

  // Find dev with most available capacity
  let bestDev = null;
  let maxAvailable = -1;
  
  developers
    .filter(d => d.active !== false)
    .forEach(d => {
      const available = (d.daily_capacity || 8) * 5 - (devLoad[d.id] || 0); // weekly
      if (available > maxAvailable) {
        maxAvailable = available;
        bestDev = d;
      }
    });

  return bestDev;
}
