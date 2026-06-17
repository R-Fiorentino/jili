import moment from "moment";

const WEEKDAY_SHORT_IT = {
  1: "Lun",
  2: "Mar",
  3: "Mer",
  4: "Gio",
  5: "Ven",
  6: "Sab",
  7: "Dom",
};

function normalizeDateStr(value) {
  const parsed = moment(value, "YYYY-MM-DD", true);
  return parsed.isValid() ? parsed.format("YYYY-MM-DD") : null;
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

function roundHalf(value) {
  return Math.round((Number(value) || 0) * 2) / 2;
}

export function normalizeWeekdays(value) {
  const input = Array.isArray(value) ? value : [];
  const normalized = input
    .map((item) => Number(item))
    .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7);
  return [...new Set(normalized)].sort((a, b) => a - b);
}

export function normalizeRecurringInterval(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(12, Math.round(parsed)));
}

export function normalizeRecurringUnit(value) {
  return String(value || "").trim().toLowerCase() === "month" ? "month" : "week";
}

export function normalizeRecurringAvailabilityRule(
  rule,
  index = 0,
  { dayStart = 9, dayEnd = 18, defaultStartDate = null } = {}
) {
  const startRaw = timeToDecimal(rule?.start_time);
  const endRaw = timeToDecimal(rule?.end_time);
  if (!Number.isFinite(startRaw) || !Number.isFinite(endRaw) || endRaw <= startRaw) return null;

  const start = roundHalf(Math.max(dayStart, Math.min(dayEnd, startRaw)));
  const end = roundHalf(Math.max(dayStart, Math.min(dayEnd, endRaw)));
  if (end <= start) return null;

  const startDate = normalizeDateStr(rule?.start_date) || normalizeDateStr(defaultStartDate);
  const endDate = normalizeDateStr(rule?.end_date);
  if (startDate && endDate && endDate < startDate) return null;

  const recurrenceUnit = normalizeRecurringUnit(rule?.recurrence_unit);
  const interval = normalizeRecurringInterval(rule?.interval);
  const weekdays =
    recurrenceUnit === "week"
      ? (() => {
          const normalizedWeekdays = normalizeWeekdays(rule?.weekdays);
          if (normalizedWeekdays.length > 0) return normalizedWeekdays;
          if (startDate) return [moment(startDate, "YYYY-MM-DD", true).isoWeekday()];
          return [];
        })()
      : [];
  const monthDay =
    recurrenceUnit === "month"
      ? (() => {
          const candidate = Number(rule?.month_day);
          if (Number.isInteger(candidate) && candidate >= 1 && candidate <= 31) return candidate;
          if (startDate) return moment(startDate, "YYYY-MM-DD", true).date();
          return null;
        })()
      : null;

  if (recurrenceUnit === "week" && weekdays.length === 0) return null;
  if (recurrenceUnit === "month" && !monthDay) return null;

  return {
    id: String(rule?.id || `rec-${index}`),
    type: String(rule?.type || "activity"),
    label: String(rule?.label || "").trim(),
    recurrence_unit: recurrenceUnit,
    interval,
    weekdays,
    month_day: monthDay,
    start,
    end,
    start_time: decimalToTime(start),
    end_time: decimalToTime(end),
    start_date: startDate,
    end_date: endDate,
    active: rule?.active !== false,
  };
}

export function recurringRuleMatchesDate(rule, dateStr) {
  const normalizedRule = rule?.start != null
    ? rule
    : normalizeRecurringAvailabilityRule(rule, 0, { defaultStartDate: dateStr });
  if (!normalizedRule) return false;

  const date = moment(dateStr, "YYYY-MM-DD", true);
  if (!date.isValid()) return false;
  if (normalizedRule.start_date && dateStr < normalizedRule.start_date) return false;
  if (normalizedRule.end_date && dateStr > normalizedRule.end_date) return false;

  const anchor = normalizedRule.start_date
    ? moment(normalizedRule.start_date, "YYYY-MM-DD", true)
    : date.clone();

  if (normalizedRule.recurrence_unit === "month") {
    const monthDiff =
      date.year() * 12 + date.month() - (anchor.year() * 12 + anchor.month());
    if (monthDiff < 0 || monthDiff % normalizedRule.interval !== 0) return false;
    return date.date() === Math.min(normalizedRule.month_day || anchor.date(), date.daysInMonth());
  }

  if (!normalizedRule.weekdays.includes(date.isoWeekday())) return false;
  const weekDiff = date.clone().startOf("isoWeek").diff(anchor.clone().startOf("isoWeek"), "weeks");
  return weekDiff >= 0 && weekDiff % normalizedRule.interval === 0;
}

export function getNextRecurringDate(rule, fromDate = moment().format("YYYY-MM-DD")) {
  const normalizedRule =
    rule?.start != null
      ? rule
      : normalizeRecurringAvailabilityRule(rule, 0, { defaultStartDate: fromDate });
  if (!normalizedRule) return null;

  const cursorStart = normalizedRule.start_date && normalizedRule.start_date > fromDate
    ? normalizedRule.start_date
    : fromDate;
  let cursor = moment(cursorStart, "YYYY-MM-DD", true);
  if (!cursor.isValid()) cursor = moment(fromDate, "YYYY-MM-DD", true);

  for (let i = 0; i < 740; i++) {
    const dateStr = cursor.format("YYYY-MM-DD");
    if (recurringRuleMatchesDate(normalizedRule, dateStr)) return dateStr;
    cursor = cursor.add(1, "day");
  }

  return null;
}

export function weekdayLabel(weekdays = []) {
  const values = normalizeWeekdays(weekdays);
  if (values.length === 0) return "Nessun giorno";
  if (values.length === 7) return "Ogni giorno";
  return values
    .map((day) => WEEKDAY_SHORT_IT[day] || String(day))
    .join(", ");
}

export function formatRecurringRuleLabel(rule) {
  const normalizedRule =
    rule?.start != null ? rule : normalizeRecurringAvailabilityRule(rule, 0);
  if (!normalizedRule) return "Ricorrenza";

  if (normalizedRule.recurrence_unit === "month") {
    const cadence = normalizedRule.interval === 1 ? "Ogni mese" : `Ogni ${normalizedRule.interval} mesi`;
    return `${cadence} • giorno ${normalizedRule.month_day}`;
  }

  const cadence = normalizedRule.interval === 1 ? "Ogni settimana" : `Ogni ${normalizedRule.interval} settimane`;
  return `${cadence} • ${weekdayLabel(normalizedRule.weekdays)}`;
}
