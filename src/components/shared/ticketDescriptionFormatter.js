const SECTION_ORDER = [
  { key: "objective", label: "Obiettivo" },
  { key: "hypothesis", label: "Ipotesi" },
  { key: "change", label: "Modifica proposta" },
  { key: "context", label: "Audience / contesto" },
  { key: "metrics", label: "Metriche da monitorare" },
  { key: "completion", label: "Criteri di completamento" },
];

const SECTION_MATCHERS = {
  objective: /^obiettivo$/i,
  hypothesis: /^ipotesi$/i,
  change: /^modifica proposta$/i,
  context: /^audience\s*\/\s*contesto$/i,
  metrics: /^metriche da monitorare$/i,
  completion: /^criteri di completamento$/i,
};

function normalizeText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitParagraphs(text) {
  return normalizeText(text)
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function parseStructuredSections(text) {
  const normalized = normalizeText(text);
  if (!normalized) return {};

  const lines = normalized.split("\n");
  const parsed = {};
  let currentKey = null;

  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    const heading = line.replace(/:\s*$/, "");
    const matchedEntry = Object.entries(SECTION_MATCHERS).find(([, matcher]) =>
      matcher.test(heading)
    );

    if (matchedEntry) {
      currentKey = matchedEntry[0];
      if (!parsed[currentKey]) parsed[currentKey] = [];
      return;
    }

    if (currentKey) {
      parsed[currentKey].push(rawLine);
    }
  });

  return Object.fromEntries(
    Object.entries(parsed)
      .map(([key, value]) => [key, normalizeText(value.join("\n"))])
      .filter(([, value]) => value)
  );
}

function deriveObjective(title, paragraphs) {
  if (paragraphs[0]) return paragraphs[0];
  if (title) return `Validare il test "${title}".`;
  return "Da definire.";
}

function deriveChange(paragraphs) {
  if (paragraphs.length <= 1) return paragraphs[0] || "Da definire.";
  return paragraphs.slice(1).join("\n\n");
}

export function buildStandardizedDescription({ title = "", description = "" }) {
  const parsed = parseStructuredSections(description);
  const paragraphs = splitParagraphs(description);

  const resolved = {
    objective: parsed.objective || deriveObjective(title, paragraphs),
    hypothesis: parsed.hypothesis || "Da definire.",
    change: parsed.change || deriveChange(paragraphs),
    context: parsed.context || "Da definire.",
    metrics: parsed.metrics || "Da definire.",
    completion: parsed.completion || "Da definire.",
  };

  return SECTION_ORDER.map(({ key, label }) => `${label}\n${resolved[key] || "Da definire."}`).join("\n\n");
}

export function buildStandardizedTracking(requiredTracking = "") {
  const normalized = normalizeText(requiredTracking);
  if (!normalized) return "";

  const rawItems = normalized
    .split(/\n|,|;/)
    .map((item) => item.trim())
    .filter(Boolean);

  const items = rawItems.length > 0 ? rawItems : [normalized];
  return items.map((item) => `- ${item.replace(/^[-*]\s*/, "")}`).join("\n");
}
