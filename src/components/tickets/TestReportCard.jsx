import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import {
  BarChart3,
  CalendarDays,
  FileDown,
  Loader2,
  Plus,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { DEFAULT_INDUSTRY_OPTIONS } from "../shared/priorityUtils";

const PRIMARY_METRIC_ID = "primary-metric";

const SEGMENTS = [
  { key: "overall", label: "Overall" },
  { key: "mobile", label: "Mobile" },
  { key: "desktop", label: "Desktop" },
];

const MODEL_OPTIONS = [
  { value: "ab", label: "A/B" },
  { value: "abc", label: "A/B/C" },
  { value: "personalization", label: "Personalization" },
];

const OUTCOME_OPTIONS = [
  { value: "winner", label: "Winner" },
  { value: "loser", label: "Loser" },
  { value: "not_significant", label: "Not Significant" },
];

function uid(prefix = "metric") {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function toInputString(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return String(value);
}

function toNumber(value) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  const fixed = Number(value).toFixed(digits);
  if (digits <= 0) return fixed;
  return fixed.replace(/\.?0+$/, "");
}

function formatRate(rate) {
  if (rate === null || rate === undefined) return "—";
  return `${formatNumber(rate * 100, 2)}%`;
}

function formatUplift(uplift) {
  if (uplift === null || uplift === undefined) return "—";
  const prefix = uplift > 0 ? "+" : "";
  return `${prefix}${formatNumber(uplift * 100, 2)}%`;
}

function formatSignificance(significance) {
  if (significance === null || significance === undefined) return "—";
  return `${Math.round(significance)}%`;
}

function createEmptySegmentValues(seed = {}) {
  return {
    control: toInputString(seed.control),
    variant: toInputString(seed.variant),
    variant_c: toInputString(seed.variant_c),
  };
}

function normalizeSegmentMatrix(matrix = {}) {
  return SEGMENTS.reduce((acc, segment) => {
    acc[segment.key] = createEmptySegmentValues(matrix?.[segment.key]);
    return acc;
  }, {});
}

function createSecondaryMetric(seed = {}) {
  return {
    id: seed.id || uid("secondary-metric"),
    name: seed.name || "",
    conversions: normalizeSegmentMatrix(seed.conversions),
  };
}

function fallbackCommentary(report) {
  return [report?.insights, report?.recommendations]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join("\n\n");
}

function normalizeReport(report) {
  const safe = report || {};

  if (safe.version === 2) {
    return {
      version: 2,
      test_model: safe.test_model === "abc" || safe.test_model === "personalization" ? safe.test_model : "ab",
      industry: safe.industry || "",
      outcome: safe.outcome || "",
      go_live_date: safe.go_live_date || "",
      end_date: safe.end_date || "",
      primary_metric_name: safe.primary_metric_name || "",
      sessions: normalizeSegmentMatrix(safe.sessions),
      primary_metric_conversions: normalizeSegmentMatrix(safe.primary_metric_conversions),
      secondary_metrics: Array.isArray(safe.secondary_metrics)
        ? safe.secondary_metrics.map((metric) => createSecondaryMetric(metric))
        : [],
      results_commentary: safe.results_commentary || "",
      generated_report: safe.generated_report || "",
      generated_at: safe.generated_at || null,
      generated_by: safe.generated_by || "",
      updated_at: safe.updated_at || null,
      updated_by: safe.updated_by || "",
    };
  }

  return {
    version: 2,
    test_model: safe.test_model === "abc" || safe.test_model === "personalization" ? safe.test_model : "ab",
    industry: "",
    outcome: "",
    go_live_date: "",
    end_date: "",
    primary_metric_name: "",
    sessions: normalizeSegmentMatrix(),
    primary_metric_conversions: normalizeSegmentMatrix(),
    secondary_metrics: [],
    results_commentary: fallbackCommentary(safe),
    generated_report: safe.generated_report || "",
    generated_at: safe.generated_at || null,
    generated_by: safe.generated_by || "",
    updated_at: safe.updated_at || null,
    updated_by: safe.updated_by || "",
  };
}

function serializeSegmentMatrix(matrix = {}) {
  return SEGMENTS.reduce((acc, segment) => {
    const row = matrix?.[segment.key] || {};
    acc[segment.key] = {
      control: round(toNumber(row.control)),
      variant: round(toNumber(row.variant)),
      variant_c: round(toNumber(row.variant_c)),
    };
    return acc;
  }, {});
}

function serializeReport(form, actorName) {
  return {
    version: 2,
    test_model: form.test_model === "abc" || form.test_model === "personalization" ? form.test_model : "ab",
    industry: String(form.industry || "").trim(),
    outcome: String(form.outcome || "").trim(),
    go_live_date: String(form.go_live_date || "").trim(),
    end_date: String(form.end_date || "").trim(),
    primary_metric_name: String(form.primary_metric_name || "").trim(),
    sessions: serializeSegmentMatrix(form.sessions),
    primary_metric_conversions: serializeSegmentMatrix(form.primary_metric_conversions),
    secondary_metrics: (form.secondary_metrics || [])
      .map((metric) => ({
        id: metric.id || uid("secondary-metric"),
        name: String(metric.name || "").trim(),
        conversions: serializeSegmentMatrix(metric.conversions),
      }))
      .filter((metric) => {
        if (metric.name) return true;
        return SEGMENTS.some((segment) => {
          const row = metric.conversions?.[segment.key];
          return row && (row.control > 0 || row.variant > 0 || row.variant_c > 0);
        });
      }),
    results_commentary: String(form.results_commentary || "").trim(),
    generated_report: String(form.generated_report || "").trim(),
    generated_at: form.generated_at || null,
    generated_by: form.generated_by || "",
    updated_at: new Date().toISOString(),
    updated_by: actorName || "",
  };
}

function buildComparableReportDraft(form) {
  return {
    version: 2,
    test_model: form.test_model === "abc" || form.test_model === "personalization" ? form.test_model : "ab",
    industry: String(form.industry || "").trim(),
    outcome: String(form.outcome || "").trim(),
    go_live_date: String(form.go_live_date || "").trim(),
    end_date: String(form.end_date || "").trim(),
    primary_metric_name: String(form.primary_metric_name || "").trim(),
    sessions: serializeSegmentMatrix(form.sessions),
    primary_metric_conversions: serializeSegmentMatrix(form.primary_metric_conversions),
    secondary_metrics: (form.secondary_metrics || [])
      .map((metric) => ({
        id: metric.id || "",
        name: String(metric.name || "").trim(),
        conversions: serializeSegmentMatrix(metric.conversions),
      }))
      .filter((metric) => {
        if (metric.name) return true;
        return SEGMENTS.some((segment) => {
          const row = metric.conversions?.[segment.key];
          return row && (row.control > 0 || row.variant > 0 || row.variant_c > 0);
        });
      }),
    results_commentary: String(form.results_commentary || "").trim(),
    generated_report: String(form.generated_report || "").trim(),
    generated_at: form.generated_at || null,
    generated_by: form.generated_by || "",
  };
}

function parseDate(value) {
  if (!value) return null;
  const [year, month, day] = String(value).split("-").map((part) => Number(part));
  if (!year || !month || !day) return null;
  const parsed = new Date(year, month - 1, day);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function calculateDurationDays(startValue, endValue) {
  const start = parseDate(startValue);
  const end = parseDate(endValue);
  if (!start || !end) return null;
  const diff = Math.round((end.getTime() - start.getTime()) / 86400000);
  return diff >= 0 ? diff : null;
}

function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * absX);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return sign * y;
}

function normalCdf(x) {
  return 0.5 * (1 + erf(x / Math.sqrt(2)));
}

function getVariantKeys(model) {
  return model === "abc" ? ["control", "variant", "variant_c"] : ["control", "variant"];
}

function getVariantLabel(model, key) {
  if (key === "control") return "Control";
  if (key === "variant_c") return model === "abc" ? "Variant C" : "Variant";
  return model === "personalization" ? "Personalization" : "Variant";
}

function getVariantSeriesLabel(model, key) {
  if (key === "control") return "Control";
  if (key === "variant_c") return model === "abc" ? "Variant C" : "Variant";
  return model === "personalization" ? "Personalization" : "Variant";
}

function calculateRate(conversionsValue, sessionsValue) {
  const sessions = toNumber(sessionsValue);
  const conversions = Math.min(Math.max(toNumber(conversionsValue), 0), sessions);
  if (sessions <= 0) return null;
  return conversions / sessions;
}

function calculateUplift(controlRate, variantRate) {
  if (controlRate === null || variantRate === null || controlRate === 0) return null;
  return (variantRate / controlRate) - 1;
}

function calculateSignificance(controlSessionsValue, variantSessionsValue, controlConversionsValue, variantConversionsValue) {
  const n1 = toNumber(controlSessionsValue);
  const n2 = toNumber(variantSessionsValue);
  const c1 = Math.min(Math.max(toNumber(controlConversionsValue), 0), n1);
  const c2 = Math.min(Math.max(toNumber(variantConversionsValue), 0), n2);

  if (n1 <= 0 || n2 <= 0) return null;

  const p1 = c1 / n1;
  const p2 = c2 / n2;
  const pooled = (c1 + c2) / (n1 + n2);
  const standardError = Math.sqrt(pooled * (1 - pooled) * ((1 / n1) + (1 / n2)));

  if (!Number.isFinite(standardError) || standardError === 0) return null;

  const zScore = (p2 - p1) / standardError;
  const pValue = 2 * (1 - normalCdf(Math.abs(zScore)));
  const significance = (1 - pValue) * 100;

  if (!Number.isFinite(significance)) return null;
  return Math.max(0, Math.min(100, significance));
}

function isInverseMetric(metricName) {
  return /bounce rate/i.test(String(metricName || ""));
}

function getUpliftTone(uplift, inverse = false) {
  if (uplift === null || uplift === undefined) {
    return "bg-muted/40 text-muted-foreground";
  }

  if (Math.abs(uplift) < 0.0001) {
    return "bg-muted/40 text-muted-foreground";
  }

  const positiveIsGood = !inverse;
  const isGood = uplift > 0 ? positiveIsGood : !positiveIsGood;

  return isGood
    ? "bg-emerald-100/80 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
    : "bg-rose-100/80 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300";
}

function getUpliftTextTone(uplift, inverse = false) {
  if (uplift === null || uplift === undefined || Math.abs(uplift) < 0.0001) {
    return "text-foreground";
  }

  const positiveIsGood = !inverse;
  const isGood = uplift > 0 ? positiveIsGood : !positiveIsGood;

  return isGood
    ? "text-emerald-600 dark:text-emerald-300"
    : "text-rose-600 dark:text-rose-300";
}

function buildMetricStats(model, sessionsMatrix, conversionsMatrix, metricName) {
  const variantKeys = getVariantKeys(model);
  const segments = {};

  SEGMENTS.forEach((segment) => {
    const traffic = sessionsMatrix?.[segment.key] || {};
    const conversions = conversionsMatrix?.[segment.key] || {};
    const rates = {};
    const uplift = {};
    const significance = {};

    variantKeys.forEach((variantKey) => {
      rates[variantKey] = calculateRate(conversions?.[variantKey], traffic?.[variantKey]);
      if (variantKey !== "control") {
        uplift[variantKey] = calculateUplift(rates.control, rates[variantKey]);
        significance[variantKey] = calculateSignificance(
          traffic?.control,
          traffic?.[variantKey],
          conversions?.control,
          conversions?.[variantKey]
        );
      }
    });

    segments[segment.key] = {
      sessions: {
        control: toNumber(traffic?.control),
        variant: toNumber(traffic?.variant),
        variant_c: toNumber(traffic?.variant_c),
      },
      conversions: {
        control: toNumber(conversions?.control),
        variant: toNumber(conversions?.variant),
        variant_c: toNumber(conversions?.variant_c),
      },
      rates,
      uplift,
      significance,
    };
  });

  return {
    inverseMetric: isInverseMetric(metricName),
    segments,
  };
}

function truncateLabel(value, max = 18) {
  const safe = String(value || "").trim();
  if (safe.length <= max) return safe;
  return `${safe.slice(0, max - 1)}…`;
}

function buildGeneratedReport({ ticket, form, metrics, durationDays }) {
  const model = form.test_model;
  const variantKeys = getVariantKeys(model).filter((key) => key !== "control");
  const outcomeLabel = OUTCOME_OPTIONS.find((entry) => entry.value === form.outcome)?.label || "Not set";

  const lines = [
    `# Test Report - ${ticket?.title || "Untitled test"}`,
    "",
    "## Ticket Reference",
    `Client: ${ticket?.client_name || "—"}`,
    `Description: ${ticket?.description || "—"}`,
    `Industry: ${form.industry || "—"}`,
    `Outcome: ${outcomeLabel}`,
    `Go Live Date: ${form.go_live_date || "—"}`,
    `End Date: ${form.end_date || "—"}`,
    `Test Duration: ${durationDays === null ? "—" : `${durationDays} days`}`,
    `Report Model: ${MODEL_OPTIONS.find((entry) => entry.value === model)?.label || "A/B"}`,
    "",
    "## Results Summary",
  ];

  metrics.forEach((metric, index) => {
    const overall = metric.stats.segments.overall;
    const metricTitle = metric.name || (metric.isPrimary ? "Primary Metric" : `Secondary Metric ${index}`);
    lines.push(`### ${metricTitle}`);
    variantKeys.forEach((variantKey) => {
      lines.push(
        [
          `${getVariantSeriesLabel(model, variantKey)}`,
          `Overall CR ${formatRate(overall.rates[variantKey])}`,
          `Uplift ${formatUplift(overall.uplift[variantKey])}`,
          `Significance ${formatSignificance(overall.significance[variantKey])}`,
        ].join(" · ")
      );
    });
    lines.push("");
  });

  lines.push("## Detailed Analysis");

  metrics.forEach((metric, index) => {
    const metricTitle = metric.name || (metric.isPrimary ? "Primary Metric" : `Secondary Metric ${index}`);
    lines.push(`### ${metricTitle}`);
    SEGMENTS.forEach((segment) => {
      const row = metric.stats.segments[segment.key];
      const segmentParts = [
        `${segment.label} Control ${formatRate(row.rates.control)}`,
      ];
      variantKeys.forEach((variantKey) => {
        segmentParts.push(
          `${getVariantSeriesLabel(model, variantKey)} ${formatRate(row.rates[variantKey])}`,
          `Uplift ${formatUplift(row.uplift[variantKey])}`,
          `Significance ${formatSignificance(row.significance[variantKey])}`
        );
      });
      lines.push(segmentParts.join(" | "));
    });
    lines.push("");
  });

  lines.push("## Results Commentary");
  lines.push(form.results_commentary || "No commentary provided.");

  return lines.join("\n");
}

function formatDisplayDate(value) {
  if (!value) return "—";
  const parsed = parseDate(value);
  if (!parsed) return "—";
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

async function exportReportPdf({ ticket, rootElement }) {
  if (!rootElement) {
    throw new Error("Missing export root");
  }

  if (document?.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {}
  }

  const pdf = new jsPDF("p", "mm", "a4");
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 10;
  const printableWidth = pageWidth - margin * 2;
  const printableHeight = pageHeight - margin * 2;
  const sectionGap = 6;
  const sections = Array.from(rootElement.querySelectorAll("[data-export-section='true']"));

  const appendCanvas = (canvas, currentY) => {
    const fullHeightMm = (canvas.height * printableWidth) / canvas.width;

    if (fullHeightMm <= printableHeight) {
      let nextY = currentY;
      if (nextY + fullHeightMm > margin + printableHeight) {
        pdf.addPage();
        nextY = margin;
      }

      pdf.addImage(canvas.toDataURL("image/png"), "PNG", margin, nextY, printableWidth, fullHeightMm, undefined, "FAST");
      return nextY + fullHeightMm + sectionGap;
    }

    const pageSliceHeightPx = Math.floor((printableHeight * canvas.width) / printableWidth);
    let sliceStartY = 0;
    let nextY = currentY;

    if (nextY > margin) {
      pdf.addPage();
      nextY = margin;
    }

    while (sliceStartY < canvas.height) {
      const sliceHeightPx = Math.min(pageSliceHeightPx, canvas.height - sliceStartY);
      const pageCanvas = document.createElement("canvas");
      pageCanvas.width = canvas.width;
      pageCanvas.height = sliceHeightPx;

      const pageContext = pageCanvas.getContext("2d");
      if (!pageContext) {
        throw new Error("Unable to create PDF page context");
      }

      pageContext.fillStyle = "#ffffff";
      pageContext.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      pageContext.drawImage(
        canvas,
        0,
        sliceStartY,
        canvas.width,
        sliceHeightPx,
        0,
        0,
        canvas.width,
        sliceHeightPx
      );

      const sliceHeightMm = (sliceHeightPx * printableWidth) / canvas.width;
      pdf.addImage(pageCanvas.toDataURL("image/png"), "PNG", margin, nextY, printableWidth, sliceHeightMm, undefined, "FAST");
      sliceStartY += sliceHeightPx;

      if (sliceStartY < canvas.height) {
        pdf.addPage();
        nextY = margin;
      } else {
        nextY += sliceHeightMm + sectionGap;
      }
    }

    return nextY;
  };

  let cursorY = margin;
  for (const section of sections) {
    const canvas = await html2canvas(section, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
    });
    cursorY = appendCanvas(canvas, cursorY);
  }

  const safeName = String(ticket?.title || "ticket-report")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/(^-|-$)+/g, "");

  pdf.save(`${safeName || "ticket-report"}.pdf`);
}

function SummaryStat({ label, value, note, valueClassName }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card/75 p-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className={cn("mt-2 text-2xl font-semibold tracking-tight text-foreground", valueClassName)}>{value}</p>
      {note ? <p className="mt-1 text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

function MetricChartPanel({ title, metric, model }) {
  const chartData = useMemo(
    () =>
      SEGMENTS.map((segment) => {
        const row = metric.stats.segments[segment.key];
        const dataRow = {
          name: segment.label,
          [getVariantSeriesLabel(model, "control")]:
            row.rates.control === null ? null : round(row.rates.control * 100, 2),
        };

        getVariantKeys(model)
          .filter((key) => key !== "control")
          .forEach((key) => {
            dataRow[getVariantSeriesLabel(model, key)] =
              row.rates[key] === null ? null : round(row.rates[key] * 100, 2);
          });

        return dataRow;
      }),
    [metric, model]
  );

  return (
    <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
      <div className="mb-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Metric chart</p>
        <h4 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">{title}</h4>
      </div>
      <div className="h-[280px] rounded-[20px] border border-slate-200 bg-white px-4 py-3">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 16, right: 16, left: 0, bottom: 8 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#cbd5e1" opacity={0.8} />
            <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: "#475569", fontSize: 12 }} />
            <YAxis tickLine={false} axisLine={false} tickFormatter={(value) => `${value}%`} tick={{ fill: "#475569", fontSize: 12 }} />
            <Tooltip formatter={(value) => [`${formatNumber(value, 2)}%`, "CR"]} />
            <Legend />
            <Bar dataKey={getVariantSeriesLabel(model, "control")} fill="#94a3b8" radius={[10, 10, 0, 0]} />
            <Bar dataKey={getVariantSeriesLabel(model, "variant")} fill="#6366f1" radius={[10, 10, 0, 0]} />
            {model === "abc" ? (
              <Bar dataKey={getVariantSeriesLabel(model, "variant_c")} fill="#22c55e" radius={[10, 10, 0, 0]} />
            ) : null}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ExportMetricTable({ title, metric, model }) {
  const variantKeys = getVariantKeys(model);

  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-8 shadow-sm">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            {metric.isPrimary ? "Primary metric" : "Secondary metric"}
          </p>
          <h3 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">{title}</h3>
        </div>
      </div>

      <div className="overflow-hidden rounded-[20px] border border-slate-200">
        <table className="min-w-full border-collapse text-sm text-slate-800">
          <thead>
            <tr className="bg-slate-100">
              <th rowSpan={2} className="border-b border-slate-200 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Metric
              </th>
              {SEGMENTS.map((segment) => (
                <th
                  key={segment.key}
                  colSpan={variantKeys.length}
                  className="border-b border-slate-200 px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500"
                >
                  {segment.label}
                </th>
              ))}
            </tr>
            <tr className="bg-slate-50">
              {SEGMENTS.flatMap((segment) =>
                variantKeys.map((variantKey) => (
                  <th
                    key={`${segment.key}-${variantKey}`}
                    className="border-b border-slate-200 px-4 py-2 text-center text-[11px] font-medium text-slate-500"
                  >
                    {getVariantLabel(model, variantKey)}
                  </th>
                ))
              )}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-200">
              <td className="px-4 py-3 font-medium text-slate-900">Sessions</td>
              {SEGMENTS.flatMap((segment) =>
                variantKeys.map((variantKey) => (
                  <td key={`exp-sessions-${segment.key}-${variantKey}`} className="px-4 py-3 text-center">
                    {formatNumber(metric.sessions?.[segment.key]?.[variantKey], 0)}
                  </td>
                ))
              )}
            </tr>
            <tr className="border-b border-slate-200">
              <td className="px-4 py-3 font-medium text-slate-900">Conversions</td>
              {SEGMENTS.flatMap((segment) =>
                variantKeys.map((variantKey) => (
                  <td key={`exp-conv-${segment.key}-${variantKey}`} className="px-4 py-3 text-center">
                    {formatNumber(metric.conversions?.[segment.key]?.[variantKey], 0)}
                  </td>
                ))
              )}
            </tr>
            <tr className="border-b border-slate-200 bg-slate-50/80">
              <td className="px-4 py-3 font-medium text-slate-900">CR</td>
              {SEGMENTS.flatMap((segment) =>
                variantKeys.map((variantKey) => (
                  <td key={`exp-rate-${segment.key}-${variantKey}`} className="px-4 py-3 text-center font-medium">
                    {formatRate(metric.stats?.segments?.[segment.key]?.rates?.[variantKey])}
                  </td>
                ))
              )}
            </tr>
            <tr className="border-b border-slate-200">
              <td className="px-4 py-3 font-medium text-slate-900">Uplift</td>
              {SEGMENTS.flatMap((segment) =>
                variantKeys.map((variantKey) => {
                  const uplift = metric.stats?.segments?.[segment.key]?.uplift?.[variantKey];
                  const isControl = variantKey === "control";
                  return (
                    <td key={`exp-uplift-${segment.key}-${variantKey}`} className="px-4 py-3 text-center">
                      {isControl ? (
                        "—"
                      ) : (
                        <span className={cn("font-semibold", getUpliftTextTone(uplift, metric.stats?.inverseMetric))}>
                          {formatUplift(uplift)}
                        </span>
                      )}
                    </td>
                  );
                })
              )}
            </tr>
            <tr>
              <td className="px-4 py-3 font-medium text-slate-900">Statistical Significance</td>
              {SEGMENTS.flatMap((segment) =>
                variantKeys.map((variantKey) => {
                  const significance = metric.stats?.segments?.[segment.key]?.significance?.[variantKey];
                  const isControl = variantKey === "control";
                  return (
                    <td key={`exp-significance-${segment.key}-${variantKey}`} className={cn("px-4 py-3 text-center", significance >= 90 && !isControl ? "font-bold" : "font-medium")}>
                      {isControl ? "—" : formatSignificance(significance)}
                    </td>
                  );
                })
              )}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MetricTableCard({
  title,
  metricName,
  onMetricNameChange,
  model,
  sessions,
  conversions,
  stats,
  canEdit,
  isPrimary,
  onSessionChange,
  onConversionChange,
  onRemove,
}) {
  const variantKeys = getVariantKeys(model);

  return (
    <Card className="border border-border/70 bg-card/85 shadow-sm">
      <CardHeader className="space-y-3 pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-sm font-semibold">{title}</CardTitle>
              <Badge variant="outline" className="text-[10px]">
                {isPrimary ? "Primary" : "Secondary"}
              </Badge>
              {!isPrimary ? (
                <Badge variant="outline" className="text-[10px] border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-500/35 dark:bg-cyan-500/15 dark:text-cyan-300">
                  Shared Sessions
                </Badge>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              {isPrimary
                ? "Inserisci sessions e conversions per tutti i segmenti."
                : "Le sessions ereditano automaticamente i valori della primary metric."}
            </p>
          </div>
          {!isPrimary && canEdit ? (
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={onRemove}>
              <Trash2 className="h-4 w-4 text-muted-foreground" />
            </Button>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground">
            {isPrimary ? "Primary Metric Name" : "Metric Name"}
          </label>
          <Input
            value={metricName}
            onChange={(event) => onMetricNameChange(event.target.value)}
            placeholder={isPrimary ? "CTR to PDP" : "Add to Cart Rate"}
            disabled={!canEdit}
          />
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        <div className="overflow-x-auto rounded-2xl border border-border/70 bg-background/30">
          <table className="min-w-[980px] w-full text-sm">
            <thead>
              <tr className="border-b border-border/70 bg-muted/25">
                <th rowSpan={2} className="min-w-[160px] px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Metric
                </th>
                {SEGMENTS.map((segment) => (
                  <th
                    key={segment.key}
                    colSpan={variantKeys.length}
                    className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
                  >
                    {segment.label}
                  </th>
                ))}
              </tr>
              <tr className="border-b border-border/70 bg-muted/10">
                {SEGMENTS.flatMap((segment) =>
                  variantKeys.map((variantKey) => (
                    <th
                      key={`${segment.key}-${variantKey}`}
                      className="px-3 py-2 text-center text-[11px] font-medium text-muted-foreground"
                    >
                      {getVariantLabel(model, variantKey)}
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border/60">
                <td className="px-4 py-3 font-medium text-foreground">Sessions</td>
                {SEGMENTS.flatMap((segment) =>
                  variantKeys.map((variantKey) => (
                    <td key={`sessions-${segment.key}-${variantKey}`} className="px-2 py-2">
                      {isPrimary ? (
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          value={sessions?.[segment.key]?.[variantKey] ?? ""}
                          onChange={(event) => onSessionChange(segment.key, variantKey, event.target.value)}
                          className="h-9 text-center"
                          disabled={!canEdit}
                        />
                      ) : (
                        <div className="flex h-9 items-center justify-center rounded-xl border border-border/60 bg-muted/15 px-3 text-sm text-foreground">
                          {formatNumber(toNumber(sessions?.[segment.key]?.[variantKey]), 0)}
                        </div>
                      )}
                    </td>
                  ))
                )}
              </tr>

              <tr className="border-b border-border/60">
                <td className="px-4 py-3 font-medium text-foreground">Conversions</td>
                {SEGMENTS.flatMap((segment) =>
                  variantKeys.map((variantKey) => (
                    <td key={`conversions-${segment.key}-${variantKey}`} className="px-2 py-2">
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        value={conversions?.[segment.key]?.[variantKey] ?? ""}
                        onChange={(event) => onConversionChange(segment.key, variantKey, event.target.value)}
                        className="h-9 text-center"
                        disabled={!canEdit}
                      />
                    </td>
                  ))
                )}
              </tr>

              <tr className="border-b border-border/60 bg-muted/10">
                <td className="px-4 py-3 font-medium text-foreground">%</td>
                {SEGMENTS.flatMap((segment) =>
                  variantKeys.map((variantKey) => (
                    <td key={`rate-${segment.key}-${variantKey}`} className="px-3 py-3 text-center text-sm font-medium text-foreground">
                      {formatRate(stats?.segments?.[segment.key]?.rates?.[variantKey])}
                    </td>
                  ))
                )}
              </tr>

              <tr className="border-b border-border/60">
                <td className="px-4 py-3 font-medium text-foreground">Uplift</td>
                {SEGMENTS.flatMap((segment) =>
                  variantKeys.map((variantKey) => {
                    const uplift = stats?.segments?.[segment.key]?.uplift?.[variantKey];
                    const isControl = variantKey === "control";
                    return (
                      <td key={`uplift-${segment.key}-${variantKey}`} className="px-3 py-3 text-center">
                        {isControl ? (
                          <span className="text-sm text-muted-foreground">—</span>
                        ) : (
                          <span
                            className={cn(
                              "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold",
                              getUpliftTone(uplift, stats?.inverseMetric)
                            )}
                          >
                            {formatUplift(uplift)}
                          </span>
                        )}
                      </td>
                    );
                  })
                )}
              </tr>

              <tr>
                <td className="px-4 py-3 font-medium text-foreground">Statistical Significance</td>
                {SEGMENTS.flatMap((segment) =>
                  variantKeys.map((variantKey) => {
                    const significance = stats?.segments?.[segment.key]?.significance?.[variantKey];
                    const isControl = variantKey === "control";
                    return (
                      <td
                        key={`significance-${segment.key}-${variantKey}`}
                        className={cn(
                          "px-3 py-3 text-center text-sm text-foreground",
                          significance >= 90 && !isControl && "font-semibold"
                        )}
                      >
                        {isControl ? "—" : formatSignificance(significance)}
                      </td>
                    );
                  })
                )}
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export default function TestReportCard({
  ticket,
  client = null,
  industryOptions = DEFAULT_INDUSTRY_OPTIONS,
  canEdit = false,
  onPersist,
  actorName = "",
  onDirtyChange,
}) {
  const [form, setForm] = useState(() => normalizeReport(ticket?.test_report));
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selectedMetricId, setSelectedMetricId] = useState(PRIMARY_METRIC_ID);
  const baselineSnapshotRef = useRef("");
  const exportRootRef = useRef(null);

  useEffect(() => {
    const next = normalizeReport(ticket?.test_report);
    if (!next.industry && client?.industry) {
      next.industry = client.industry;
    }
    setForm(next);
    setSelectedMetricId(PRIMARY_METRIC_ID);
    baselineSnapshotRef.current = JSON.stringify(buildComparableReportDraft(next));
    onDirtyChange?.(false);
  }, [ticket?.id, ticket?.test_report, client?.industry, onDirtyChange]);

  useEffect(() => {
    const currentSnapshot = JSON.stringify(buildComparableReportDraft(form));
    onDirtyChange?.(currentSnapshot !== baselineSnapshotRef.current);
  }, [form, onDirtyChange]);

  const model = form.test_model || "ab";
  const variantKeys = useMemo(() => getVariantKeys(model), [model]);
  const durationDays = useMemo(
    () => calculateDurationDays(form.go_live_date, form.end_date),
    [form.go_live_date, form.end_date]
  );
  const industrySelectOptions = useMemo(() => {
    const current = String(form.industry || "").trim();
    return current && !industryOptions.includes(current)
      ? [...industryOptions, current]
      : industryOptions;
  }, [industryOptions, form.industry]);

  const metrics = useMemo(() => {
    const primaryMetric = {
      id: PRIMARY_METRIC_ID,
      name: form.primary_metric_name,
      isPrimary: true,
      conversions: form.primary_metric_conversions,
    };

    return [
      primaryMetric,
      ...(form.secondary_metrics || []).map((metric) => ({
        id: metric.id,
        name: metric.name,
        isPrimary: false,
        conversions: metric.conversions,
      })),
    ];
  }, [form.primary_metric_conversions, form.primary_metric_name, form.secondary_metrics]);

  const metricStats = useMemo(() => {
    return metrics.map((metric) => ({
      ...metric,
      stats: buildMetricStats(model, form.sessions, metric.conversions, metric.name),
    }));
  }, [form.sessions, metrics, model]);

  useEffect(() => {
    if (!metricStats.some((metric) => metric.id === selectedMetricId)) {
      setSelectedMetricId(PRIMARY_METRIC_ID);
    }
  }, [metricStats, selectedMetricId]);

  const selectedMetric = useMemo(
    () => metricStats.find((metric) => metric.id === selectedMetricId) || metricStats[0],
    [metricStats, selectedMetricId]
  );

  const primaryOverall = metricStats[0]?.stats?.segments?.overall;
  const primaryVariantCandidates = variantKeys
    .filter((key) => key !== "control")
    .map((key) => ({
      key,
      label: getVariantSeriesLabel(model, key),
      uplift: primaryOverall?.uplift?.[key] ?? null,
      significance: primaryOverall?.significance?.[key] ?? null,
    }));

  const primaryBestVariant = useMemo(() => {
    if (!metricStats[0]) return null;
    const inverseMetric = metricStats[0].stats.inverseMetric;
    const score = (value) => {
      if (value === null || value === undefined) return Number.NEGATIVE_INFINITY;
      return inverseMetric ? -value : value;
    };
    return [...primaryVariantCandidates].sort((a, b) => score(b.uplift) - score(a.uplift))[0] || null;
  }, [metricStats, primaryVariantCandidates]);

  const selectedMetricChartData = useMemo(() => {
    if (!selectedMetric) return [];
    return SEGMENTS.map((segment) => {
      const row = selectedMetric.stats.segments[segment.key];
      const dataRow = {
        name: segment.label,
        [getVariantSeriesLabel(model, "control")]: row.rates.control === null ? null : round(row.rates.control * 100, 2),
      };

      variantKeys
        .filter((key) => key !== "control")
        .forEach((key) => {
          dataRow[getVariantSeriesLabel(model, key)] =
            row.rates[key] === null ? null : round(row.rates[key] * 100, 2);
        });

      return dataRow;
    });
  }, [model, selectedMetric, variantKeys]);

  const updateField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const updateSessions = (segmentKey, variantKey, value) => {
    setForm((prev) => ({
      ...prev,
      sessions: {
        ...prev.sessions,
        [segmentKey]: {
          ...prev.sessions[segmentKey],
          [variantKey]: value,
        },
      },
    }));
  };

  const updatePrimaryConversions = (segmentKey, variantKey, value) => {
    setForm((prev) => ({
      ...prev,
      primary_metric_conversions: {
        ...prev.primary_metric_conversions,
        [segmentKey]: {
          ...prev.primary_metric_conversions[segmentKey],
          [variantKey]: value,
        },
      },
    }));
  };

  const updateSecondaryMetric = (metricId, patch) => {
    setForm((prev) => ({
      ...prev,
      secondary_metrics: (prev.secondary_metrics || []).map((metric) =>
        metric.id === metricId ? { ...metric, ...patch } : metric
      ),
    }));
  };

  const updateSecondaryConversions = (metricId, segmentKey, variantKey, value) => {
    setForm((prev) => ({
      ...prev,
      secondary_metrics: (prev.secondary_metrics || []).map((metric) =>
        metric.id === metricId
          ? {
              ...metric,
              conversions: {
                ...metric.conversions,
                [segmentKey]: {
                  ...metric.conversions[segmentKey],
                  [variantKey]: value,
                },
              },
            }
          : metric
      ),
    }));
  };

  const addSecondaryMetric = () => {
    setForm((prev) => ({
      ...prev,
      secondary_metrics: [...(prev.secondary_metrics || []), createSecondaryMetric()],
    }));
  };

  const removeSecondaryMetric = (metricId) => {
    setForm((prev) => ({
      ...prev,
      secondary_metrics: (prev.secondary_metrics || []).filter((metric) => metric.id !== metricId),
    }));
    setSelectedMetricId((current) => (current === metricId ? PRIMARY_METRIC_ID : current));
  };

  const persist = async (nextForm, { generated = false } = {}) => {
    if (!onPersist) return false;
    const payload = serializeReport(nextForm, actorName);

    setSaving(true);
    try {
      await onPersist(payload, { generated });
      baselineSnapshotRef.current = JSON.stringify(buildComparableReportDraft(nextForm));
      onDirtyChange?.(false);
      toast({
        title: generated ? "Report generated" : "Report saved",
        description: generated
          ? "The structured summary has been regenerated from the latest data."
          : "The test report has been updated correctly.",
      });
      return true;
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Save failed",
        description: "Unable to update the report. Try again in a moment.",
      });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!canEdit) return;
    await persist(form);
  };

  const handleGenerate = async () => {
    if (!canEdit) return;
    setGenerating(true);
    try {
      const nextForm = {
        ...form,
        generated_report: buildGeneratedReport({
          ticket,
          form,
          metrics: metricStats,
          durationDays,
        }),
        generated_at: new Date().toISOString(),
        generated_by: actorName || "",
      };
      setForm(nextForm);
      await persist(nextForm, { generated: true });
    } finally {
      setGenerating(false);
    }
  };

  const handleExportPdf = async () => {
    setExporting(true);
    try {
      await exportReportPdf({
        ticket,
        rootElement: exportRootRef.current,
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Export failed",
        description: "Unable to export the report in PDF format.",
      });
    } finally {
      setExporting(false);
    }
  };

  const exportOutcomeLabel = OUTCOME_OPTIONS.find((entry) => entry.value === form.outcome)?.label || "—";
  const hasResultsCommentary = Boolean(String(form.results_commentary || "").trim());

  return (
    <>
      <div ref={exportRootRef} className="pointer-events-none fixed left-[-20000px] top-0 z-[-1] w-[1180px] bg-white p-8 text-slate-900">
        <div className="space-y-5 bg-white">
          <div data-export-section="true" className="rounded-[28px] border border-slate-200 bg-white p-10 shadow-sm">
            <div className="flex items-start justify-between gap-8">
              <div className="max-w-[720px]">
                <p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-slate-500">Client test report</p>
                <h1 className="mt-3 text-[36px] font-semibold leading-tight tracking-tight text-slate-950">
                  {ticket?.title || "Untitled test"}
                </h1>
                <p className="mt-5 text-[15px] leading-7 text-slate-600">
                  {ticket?.description || "No description available for this ticket."}
                </p>
              </div>
              <div className="grid min-w-[280px] gap-3">
                <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Cliente</p>
                  <p className="mt-2 text-lg font-semibold text-slate-950">{ticket?.client_name || "—"}</p>
                </div>
                <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Industry</p>
                  <p className="mt-2 text-lg font-semibold text-slate-950">{form.industry || client?.industry || "—"}</p>
                </div>
                <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Outcome</p>
                  <p className="mt-2 text-lg font-semibold text-slate-950">{exportOutcomeLabel}</p>
                </div>
              </div>
            </div>

            <div className="mt-8 grid grid-cols-4 gap-4">
              <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Go live date</p>
                <p className="mt-2 text-base font-semibold text-slate-950">{formatDisplayDate(form.go_live_date)}</p>
              </div>
              <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">End date</p>
                <p className="mt-2 text-base font-semibold text-slate-950">{formatDisplayDate(form.end_date)}</p>
              </div>
              <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Test duration</p>
                <p className="mt-2 text-base font-semibold text-slate-950">{durationDays === null ? "—" : `${durationDays} giorni`}</p>
              </div>
              <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Primary metric</p>
                <p className="mt-2 text-base font-semibold text-slate-950">{form.primary_metric_name || "—"}</p>
              </div>
            </div>

            <div className="mt-8 grid grid-cols-4 gap-4">
              <div className="rounded-[22px] border border-slate-200 bg-white p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Metrics tracked</p>
                <p className="mt-3 text-[30px] font-semibold tracking-tight text-slate-950">{metricStats.length}</p>
              </div>
              <div className="rounded-[22px] border border-slate-200 bg-white p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Primary uplift</p>
                <p className={cn("mt-3 text-[30px] font-semibold tracking-tight", primaryBestVariant ? getUpliftTextTone(primaryBestVariant.uplift, metricStats[0]?.stats?.inverseMetric).replace("dark:text-emerald-300", "").replace("dark:text-rose-300", "") : "text-slate-950")}>
                  {primaryBestVariant ? formatUplift(primaryBestVariant.uplift) : "—"}
                </p>
              </div>
              <div className="rounded-[22px] border border-slate-200 bg-white p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Primary significance</p>
                <p className="mt-3 text-[30px] font-semibold tracking-tight text-slate-950">
                  {primaryBestVariant ? formatSignificance(primaryBestVariant.significance) : "—"}
                </p>
              </div>
              <div className="rounded-[22px] border border-slate-200 bg-white p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Report model</p>
                <p className="mt-3 text-[30px] font-semibold tracking-tight text-slate-950">
                  {MODEL_OPTIONS.find((entry) => entry.value === model)?.label || "A/B"}
                </p>
              </div>
            </div>
          </div>

          {metricStats.map((metric, index) => (
            <div key={`export-metric-${metric.id}`} data-export-section="true" className="grid gap-5 xl:grid-cols-[0.92fr_1.08fr]">
              <MetricChartPanel
                title={metric.name || (metric.isPrimary ? "Primary Metric" : `Secondary Metric ${index}`)}
                metric={metric}
                model={model}
              />
              <ExportMetricTable
                title={metric.name || (metric.isPrimary ? "Primary Metric" : `Secondary Metric ${index}`)}
                metric={{
                  ...metric,
                  sessions: form.sessions,
                }}
                model={model}
              />
            </div>
          ))}

          {hasResultsCommentary ? (
            <div data-export-section="true" className="rounded-[28px] border border-slate-200 bg-white p-8 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Results commentary</p>
              <div className="mt-4 rounded-[22px] border border-slate-200 bg-slate-50 p-5">
                <p className="whitespace-pre-wrap text-[15px] leading-7 text-slate-700">
                  {form.results_commentary}
                </p>
              </div>
            </div>
          ) : null}

        </div>
      </div>

      <Card className="border border-border bg-card shadow-sm">
      <CardHeader className="pb-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <BarChart3 className="h-4 w-4 text-cyan-500" />
              <CardTitle className="text-sm font-semibold">Report Test</CardTitle>
              <Badge variant="outline" className="text-[10px]">
                {MODEL_OPTIONS.find((entry) => entry.value === model)?.label || "A/B"}
              </Badge>
              {canEdit ? (
                <Badge variant="outline" className="border-cyan-200 bg-cyan-50 text-[10px] text-cyan-700 dark:border-cyan-500/35 dark:bg-cyan-500/15 dark:text-cyan-300">
                  Editable
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px]">
                  Read only
                </Badge>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={handleExportPdf}
              disabled={exporting}
            >
              {exporting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileDown className="mr-1.5 h-3.5 w-3.5" />}
              Export PDF
            </Button>
            {canEdit ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={handleGenerate}
                  disabled={saving || generating}
                >
                  {generating ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                  Generate Summary
                </Button>
                <Button
                  size="sm"
                  className="h-8 text-xs"
                  onClick={handleSave}
                  disabled={saving || generating}
                >
                  {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
                  Save Report
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
          <div className="rounded-2xl border border-border/70 bg-card/80 p-5 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Title</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
              {ticket?.title || "Untitled test"}
            </h2>
            <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Description</p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
              {ticket?.description || "No description available for this ticket."}
            </p>
          </div>

          <div className="rounded-2xl border border-border/70 bg-card/80 p-5 shadow-sm">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Client Tag
                </label>
                <div className="flex min-h-10 items-center rounded-xl border border-border/70 bg-background/40 px-3.5">
                  <Badge variant="outline" className="border-border/80 bg-muted/30 text-xs">
                    {ticket?.client_name || "No client"}
                  </Badge>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Industry
                </label>
                <Select value={form.industry} onValueChange={(value) => updateField("industry", value)} disabled={!canEdit}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select industry" />
                  </SelectTrigger>
                  <SelectContent>
                    {industrySelectOptions.map((industry) => (
                      <SelectItem key={industry} value={industry}>
                        {industry}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Test Outcome
                </label>
                <Select value={form.outcome} onValueChange={(value) => updateField("outcome", value)} disabled={!canEdit}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select outcome" />
                  </SelectTrigger>
                  <SelectContent>
                    {OUTCOME_OPTIONS.map((outcome) => (
                      <SelectItem key={outcome.value} value={outcome.value}>
                        {outcome.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Report Model
                </label>
                <Select value={model} onValueChange={(value) => updateField("test_model", value)} disabled={!canEdit}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select model" />
                  </SelectTrigger>
                  <SelectContent>
                    {MODEL_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Go Live Date
            </label>
            <Input
              type="date"
              value={form.go_live_date}
              onChange={(event) => updateField("go_live_date", event.target.value)}
              disabled={!canEdit}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              End Date
            </label>
            <Input
              type="date"
              value={form.end_date}
              onChange={(event) => updateField("end_date", event.target.value)}
              disabled={!canEdit}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Test Duration
            </label>
            <div className="flex h-10 items-center gap-2 rounded-xl border border-border/70 bg-background/40 px-3.5 text-sm text-foreground">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              {durationDays === null ? "—" : `${durationDays} days`}
            </div>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-4">
          <SummaryStat
            label="Metrics tracked"
            value={String(metricStats.length)}
            note="Primary + secondary metrics"
          />
          <SummaryStat
            label="Primary uplift"
            value={primaryBestVariant ? formatUplift(primaryBestVariant.uplift) : "—"}
            note={primaryBestVariant ? primaryBestVariant.label : "No uplift yet"}
            valueClassName={cn(primaryBestVariant ? getUpliftTextTone(primaryBestVariant.uplift, metricStats[0]?.stats?.inverseMetric) : "")}
          />
          <SummaryStat
            label="Primary significance"
            value={primaryBestVariant ? formatSignificance(primaryBestVariant.significance) : "—"}
            note={primaryBestVariant ? primaryBestVariant.label : "No significance yet"}
            valueClassName={primaryBestVariant?.significance >= 90 ? "font-bold" : ""}
          />
          <SummaryStat
            label="Outcome"
            value={OUTCOME_OPTIONS.find((entry) => entry.value === form.outcome)?.label || "—"}
            note={form.industry || "No industry selected"}
          />
        </div>

        <MetricTableCard
          title="Primary Metric"
          metricName={form.primary_metric_name}
          onMetricNameChange={(value) => updateField("primary_metric_name", value)}
          model={model}
          sessions={form.sessions}
          conversions={form.primary_metric_conversions}
          stats={metricStats[0]?.stats}
          canEdit={canEdit}
          isPrimary
          onSessionChange={updateSessions}
          onConversionChange={updatePrimaryConversions}
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Secondary Metrics</p>
            <p className="text-xs text-muted-foreground">
              Add more metrics to evaluate the same test with shared traffic.
            </p>
          </div>
          {canEdit ? (
            <Button type="button" variant="outline" size="sm" className="h-9" onClick={addSecondaryMetric}>
              <Plus className="mr-1.5 h-4 w-4" />
              Add Secondary Metric
            </Button>
          ) : null}
        </div>

        <div className="space-y-4">
          {form.secondary_metrics.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/70 bg-muted/10 px-5 py-10 text-center text-sm text-muted-foreground">
              No secondary metrics yet.
            </div>
          ) : (
            form.secondary_metrics.map((metric, index) => {
              const stats = metricStats.find((entry) => entry.id === metric.id)?.stats;
              return (
                <MetricTableCard
                  key={metric.id}
                  title={`Secondary Metric ${index + 1}`}
                  metricName={metric.name}
                  onMetricNameChange={(value) => updateSecondaryMetric(metric.id, { name: value })}
                  model={model}
                  sessions={form.sessions}
                  conversions={metric.conversions}
                  stats={stats}
                  canEdit={canEdit}
                  isPrimary={false}
                  onSessionChange={() => {}}
                  onConversionChange={(segmentKey, variantKey, value) =>
                    updateSecondaryConversions(metric.id, segmentKey, variantKey, value)
                  }
                  onRemove={() => removeSecondaryMetric(metric.id)}
                />
              );
            })
          )}
        </div>

        <div className="grid gap-4">
          <Card className="border border-border/70 bg-card/80 shadow-sm">
            <CardHeader className="space-y-3 pb-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-sm font-semibold">Conversion Rate by Segment</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Automatic chart for the selected metric.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {metricStats.map((metric, index) => (
                    <Button
                      key={metric.id}
                      type="button"
                      size="sm"
                      variant={selectedMetricId === metric.id ? "default" : "outline"}
                      className="h-7 rounded-full px-3 text-[11px]"
                      onClick={() => setSelectedMetricId(metric.id)}
                    >
                      {truncateLabel(metric.name || (metric.isPrimary ? "Primary Metric" : `Metric ${index}`), 18)}
                    </Button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={selectedMetricChartData} margin={{ top: 12, right: 16, left: 0, bottom: 4 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="currentColor" opacity={0.08} />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} />
                    <YAxis tickLine={false} axisLine={false} tickFormatter={(value) => `${value}%`} />
                    <Tooltip formatter={(value) => [`${formatNumber(value, 2)}%`, "CR"]} />
                    <Legend />
                    <Bar dataKey={getVariantSeriesLabel(model, "control")} fill="#94a3b8" radius={[8, 8, 0, 0]} />
                    <Bar dataKey={getVariantSeriesLabel(model, "variant")} fill="#6366f1" radius={[8, 8, 0, 0]} />
                    {model === "abc" ? (
                      <Bar dataKey={getVariantSeriesLabel(model, "variant_c")} fill="#22c55e" radius={[8, 8, 0, 0]} />
                    ) : null}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Results Commentary
          </label>
          <Textarea
            value={form.results_commentary}
            onChange={(event) => updateField("results_commentary", event.target.value)}
            className="min-h-[180px] text-sm"
            placeholder="Insights, interpretation of results, and recommendations."
            disabled={!canEdit}
          />
        </div>

        <Card className="border border-border/70 bg-card/80 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-sm font-semibold">Generated Summary</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  Structured text generated from the report data for client sharing.
                </p>
              </div>
              {form.generated_at ? (
                <Badge variant="outline" className="text-[10px]">
                  Updated {new Date(form.generated_at).toLocaleString()}
                </Badge>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="rounded-2xl border border-border/70 bg-background/35 p-4">
              <pre className="whitespace-pre-wrap text-sm leading-6 text-foreground">
                {form.generated_report || "Generate a summary once the data table is filled."}
              </pre>
            </div>
          </CardContent>
        </Card>
      </CardContent>
    </Card>
    </>
  );
}
