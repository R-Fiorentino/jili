export function normalizeReferenceLinks(referenceLinks = [], fallbackLink = "") {
  const rawLinks = Array.isArray(referenceLinks) ? referenceLinks : [];
  const links = rawLinks
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  if (links.length > 0) {
    return [...new Set(links)];
  }

  const normalizedFallback = String(fallbackLink || "").trim();
  return normalizedFallback ? [normalizedFallback] : [];
}

export function buildReferenceLinksPayload(referenceLinks = [], fallbackLink = "") {
  const normalizedLinks = normalizeReferenceLinks(referenceLinks, fallbackLink);
  return {
    reference_links: normalizedLinks,
    link: normalizedLinks[0] || "",
  };
}

export function getReferenceLinkLabel(referenceLink, index = 0) {
  try {
    const parsed = new URL(referenceLink);
    const hostname = parsed.hostname.replace(/^www\./i, "");
    return hostname || `Link ${index + 1}`;
  } catch {
    return `Link ${index + 1}`;
  }
}
