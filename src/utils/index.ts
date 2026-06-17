export function createPageUrl(pageName: string) {
    return '/' + pageName.replace(/ /g, '-');
}

export function normalizeAppRole(role: string | null | undefined) {
    return String(role || "user").trim().toLowerCase();
}

export const KNOWN_APP_ROLES = ["admin", "analyst", "developer", "tech_supervisor"] as const;

export function isKnownAppRole(role: string | null | undefined) {
    return KNOWN_APP_ROLES.includes(normalizeAppRole(role) as (typeof KNOWN_APP_ROLES)[number]);
}

export function isTechSupervisorRole(role: string | null | undefined) {
    return normalizeAppRole(role) === "tech_supervisor";
}

export function hasRoleCapability(userLike: any, targetRole: string | null | undefined) {
    const target = normalizeAppRole(targetRole);
    const candidates = [
        userLike?.app_role,
        userLike?._app_role,
        userLike?.raw_role,
        userLike?.secondary_role,
        userLike?.role,
    ].map(normalizeAppRole);

    return candidates.includes(target);
}

export function hasTechSupervisorCapability(userLike: any) {
    return hasRoleCapability(userLike, "tech_supervisor");
}

export function isDeveloperLikeRole(role: string | null | undefined) {
    const normalizedRole = normalizeAppRole(role);
    return normalizedRole === "developer" || normalizedRole === "tech_supervisor";
}

export function getHomePageForRole(role: string | null | undefined) {
    const normalizedRole = normalizeAppRole(role);
    if (normalizedRole === "developer" || normalizedRole === "tech_supervisor") return "DevPipeline";
    if (normalizedRole === "analyst" || normalizedRole === "admin") return "MyTickets";
    return "MyTickets";
}

export function createTicketDetailUrl(ticketId: string | null | undefined, fromPage?: string | null) {
    const params = new URLSearchParams();
    params.set("id", String(ticketId || ""));
    if (fromPage) params.set("from", String(fromPage));
    return `${createPageUrl("TicketDetail")}?${params.toString()}`;
}
