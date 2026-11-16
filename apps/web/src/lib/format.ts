import type { Category, Priority, ReportStatus, Role, TaskStatus } from "@resqgrid/api-client";

export const CATEGORY_LABEL: Record<Category, string> = {
  medical: "Medical",
  fire: "Fire",
  flood: "Flood",
  rescue: "Rescue",
  shelter: "Shelter",
  food_water: "Food & water",
  road_block: "Road block",
  other: "Other",
};

export const PRIORITY_LABEL: Record<Priority, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };

export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = {
  new: "New",
  triaged: "Triaged",
  assigned: "Assigned",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
};

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  pending: "Pending",
  accepted: "Accepted",
  en_route: "En route",
  on_site: "On site",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Org admin",
  dispatcher: "Dispatcher",
  responder: "Field responder",
  volunteer_coordinator: "Volunteer coordinator",
  viewer: "Viewer",
};

export const OUTCOME_LABEL = {
  treated_on_site: "Treated on site",
  transported: "Transported to hospital",
  referred: "Referred",
  no_action_needed: "No action needed",
  not_found: "Not found",
} as const;

// Formatting follows the UI language. The I18n provider calls setFormatLocale() when it renders,
// before any consumer, so components re-rendered by a language switch format in the new language.
let fmt: "en" | "ar" = "en";
export const setFormatLocale = (l: "en" | "ar") => {
  fmt = l;
};
const U = {
  en: { s: "s", min: "min", h: "h", d: "d", m: "m", ago: (x: string) => `${x} ago`, km: "km", meters: "m" },
  ar: { s: "ث", min: "د", h: "س", d: "ي", m: "د", ago: (x: string) => `منذ ${x}`, km: "كم", meters: "م" },
};
// Arabic month names with Latin digits, matching the digits used everywhere else in the UI.
const intlLocale = () => (fmt === "ar" ? "ar-EG-u-nu-latn" : undefined);

/** Audit action codes → readable names (codes stay visible on hover for anyone who needs them). */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  "report.created": "Report created", "report.triaged": "Report triaged", "report.rejected": "Report rejected", "report.updated": "Report edited",
  "report.archived": "Report archived", "report.restored": "Report restored", "report.closed": "Report closed", "report.merged": "Reports merged",
  "report.unmerged": "Merge undone", "task.created": "Task assigned", "task.accept": "Task accepted", "task.en_route": "Team on the way",
  "task.on_site": "Team arrived", "task.complete": "Task completed", "task.cancel": "Task cancelled", "task.declined": "Task declined",
  "task.override": "Override used", "override.requested": "Override requested", "resource.reserved": "Resource reserved", "resource.released": "Resource released",
  "stock.adjusted": "Stock adjusted", "shelter.updated": "Shelter updated", "incident.created": "Incident created", "incident.updated": "Incident updated",
  "incident.closed": "Incident closed", "team.created": "Team created", "team.availability": "Team availability changed", "member.duty": "Duty status changed",
  "pii.viewed": "Reporter contact viewed", "export.created": "Data exported", "user.updated": "User updated", "invitation.created": "User invited",
  "org.updated": "Organisation updated", "category_rules.updated": "Category rules changed", "escalation_policy.updated": "Escalation policy changed",
};
export const AUDIT_AREA_LABEL: Record<string, string> = {
  "": "All actions", report: "Reports", task: "Tasks", resource: "Resources", stock: "Stock", shelter: "Shelters",
  pii: "Reporter contact", export: "Exports", override: "Overrides", user: "Users", org: "Organisation",
};

export const capLabel = (k: string) => k.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());

export function ago(iso?: string, now = Date.now()) {
  if (!iso) return "—";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  const u = U[fmt];
  if (s < 60) return u.ago(`${s}${u.s}`);
  const m = Math.floor(s / 60);
  if (m < 60) return u.ago(`${m} ${u.min}`);
  const h = Math.floor(m / 60);
  if (h < 24) return u.ago(`${h} ${u.h}`);
  return u.ago(`${Math.floor(h / 24)} ${u.d}`);
}

export function since(iso?: string, now = Date.now()) {
  if (!iso) return "—";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}:${String(s % 60).padStart(2, "0")}`;
  return `${Math.floor(m / 60)}${U[fmt].h} ${m % 60}${U[fmt].m}`;
}

export function duration(s: number | null | undefined) {
  if (s === null || s === undefined) return "—";
  const u = U[fmt];
  if (s < 60) return `${Math.round(s)}${u.s}`;
  const m = s / 60;
  if (m < 60) return `${m.toFixed(m < 10 ? 1 : 0)} ${u.min}`;
  return `${(m / 60).toFixed(1)} ${u.h}`;
}

export function dateTime(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(intlLocale(), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Short weekday name ("Mon" / "الاثنين") in the UI language. */
export function weekday(date: string) {
  return new Date(date).toLocaleDateString(intlLocale(), { weekday: "short" });
}

export function time(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(intlLocale(), { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export const km = (n?: number) => (n === undefined ? "—" : n < 1 ? `${Math.round(n * 1000)} ${U[fmt].meters}` : `${n.toFixed(1)} ${U[fmt].km}`);

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /\p{L}|\d/u.test(w[0] ?? ""))
    .map((w) => (/\d/.test(w) ? w : w[0]))
    .join("")
    .slice(0, 3)
    .toUpperCase();
