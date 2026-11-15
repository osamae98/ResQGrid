// Mock of the backend services in PRD §12.3: report, dispatch, task, resource, shelter, location, escalation.
// Rules match the PRD so the UI can be built against realistic behaviour and error codes.
import {
  ACTIVE_TASK_STATUSES,
  type Category,
  type CreateReportInput,
  type CreateTaskInput,
  type EventType,
  type ID,
  type LatLng,
  type Outcome,
  type Priority,
  type PublicReportInput,
  type Report,
  type ReportStatus,
  type Resource,
  type Role,
  type Task,
  type TaskStatus,
  type Team,
  type TeamSuggestion,
  type User,
} from "@resqgrid/api-client";
import { publish } from "./bus";
import { type DB, type ReportRec, type TaskRec, type TeamRec, newId, referenceCode } from "./db";
import { distanceKm, round } from "./geo";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
    public details?: Record<string, unknown>,
  ) {
    super(message ?? code);
  }
}

export interface Ctx {
  db: DB;
  user: User;
  orgId: ID;
}

const nowIso = () => new Date().toISOString();
const ageS = (iso?: string) => (iso ? (Date.now() - Date.parse(iso)) / 1000 : Infinity);

export function requireRole(ctx: Ctx, roles: Role[]) {
  if (!roles.includes(ctx.user.role)) throw new HttpError(403, "FORBIDDEN", `Requires role: ${roles.join(", ")}`);
}

// ---------- audit, timeline, notifications ----------

export function audit(ctx: Ctx, action: string, entity_type: string, entity_id: ID, summary: string, before?: object, after?: object) {
  ctx.db.audit.unshift({
    id: newId("aud"),
    organization_id: ctx.orgId,
    actor_name: ctx.user.name,
    action,
    entity_type,
    entity_id,
    summary,
    before: before as Record<string, unknown>,
    after: after as Record<string, unknown>,
    created_at: nowIso(),
  });
}

function reportEvent(db: DB, orgId: ID, reportId: ID, type: string, extra: Record<string, unknown> = {}) {
  db.reportTimeline.push({ id: newId("rte"), organization_id: orgId, parent_id: reportId, type, occurred_at: nowIso(), ...extra });
}

function taskEvent(db: DB, orgId: ID, task: TaskRec, type: string, from: string | undefined, to: string | undefined, actor?: string, note?: string, location?: LatLng) {
  db.taskTimeline.push({
    id: newId("tte"),
    organization_id: orgId,
    parent_id: task.id,
    type,
    from_status: from,
    to_status: to,
    actor_name: actor,
    note,
    location,
    occurred_at: nowIso(),
  });
}

export function notify(db: DB, orgId: ID, userIds: ID[], n: { type: string; title: string; body?: string; link?: string; priority?: "normal" | "high" }) {
  for (const user_id of new Set(userIds)) {
    const rec = { id: newId("ntf"), organization_id: orgId, user_id, created_at: nowIso(), ...n };
    db.notifications.unshift(rec);
    publish(db, orgId, "notification.created", rec.id, rec, { userIds: [user_id] });
  }
}

const usersWithRole = (db: DB, orgId: ID, roles: Role[]) =>
  db.users.filter((u) => u.organization_id === orgId && u.is_active && roles.includes(u.role)).map((u) => u.id);

const STAFF_VIEW: Role[] = ["admin", "dispatcher", "viewer", "volunteer_coordinator"];

// ---------- lookups (always id AND organization_id; a miss is 404) ----------

function findOr404<T extends { id: ID; organization_id: ID }>(rows: T[], orgId: ID, id: ID, what: string): T {
  const r = rows.find((x) => x.id === id && x.organization_id === orgId);
  if (!r) throw new HttpError(404, "NOT_FOUND", `${what} not found`);
  return r;
}
export const getReport = (ctx: Ctx, id: ID) => findOr404(ctx.db.reports, ctx.orgId, id, "Report");
export const getTask = (ctx: Ctx, id: ID) => findOr404(ctx.db.tasks, ctx.orgId, id, "Task");
export const getTeam = (ctx: Ctx, id: ID) => findOr404(ctx.db.teams, ctx.orgId, id, "Team");
export const getResource = (ctx: Ctx, id: ID) => findOr404(ctx.db.resources, ctx.orgId, id, "Resource");
export const getShelter = (ctx: Ctx, id: ID) => findOr404(ctx.db.shelters, ctx.orgId, id, "Shelter");

// ---------- serializers ----------

export function teamCapabilities(team: TeamRec) {
  const now = Date.now();
  const caps = new Set<string>();
  for (const m of team.members) {
    if (!m.on_duty) continue;
    for (const c of m.capabilities) if (!c.expires_at || Date.parse(c.expires_at) > now) caps.add(c.key);
  }
  return [...caps];
}

export function activeTaskOf(db: DB, team: TeamRec) {
  return db.tasks.find((t) => t.assigned_team_id === team.id && ACTIVE_TASK_STATUSES.includes(t.status) && t.status !== "pending")
    ?? db.tasks.find((t) => t.assigned_team_id === team.id && t.status === "pending");
}

function staleWindowS(db: DB, orgId: ID) {
  return db.policies[orgId]?.[0]?.stale_location_s ?? 300;
}

export function isStale(db: DB, team: TeamRec) {
  const t = activeTaskOf(db, team);
  return !!t && t.status !== "pending" && ageS(team.last_location_at) > staleWindowS(db, team.organization_id);
}

export function serializeTeam(db: DB, team: TeamRec): Team {
  const { manual_location_until, silent, stale_level, organization_id, ...rest } = team;
  void manual_location_until;
  void silent;
  void stale_level;
  void organization_id;
  return {
    ...rest,
    availability: team.members.some((m) => m.on_duty) ? team.availability : "off_duty",
    capabilities: teamCapabilities(team),
    is_stale: isStale(db, team),
    active_task_id: activeTaskOf(db, team)?.id,
  };
}

function duplicatesOf(db: DB, r: ReportRec) {
  // Open report, same category, within 200 m and 60 min (REP-4).
  if (r.merged_into_id || r.archived_at || ["resolved", "closed"].includes(r.status)) return [];
  const t = Date.parse(r.created_at);
  return db.reports.filter(
    (o) =>
      o.id !== r.id &&
      o.organization_id === r.organization_id &&
      o.category === r.category &&
      !o.merged_into_id &&
      !o.archived_at &&
      !["resolved", "closed"].includes(o.status) &&
      Math.abs(Date.parse(o.created_at) - t) <= 60 * 60_000 &&
      distanceKm(o.location, r.location) <= 0.2,
  );
}

export function serializeReport(db: DB, r: ReportRec): Report {
  const { contact, organization_id, untriaged_level, ...rest } = r;
  void organization_id;
  void untriaged_level;
  return {
    ...rest,
    possible_duplicate_ids: duplicatesOf(db, r).map((d) => d.id),
    merged_ids: db.reports.filter((o) => o.merged_into_id === r.id).map((o) => o.id),
    task_ids: db.tasks.filter((t) => t.report_id === r.id).map((t) => t.id),
    has_contact: !!contact && !!(contact.name || contact.phone),
  };
}

export function serializeTask(db: DB, t: TaskRec): Task {
  const r = db.reports.find((x) => x.id === t.report_id)!;
  const team = db.teams.find((x) => x.id === t.assigned_team_id);
  const { organization_id, trail, en_route_reminded, ...rest } = t;
  void organization_id;
  void trail;
  void en_route_reminded;
  return {
    ...rest,
    report: {
      reference_code: r.reference_code,
      title: r.title,
      category: r.category,
      priority: r.priority,
      location: r.location,
      address_text: r.address_text,
    },
    team_name: team?.name,
    distance_km: team?.last_location ? round(distanceKm(team.last_location, r.location)) : undefined,
    resources: db.assignments.filter((a) => a.task_id === t.id).map(({ organization_id: _o, ...a }) => (void _o, a)),
  };
}

export function serializeResource(db: DB, r: DB["resources"][number]): Resource {
  const { organization_id, ...rest } = r;
  void organization_id;
  const active = db.assignments.find((a) => a.resource_id === r.id && !a.released_at);
  let location = r.location;
  // Deployed units without their own device show at the team's location (§7.1).
  if (r.kind === "unit" && r.status === "deployed" && active) {
    const task = db.tasks.find((t) => t.id === active.task_id);
    const team = db.teams.find((t) => t.id === task?.assigned_team_id);
    if (team?.last_location) location = team.last_location;
  }
  return {
    ...rest,
    location,
    depot_name: db.depots.find((d) => d.id === r.depot_id)?.name,
    active_task_id: active?.task_id,
  };
}

// ---------- category rules ----------

export function requiredCapabilities(db: DB, orgId: ID, category: Category, priority: Priority) {
  const rule = db.categoryRules[orgId].find((r) => r.category === category);
  if (!rule) return [];
  return priority === "critical" && rule.critical_capabilities?.length ? rule.critical_capabilities : rule.required_capabilities;
}

// ---------- reports ----------

function rateLimit(db: DB, key: string, limit: number, windowS: number) {
  const now = Date.now();
  const hits = (db.rate[key] ?? []).filter((t) => now - t < windowS * 1000);
  if (hits.length >= limit) {
    const retry = Math.ceil((hits[0] + windowS * 1000 - now) / 1000);
    throw new HttpError(429, "RATE_LIMITED", "Too many reports. Please wait before sending another.", { retry_after_s: retry });
  }
  hits.push(now);
  db.rate[key] = hits;
}

function insertReport(db: DB, orgId: ID, input: CreateReportInput & { source: Report["source"]; photo_count?: number }, actorName?: string) {
  const rule = db.categoryRules[orgId].find((r) => r.category === input.category);
  const priority = input.priority ?? rule?.default_priority ?? "medium";
  const now = nowIso();
  const r: ReportRec = {
    id: newId("rep"),
    organization_id: orgId,
    reference_code: referenceCode(),
    incident_id: input.incident_id ?? db.incidents.find((i) => i.organization_id === orgId && i.status === "active" && distanceKm(i.center, input.location) <= i.radius_km)?.id,
    title: input.title || input.description.slice(0, 60),
    description: input.description,
    category: input.category,
    priority,
    status: "new",
    location: input.location,
    address_text: input.address_text,
    people_affected: input.people_affected,
    source: input.source,
    created_at: now,
    updated_at: now,
    photo_count: input.photo_count ?? 0,
    contact: input.name || input.phone ? { name: input.name, phone: input.phone } : undefined,
    untriaged_level: 0,
  };
  db.reports.push(r);
  reportEvent(db, orgId, r.id, "created", { note: `Received via ${r.source}`, actor_name: actorName });
  const payload = serializeReport(db, r);
  publish(db, orgId, "report.created", r.id, payload, { roles: STAFF_VIEW });
  if (priority === "critical") criticalAlert(db, r);
  return r;
}

function criticalAlert(db: DB, r: ReportRec, repeat = false) {
  const dispatchers = usersWithRole(db, r.organization_id, ["dispatcher"]);
  publish(db, r.organization_id, "report.critical_alert", r.id, { id: r.id, category: r.category, location: r.location, sound: true, repeat }, { userIds: dispatchers });
  notify(db, r.organization_id, dispatchers, {
    type: "report.critical_alert",
    title: `${repeat ? "Still untriaged: " : ""}Critical ${r.category.replace("_", " ")} report`,
    body: `${r.reference_code} · ${r.title}`,
    link: `/dispatch?report=${r.id}`,
    priority: "high",
  });
}

export function createPublicReport(db: DB, slug: string, input: PublicReportInput & { life_threatening?: boolean }, ip: string) {
  const org = db.orgs.find((o) => o.slug === slug);
  if (!org) throw new HttpError(404, "NOT_FOUND", "Unknown organisation");
  // Honeypot or too-fast submit: pretend success, store nothing (§8.4).
  if (input.website || (input.fill_ms !== undefined && input.fill_ms < 1500)) return { reference_code: referenceCode() };
  if (!input.description?.trim() || !input.location) throw new HttpError(422, "VALIDATION_ERROR", "Description and location are required");
  rateLimit(db, `ip:${ip}`, 5, 600);
  if (input.phone) rateLimit(db, `phone:${input.phone.replace(/\D/g, "")}`, 3, 600);
  rateLimit(db, `org:${org.id}`, 60, 10);
  const rule = db.categoryRules[org.id].find((r) => r.category === input.category);
  const r = insertReport(db, org.id, {
    ...input,
    title: "",
    priority: input.life_threatening ? "critical" : rule?.default_priority,
    source: "public",
  });
  return { reference_code: r.reference_code };
}

export function createReport(ctx: Ctx, input: CreateReportInput) {
  requireRole(ctx, ["admin", "dispatcher", "responder", "volunteer_coordinator"]);
  const r = insertReport(ctx.db, ctx.orgId, { ...input, source: ctx.user.role === "responder" ? "field" : "dispatcher" }, ctx.user.name);
  audit(ctx, "report.created", "report", r.id, `Created report ${r.reference_code}`);
  return serializeReport(ctx.db, r);
}

function emitReport(ctx: Ctx, r: ReportRec, type: EventType = "report.updated") {
  r.updated_at = nowIso();
  publish(ctx.db, ctx.orgId, type, r.id, serializeReport(ctx.db, r), { roles: STAFF_VIEW });
}

export function triage(ctx: Ctx, id: ID, b: { priority: Priority; category?: Category; incident_id?: ID | null; reject?: boolean }) {
  requireRole(ctx, ["admin", "dispatcher"]);
  const r = getReport(ctx, id);
  const before = { status: r.status, priority: r.priority, category: r.category };
  if (b.reject) {
    if (r.status !== "new" && r.status !== "triaged") throw new HttpError(409, "INVALID_TRANSITION");
    r.rejected = true;
    r.status = "closed";
    reportEvent(ctx.db, ctx.orgId, r.id, "rejected", { actor_name: ctx.user.name, from_status: before.status, to_status: "closed", note: "Rejected at triage (prank / invalid)" });
  } else {
    r.priority = b.priority;
    if (b.category) r.category = b.category;
    if (b.incident_id !== undefined) r.incident_id = b.incident_id ?? undefined;
    if (r.status === "new") {
      r.status = "triaged";
      r.triaged_at = nowIso();
    }
    reportEvent(ctx.db, ctx.orgId, r.id, "triaged", {
      actor_name: ctx.user.name,
      from_status: before.status,
      to_status: r.status,
      note: `Priority ${r.priority}${b.category && b.category !== before.category ? `, category ${b.category}` : ""}`,
    });
  }
  audit(ctx, b.reject ? "report.rejected" : "report.triaged", "report", r.id, `${b.reject ? "Rejected" : "Triaged"} ${r.reference_code}`, before, { status: r.status, priority: r.priority, category: r.category });
  emitReport(ctx, r);
  return serializeReport(ctx.db, r);
}

export function updateReport(ctx: Ctx, id: ID, b: Partial<Pick<Report, "title" | "description" | "category" | "incident_id">>) {
  requireRole(ctx, ["admin", "dispatcher"]);
  const r = getReport(ctx, id);
  const before = { title: r.title, description: r.description, category: r.category, incident_id: r.incident_id };
  Object.assign(r, b);
  reportEvent(ctx.db, ctx.orgId, r.id, "updated", { actor_name: ctx.user.name, note: Object.keys(b).join(", ") });
  audit(ctx, "report.updated", "report", r.id, `Edited ${r.reference_code}`, before, b);
  emitReport(ctx, r);
  return serializeReport(ctx.db, r);
}

export function mergeReport(ctx: Ctx, id: ID, primaryId: ID) {
  requireRole(ctx, ["admin", "dispatcher"]);
  const dup = getReport(ctx, id);
  const primary = getReport(ctx, primaryId);
  if (dup.id === primary.id || primary.merged_into_id) throw new HttpError(409, "INVALID_MERGE");
  dup.merged_into_id = primary.id;
  ctx.db.dupLinks.push({ id: newId("dup"), organization_id: ctx.orgId, primary_report_id: primary.id, duplicate_report_id: dup.id, linked_by: ctx.user.name });
  reportEvent(ctx.db, ctx.orgId, dup.id, "merged", { actor_name: ctx.user.name, note: `Merged into ${primary.reference_code}` });
  reportEvent(ctx.db, ctx.orgId, primary.id, "duplicate_linked", { actor_name: ctx.user.name, note: `${dup.reference_code} merged in` });
  audit(ctx, "report.merged", "report", dup.id, `Merged ${dup.reference_code} into ${primary.reference_code}`);
  emitReport(ctx, dup, "report.merged");
  emitReport(ctx, primary);
  return serializeReport(ctx.db, dup);
}

export function unmergeReport(ctx: Ctx, id: ID) {
  requireRole(ctx, ["admin", "dispatcher"]);
  const dup = getReport(ctx, id);
  const primary = ctx.db.reports.find((r) => r.id === dup.merged_into_id);
  if (!primary) throw new HttpError(409, "NOT_MERGED");
  dup.merged_into_id = undefined;
  const link = ctx.db.dupLinks.find((l) => l.duplicate_report_id === dup.id && !l.unlinked_at);
  if (link) link.unlinked_at = nowIso();
  reportEvent(ctx.db, ctx.orgId, dup.id, "unmerged", { actor_name: ctx.user.name, note: `Split from ${primary.reference_code}` });
  audit(ctx, "report.unmerged", "report", dup.id, `Undid merge of ${dup.reference_code}`);
  emitReport(ctx, dup);
  emitReport(ctx, primary);
  return serializeReport(ctx.db, dup);
}

export function archiveReport(ctx: Ctx, id: ID, reason: string) {
  requireRole(ctx, ["admin", "dispatcher"]);
  if (!reason?.trim()) throw new HttpError(422, "ARCHIVE_REASON_REQUIRED");
  const r = getReport(ctx, id);
  r.archived_at = nowIso();
  r.archive_reason = reason;
  reportEvent(ctx.db, ctx.orgId, r.id, "archived", { actor_name: ctx.user.name, note: reason });
  audit(ctx, "report.archived", "report", r.id, `Archived ${r.reference_code}: ${reason}`);
  emitReport(ctx, r);
  return serializeReport(ctx.db, r);
}

export function restoreReport(ctx: Ctx, id: ID) {
  requireRole(ctx, ["admin"]);
  const r = getReport(ctx, id);
  r.archived_at = undefined;
  r.archive_reason = undefined;
  reportEvent(ctx.db, ctx.orgId, r.id, "restored", { actor_name: ctx.user.name });
  audit(ctx, "report.restored", "report", r.id, `Restored ${r.reference_code}`);
  emitReport(ctx, r);
  return serializeReport(ctx.db, r);
}

export function closeReport(ctx: Ctx, id: ID) {
  requireRole(ctx, ["admin", "dispatcher"]);
  const r = getReport(ctx, id);
  if (r.status !== "resolved") throw new HttpError(409, "INVALID_TRANSITION", "Only resolved reports can be closed");
  r.status = "closed";
  reportEvent(ctx.db, ctx.orgId, r.id, "closed", { actor_name: ctx.user.name, from_status: "resolved", to_status: "closed" });
  audit(ctx, "report.closed", "report", r.id, `Closed ${r.reference_code}`);
  emitReport(ctx, r);
  return serializeReport(ctx.db, r);
}

export function canSeeContact(ctx: Ctx, r: ReportRec) {
  if (ctx.user.role === "admin" || ctx.user.role === "dispatcher") return true;
  if (ctx.user.role === "responder" && ctx.user.team_id) {
    return ctx.db.tasks.some((t) => t.report_id === r.id && t.assigned_team_id === ctx.user.team_id && ACTIVE_TASK_STATUSES.includes(t.status));
  }
  return false;
}

export function readContact(ctx: Ctx, id: ID) {
  const r = getReport(ctx, id);
  if (!canSeeContact(ctx, r)) throw new HttpError(403, "PII_FORBIDDEN", "You can't view reporter contact details");
  audit(ctx, "pii.viewed", "report", r.id, `Viewed reporter contact for ${r.reference_code}`);
  return r.contact ?? {};
}

/** After triage, report status follows its tasks (§4.2). */
function syncReportStatus(ctx: Ctx, reportId: ID) {
  const r = ctx.db.reports.find((x) => x.id === reportId)!;
  if (r.status === "new" || r.status === "closed") return;
  const tasks = ctx.db.tasks.filter((t) => t.report_id === r.id);
  const open = tasks.filter((t) => ACTIVE_TASK_STATUSES.includes(t.status));
  let next: ReportStatus = r.status;
  if (open.some((t) => t.status === "en_route" || t.status === "on_site")) next = "in_progress";
  else if (open.some((t) => t.assigned_team_id)) next = r.status === "in_progress" ? "in_progress" : "assigned";
  else if (open.length === 0 && tasks.some((t) => t.status === "completed")) next = "resolved";
  else next = "triaged";
  if (next !== r.status) {
    reportEvent(ctx.db, ctx.orgId, r.id, "status_changed", { from_status: r.status, to_status: next });
    r.status = next;
    if (next === "resolved") r.resolved_at = nowIso();
    emitReport(ctx, r);
  }
}

// ---------- dispatch: suggestions (§6.2) ----------

export function suggestTeams(ctx: Ctx, reportId: ID, caps?: string[]): TeamSuggestion[] {
  const r = getReport(ctx, reportId);
  const required = caps ?? requiredCapabilities(ctx.db, ctx.orgId, r.category, r.priority);
  const fresh = staleWindowS(ctx.db, ctx.orgId);
  const rows = ctx.db.teams
    .filter((t) => t.organization_id === ctx.orgId)
    .map((t) => {
      const st = serializeTeam(ctx.db, t);
      const pos = t.last_location ?? t.home_base;
      const reasons: string[] = [];
      if (st.availability === "off_duty") reasons.push("off_duty");
      else if (st.availability === "busy") reasons.push("busy");
      const age = ageS(t.last_location_at);
      if (age > fresh) reasons.push(`stale:${Math.round(age / 60)}m`);
      const capRows = required.map((key) => ({ key, ok: st.capabilities.includes(key) }));
      for (const c of capRows) if (!c.ok) reasons.push(`missing:${c.key}`);
      const holdsCritical = ctx.db.tasks.some((x) => x.assigned_team_id === t.id && ACTIVE_TASK_STATUSES.includes(x.status) && ctx.db.reports.find((rr) => rr.id === x.report_id)?.priority === "critical");
      if (holdsCritical && !reasons.includes("busy")) reasons.push("holding_critical");
      return {
        team_id: t.id,
        team_name: t.name,
        distance_km: round(distanceKm(pos, r.location)),
        eligible: reasons.length === 0,
        reasons,
        capabilities: capRows,
        last_seen_s: Number.isFinite(age) ? Math.round(age) : undefined,
        availability: st.availability,
        _load: t.tasks_completed_today,
      };
    });
  const byDist = (a: (typeof rows)[number], b: (typeof rows)[number]) => a.distance_km - b.distance_km || a._load - b._load;
  const eligible = rows.filter((x) => x.eligible).sort(byDist).slice(0, 5);
  const ineligible = rows.filter((x) => !x.eligible).sort(byDist).slice(0, 5);
  return [...eligible, ...ineligible].map(({ _load, ...x }) => (void _load, x));
}

// ---------- resources (§7) — all checks happen before any write, so each call is all-or-nothing ----------

function reserveResource(ctx: Ctx, task: TaskRec, resourceId: ID, qty = 1) {
  const res = getResource(ctx, resourceId);
  if (res.kind === "unit") {
    if (res.status !== "available") throw new HttpError(409, "RESOURCE_UNAVAILABLE", `${res.name} is ${res.status}`, { resource_id: res.id, status: res.status });
    res.status = "reserved";
    qty = 1;
  } else {
    const available = (res.on_hand ?? 0) - (res.reserved ?? 0);
    if (qty <= 0 || qty > available) throw new HttpError(409, "INSUFFICIENT_STOCK", `Only ${available} ${res.unit_label} available`, { available });
    res.reserved = (res.reserved ?? 0) + qty;
  }
  const a = {
    id: newId("asg"),
    organization_id: ctx.orgId,
    resource_id: res.id,
    resource_name: res.name,
    resource_type: res.type,
    kind: res.kind,
    task_id: task.id,
    qty,
    state: "reserved" as const,
    reserved_at: nowIso(),
  };
  ctx.db.assignments.push(a);
  taskEvent(ctx.db, ctx.orgId, task, "resource_reserved", undefined, undefined, ctx.user.name, `${res.name}${res.kind === "stock" ? ` × ${qty}` : ""}`);
  publish(ctx.db, ctx.orgId, "resource.changed", res.id, serializeResource(ctx.db, res), { roles: ["admin", "dispatcher", "volunteer_coordinator"] });
  return a;
}

function checkReservable(ctx: Ctx, items: { resource_id: ID; qty?: number }[]) {
  for (const it of items) {
    const res = getResource(ctx, it.resource_id);
    if (res.kind === "unit" && res.status !== "available") throw new HttpError(409, "RESOURCE_UNAVAILABLE", `${res.name} is ${res.status}`);
    if (res.kind === "stock") {
      const available = (res.on_hand ?? 0) - (res.reserved ?? 0);
      if (!it.qty || it.qty > available) throw new HttpError(409, "INSUFFICIENT_STOCK", `Only ${available} ${res.unit_label} of ${res.name} available`);
    }
  }
}

function deployResources(ctx: Ctx, task: TaskRec) {
  for (const a of ctx.db.assignments.filter((x) => x.task_id === task.id && x.state === "reserved")) {
    const res = ctx.db.resources.find((r) => r.id === a.resource_id)!;
    a.state = "deployed";
    a.deployed_at = nowIso();
    if (res.kind === "unit") res.status = "deployed";
    publish(ctx.db, ctx.orgId, "resource.changed", res.id, serializeResource(ctx.db, res), { roles: ["admin", "dispatcher", "volunteer_coordinator"] });
  }
}

function releaseAssignment(ctx: Ctx, a: DB["assignments"][number], consumedQty?: number) {
  const res = ctx.db.resources.find((r) => r.id === a.resource_id)!;
  if (res.kind === "unit") {
    res.status = "available";
    a.state = "returned";
  } else {
    res.reserved = Math.max(0, (res.reserved ?? 0) - a.qty);
    const used = Math.min(consumedQty ?? 0, a.qty);
    if (used > 0) {
      res.on_hand = (res.on_hand ?? 0) - used;
      a.state = "consumed";
      a.qty = used;
      if (res.low_stock_threshold && res.on_hand < res.low_stock_threshold) {
        notify(ctx.db, ctx.orgId, usersWithRole(ctx.db, ctx.orgId, ["volunteer_coordinator", "admin"]), {
          type: "stock.low",
          title: `Low stock: ${res.name}`,
          body: `${res.on_hand} ${res.unit_label} left`,
          link: "/resources",
        });
      }
    } else a.state = "returned";
  }
  a.released_at = nowIso();
  publish(ctx.db, ctx.orgId, "resource.changed", res.id, serializeResource(ctx.db, res), { roles: ["admin", "dispatcher", "volunteer_coordinator"] });
}

function releaseAll(ctx: Ctx, task: TaskRec, consumed?: Record<ID, number>) {
  for (const a of ctx.db.assignments.filter((x) => x.task_id === task.id && !x.released_at)) releaseAssignment(ctx, a, consumed?.[a.resource_id]);
}

export function reserveForTask(ctx: Ctx, taskId: ID, resourceId: ID, qty?: number) {
  requireRole(ctx, ["admin", "dispatcher"]);
  const t = getTask(ctx, taskId);
  if (!ACTIVE_TASK_STATUSES.includes(t.status)) throw new HttpError(409, "INVALID_TRANSITION", "Task is closed");
  const a = reserveResource(ctx, t, resourceId, qty);
  if (t.status === "accepted" || t.status === "en_route" || t.status === "on_site") deployResources(ctx, t);
  audit(ctx, "resource.reserved", "task", t.id, `Reserved ${a.resource_name} for task`);
  emitTask(ctx, t);
  return serializeTask(ctx.db, t);
}

export function releaseFromTask(ctx: Ctx, taskId: ID, assignmentId: ID) {
  requireRole(ctx, ["admin", "dispatcher"]);
  const t = getTask(ctx, taskId);
  const a = ctx.db.assignments.find((x) => x.id === assignmentId && x.task_id === t.id && !x.released_at);
  if (!a) throw new HttpError(404, "NOT_FOUND");
  releaseAssignment(ctx, a);
  taskEvent(ctx.db, ctx.orgId, t, "resource_released", undefined, undefined, ctx.user.name, a.resource_name);
  audit(ctx, "resource.released", "task", t.id, `Released ${a.resource_name}`);
  emitTask(ctx, t);
  return serializeTask(ctx.db, t);
}

export function setUnitAvailability(ctx: Ctx, id: ID, available: boolean, reason?: string) {
  requireRole(ctx, ["admin", "volunteer_coordinator"]);
  const res = getResource(ctx, id);
  if (res.kind !== "unit") throw new HttpError(409, "NOT_A_UNIT");
  if (!available) {
    if (res.status !== "available") throw new HttpError(409, "INVALID_TRANSITION", `Can't mark a ${res.status} unit unavailable`);
    if (!reason?.trim()) throw new HttpError(422, "REASON_REQUIRED");
    res.status = "unavailable";
    res.unavailable_reason = reason;
  } else {
    if (res.status !== "unavailable") throw new HttpError(409, "INVALID_TRANSITION");
    res.status = "available";
    res.unavailable_reason = undefined;
  }
  audit(ctx, available ? "resource.available" : "resource.unavailable", "resource", res.id, `${res.name} → ${res.status}${reason ? ` (${reason})` : ""}`);
  publish(ctx.db, ctx.orgId, "resource.changed", res.id, serializeResource(ctx.db, res), { roles: ["admin", "dispatcher", "volunteer_coordinator"] });
  return serializeResource(ctx.db, res);
}

export function adjustStock(ctx: Ctx, id: ID, delta: number, reason: string) {
  requireRole(ctx, ["admin", "volunteer_coordinator"]);
  const res = getResource(ctx, id);
  if (res.kind !== "stock") throw new HttpError(409, "NOT_STOCK");
  if (!reason?.trim()) throw new HttpError(422, "REASON_REQUIRED");
  const next = (res.on_hand ?? 0) + delta;
  if (next < 0 || next < (res.reserved ?? 0)) throw new HttpError(409, "STOCK_CONSTRAINT", "On hand can't drop below reserved or zero");
  const before = res.on_hand;
  res.on_hand = next;
  audit(ctx, "stock.adjusted", "resource", res.id, `${res.name}: ${delta > 0 ? "+" : ""}${delta} (${reason})`, { on_hand: before }, { on_hand: next });
  publish(ctx.db, ctx.orgId, "resource.changed", res.id, serializeResource(ctx.db, res), { roles: ["admin", "dispatcher", "volunteer_coordinator"] });
  return serializeResource(ctx.db, res);
}

// ---------- tasks (§4.2, §5.4) ----------

function emitTask(ctx: Ctx, t: TaskRec, type: EventType = "task.status_changed", extra: Record<string, unknown> = {}) {
  const team = ctx.db.teams.find((x) => x.id === t.assigned_team_id);
  publish(ctx.db, ctx.orgId, type, t.id, { ...serializeTask(ctx.db, t), ...extra }, {
    roles: ["admin", "dispatcher", "viewer", "volunteer_coordinator"],
    userIds: team?.members.map((m) => m.user_id),
  });
}

function emitTeam(ctx: Ctx | { db: DB; orgId: ID }, team: TeamRec, type: EventType = "team.availability_changed") {
  publish(ctx.db, ctx.orgId, type, team.id, serializeTeam(ctx.db, team), {
    roles: ["admin", "dispatcher", "viewer", "volunteer_coordinator"],
    userIds: team.members.map((m) => m.user_id),
  });
}

function acceptDeadline(ctx: Ctx, priority: Priority) {
  const p = ctx.db.policies[ctx.orgId].find((x) => x.priority === priority);
  return p ? new Date(Date.now() + p.accept_timeout_s * 1000).toISOString() : undefined;
}

function assignTeam(ctx: Ctx, task: TaskRec, report: ReportRec, teamId: ID, override?: { reason?: string; note?: string }) {
  const team = getTeam(ctx, teamId);
  const s = suggestTeams(ctx, report.id, task.required_capabilities).find((x) => x.team_id === team.id)
    ?? { eligible: false, reasons: ["busy"] };
  if (!s.eligible) {
    if (ctx.user.role !== "admin" || !override?.reason)
      throw new HttpError(409, "TEAM_INELIGIBLE", "Team is not eligible", { reasons: s.reasons });
    task.override_by = ctx.user.name;
    task.override_reason = `${override.reason}${override.note ? `: ${override.note}` : ""}`;
    taskEvent(ctx.db, ctx.orgId, task, "override", undefined, undefined, ctx.user.name, `${s.reasons.join(", ")} — ${task.override_reason}`);
    audit(ctx, "task.override", "task", task.id, `Override: assigned ${team.name} (${s.reasons.join(", ")})`);
  }
  task.assigned_team_id = team.id;
  task.assigned_at = nowIso();
  task.decline_reason = undefined;
  task.escalation_level = 0;
  task.escalation_deadline = acceptDeadline(ctx, report.priority);
  team.availability = "busy";
  taskEvent(ctx.db, ctx.orgId, task, "assigned", undefined, "pending", ctx.user.name, `Assigned to ${team.name}`);
  emitTeam(ctx, team);
  notify(ctx.db, ctx.orgId, team.members.filter((m) => m.on_duty).map((m) => m.user_id), {
    type: "task.assigned",
    title: `New ${report.priority} task: ${report.title}`,
    body: report.address_text,
    link: `/responder`,
    priority: report.priority === "critical" ? "high" : "normal",
  });
}

export function createTask(ctx: Ctx, input: CreateTaskInput) {
  requireRole(ctx, ["admin", "dispatcher"]);
  const report = getReport(ctx, input.report_id);
  if (report.status === "new") throw new HttpError(409, "NOT_TRIAGED", "Triage the report first");
  if (["resolved", "closed"].includes(report.status) || report.merged_into_id) throw new HttpError(409, "INVALID_TRANSITION");
  checkReservable(ctx, input.resources);
  const team = getTeam(ctx, input.team_id);
  void team;
  const t: TaskRec = {
    id: newId("tsk"),
    organization_id: ctx.orgId,
    report_id: report.id,
    incident_id: report.incident_id,
    status: "pending",
    required_capabilities: input.required_capabilities,
    instructions: input.instructions,
    target_shelter_id: input.target_shelter_id,
    created_at: nowIso(),
    escalation_level: 0,
    trail: [],
  };
  // Eligibility is checked inside assignTeam before anything is written.
  ctx.db.tasks.push(t);
  try {
    assignTeam(ctx, t, report, input.team_id, { reason: input.override_reason, note: input.override_note });
  } catch (e) {
    ctx.db.tasks.splice(ctx.db.tasks.indexOf(t), 1);
    throw e;
  }
  for (const it of input.resources) reserveResource(ctx, t, it.resource_id, it.qty);
  audit(ctx, "task.created", "task", t.id, `Task for ${report.reference_code} → ${ctx.db.teams.find((x) => x.id === t.assigned_team_id)?.name}`);
  emitTask(ctx, t, "task.assigned");
  syncReportStatus(ctx, report.id);
  return serializeTask(ctx.db, t);
}

export function reassignTask(ctx: Ctx, taskId: ID, teamId: ID, override?: { reason?: string; note?: string }) {
  requireRole(ctx, ["admin", "dispatcher"]);
  const t = getTask(ctx, taskId);
  if (t.status !== "pending" || t.assigned_team_id) throw new HttpError(409, "ALREADY_ASSIGNED", "Task already has a team", { current: serializeTask(ctx.db, t) });
  const report = getReport(ctx, t.report_id);
  assignTeam(ctx, t, report, teamId, override);
  emitTask(ctx, t, "task.assigned");
  syncReportStatus(ctx, report.id);
  return serializeTask(ctx.db, t);
}

const TRANSITIONS: Record<string, { from: TaskStatus[]; to: TaskStatus }> = {
  accept: { from: ["pending"], to: "accepted" },
  en_route: { from: ["accepted"], to: "en_route" },
  on_site: { from: ["en_route"], to: "on_site" },
  complete: { from: ["on_site", "en_route", "accepted"], to: "completed" },
  cancel: { from: ["pending", "accepted", "en_route", "on_site"], to: "cancelled" },
};

function canActOnTask(ctx: Ctx, t: TaskRec, action: string) {
  if (ctx.user.role === "responder") {
    if (t.assigned_team_id !== ctx.user.team_id) throw new HttpError(404, "NOT_FOUND", "Task not found");
    if (action === "cancel") throw new HttpError(403, "FORBIDDEN");
    return;
  }
  if (action === "complete" || action === "cancel") return requireRole(ctx, ["admin", "dispatcher"]);
  // Accept/decline/progress on behalf of a team is an override (permission matrix).
  requireRole(ctx, ["admin", "dispatcher"]);
}

function freeTeamIfIdle(ctx: Ctx, teamId?: ID) {
  const team = ctx.db.teams.find((x) => x.id === teamId);
  if (!team) return;
  const stillBusy = ctx.db.tasks.some((x) => x.assigned_team_id === team.id && ACTIVE_TASK_STATUSES.includes(x.status));
  if (!stillBusy && team.availability === "busy") {
    team.availability = "available";
    team.stale_level = 0;
    emitTeam(ctx, team);
  }
}

export function transitionTask(
  ctx: Ctx,
  taskId: ID,
  action: keyof typeof TRANSITIONS,
  b: { reason?: string; resolution_note?: string; outcome?: Outcome; people_helped?: number; consumed?: Record<ID, number> } = {},
) {
  const t = getTask(ctx, taskId);
  canActOnTask(ctx, t, action);
  const rule = TRANSITIONS[action];
  if (!rule.from.includes(t.status) || (action !== "cancel" && !t.assigned_team_id))
    throw new HttpError(409, "INVALID_TRANSITION", `Can't ${action.replace("_", " ")} a ${t.status} task`, { current: serializeTask(ctx.db, t) });
  if (action === "complete") {
    if (!b.resolution_note || b.resolution_note.trim().length < 10)
      throw new HttpError(422, "RESOLUTION_NOTE_REQUIRED", "Add a resolution note of at least 10 characters");
    if (!b.outcome) throw new HttpError(422, "OUTCOME_REQUIRED", "Pick an outcome");
  }
  if (action === "cancel" && !b.reason?.trim()) throw new HttpError(422, "REASON_REQUIRED");
  const from = t.status;
  const at = nowIso();
  t.status = rule.to;
  const team = ctx.db.teams.find((x) => x.id === t.assigned_team_id);
  if (action === "accept") {
    t.accepted_at = at;
    t.escalation_deadline = undefined;
    t.escalation_level = 0;
    deployResources(ctx, t);
  } else if (action === "en_route") {
    t.en_route_at = at;
    deployResources(ctx, t);
    if (team?.last_location) t.trail.push(team.last_location);
  } else if (action === "on_site") t.on_site_at = at;
  else if (action === "complete") {
    t.completed_at = at;
    t.resolution_note = b.resolution_note;
    t.outcome = b.outcome;
    t.people_helped = b.people_helped;
    releaseAll(ctx, t, b.consumed);
    if (team) team.tasks_completed_today += 1;
  } else if (action === "cancel") {
    t.cancelled_at = at;
    t.escalation_deadline = undefined;
    releaseAll(ctx, t);
  }
  const note = action === "complete" ? `${b.outcome?.replaceAll("_", " ")} — ${b.resolution_note}` : b.reason;
  taskEvent(ctx.db, ctx.orgId, t, "status_changed", from, t.status, ctx.user.name, note, team?.last_location);
  audit(ctx, `task.${action}`, "task", t.id, `Task ${from} → ${t.status}${ctx.user.role !== "responder" && ["accept", "en_route", "on_site"].includes(action) ? " (on behalf of team)" : ""}`);
  if (action === "complete" || action === "cancel") freeTeamIfIdle(ctx, t.assigned_team_id);
  emitTask(ctx, t);
  syncReportStatus(ctx, t.report_id);
  return serializeTask(ctx.db, t);
}

export function declineTask(ctx: Ctx, taskId: ID, reason: string) {
  const t = getTask(ctx, taskId);
  canActOnTask(ctx, t, "decline");
  if (t.status !== "pending" || !t.assigned_team_id) throw new HttpError(409, "INVALID_TRANSITION");
  if (!reason?.trim()) throw new HttpError(422, "DECLINE_REASON_REQUIRED", "A reason is required to decline");
  const teamId = t.assigned_team_id;
  const team = ctx.db.teams.find((x) => x.id === teamId)!;
  t.assigned_team_id = undefined;
  t.decline_reason = `${team.name}: ${reason}`;
  t.escalation_deadline = undefined;
  taskEvent(ctx.db, ctx.orgId, t, "declined", "pending", "pending", ctx.user.name, reason);
  audit(ctx, "task.declined", "task", t.id, `${team.name} declined: ${reason}`);
  freeTeamIfIdle(ctx, teamId);
  notify(ctx.db, ctx.orgId, usersWithRole(ctx.db, ctx.orgId, ["dispatcher"]), {
    type: "task.declined",
    title: `${team.name} declined a task`,
    body: reason,
    link: `/dispatch?report=${t.report_id}`,
    priority: "high",
  });
  emitTask(ctx, t);
  syncReportStatus(ctx, t.report_id);
  return serializeTask(ctx.db, t);
}

// ---------- override requests (§6.3) ----------

export function requestOverride(ctx: Ctx, input: CreateTaskInput & { note?: string }) {
  requireRole(ctx, ["dispatcher", "admin"]);
  const report = getReport(ctx, input.report_id);
  const team = getTeam(ctx, input.team_id);
  const req = {
    id: newId("ovr"),
    organization_id: ctx.orgId,
    task_id: "",
    team_id: team.id,
    team_name: team.name,
    requested_by: ctx.user.name,
    reason: input.override_reason ?? "other",
    note: input.note,
    created_at: nowIso(),
    expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    status: "pending" as const,
    payload: { ...input, override_note: input.note },
  };
  ctx.db.overrideRequests.unshift(req);
  notify(ctx.db, ctx.orgId, usersWithRole(ctx.db, ctx.orgId, ["admin"]), {
    type: "override.requested",
    title: `Override requested: ${team.name}`,
    body: `${ctx.user.name} wants to assign ${team.name} to ${report.reference_code}. Expires in 5 min.`,
    link: `/dispatch?report=${report.id}&override=${req.id}`,
    priority: "high",
  });
  audit(ctx, "override.requested", "report", report.id, `Override request for ${team.name}`);
  const { payload, organization_id, ...rest } = req;
  void payload;
  void organization_id;
  return rest;
}

export function approveOverride(ctx: Ctx, id: ID) {
  requireRole(ctx, ["admin"]);
  const req = findOr404(ctx.db.overrideRequests, ctx.orgId, id, "Override request");
  if (req.status !== "pending" || Date.parse(req.expires_at) < Date.now()) throw new HttpError(409, "OVERRIDE_EXPIRED");
  const task = createTask(ctx, { ...(req.payload as CreateTaskInput), override_reason: req.reason });
  req.status = "approved";
  req.task_id = task.id;
  return task;
}

// ---------- shelters (§7.3) ----------

export function shelterOccupancy(ctx: Ctx, id: ID, delta: number, overrideReason?: string) {
  requireRole(ctx, ["admin", "volunteer_coordinator"]);
  const s = getShelter(ctx, id);
  if (!Number.isInteger(delta) || delta === 0) throw new HttpError(422, "VALIDATION_ERROR");
  const next = s.occupancy + delta;
  if (next < 0) throw new HttpError(409, "OCCUPANCY_NEGATIVE", "Occupancy can't go below zero");
  if (s.status === "closed" && delta > 0) throw new HttpError(409, "SHELTER_CLOSED");
  if (next > s.capacity && !overrideReason?.trim())
    throw new HttpError(409, "CAPACITY_EXCEEDED", `Only ${s.capacity - s.occupancy} beds free`, { free: s.capacity - s.occupancy });
  s.occupancy = next;
  if (s.status !== "closed") s.status = s.occupancy >= s.capacity ? "full" : "open";
  ctx.db.shelterEvents.push({ id: newId("she"), organization_id: ctx.orgId, shelter_id: s.id, delta, actor_name: ctx.user.name, occurred_at: nowIso() });
  audit(ctx, delta > 0 ? "shelter.check_in" : "shelter.check_out", "shelter", s.id, `${s.name}: ${delta > 0 ? "+" : ""}${delta}${overrideReason ? ` (override: ${overrideReason})` : ""}`);
  publish(ctx.db, ctx.orgId, "shelter.changed", s.id, s, { roles: ["admin", "dispatcher", "viewer", "volunteer_coordinator"] });
  return s;
}

export function updateShelter(ctx: Ctx, id: ID, b: { status?: "open" | "closed"; capacity?: number; contact?: string }) {
  requireRole(ctx, ["admin", "volunteer_coordinator"]);
  const s = getShelter(ctx, id);
  if (b.capacity !== undefined) s.capacity = b.capacity;
  if (b.contact !== undefined) s.contact = b.contact;
  if (b.status === "closed") s.status = "closed";
  else if (b.status === "open" || s.status !== "closed") s.status = s.occupancy >= s.capacity ? "full" : "open";
  audit(ctx, "shelter.updated", "shelter", s.id, `${s.name} updated`);
  publish(ctx.db, ctx.orgId, "shelter.changed", s.id, s, { roles: ["admin", "dispatcher", "viewer", "volunteer_coordinator"] });
  return s;
}

// ---------- location (§5.3) ----------

export function setTeamLocation(db: DB, team: TeamRec, loc: LatLng, at = nowIso()) {
  const wasStale = isStale(db, team);
  team.last_location = loc;
  team.last_location_at = at;
  const task = activeTaskOf(db, team);
  if (task && (task.status === "en_route" || task.status === "on_site")) {
    const last = task.trail[task.trail.length - 1];
    if (!last || distanceKm(last, loc) > 0.01) task.trail.push(loc);
  }
  publish(db, team.organization_id, "team.location_updated", team.id, { team_id: team.id, lat: loc.lat, lng: loc.lng, ts: at }, {
    roles: ["admin", "dispatcher", "viewer", "volunteer_coordinator"],
    userIds: team.members.map((m) => m.user_id),
  });
  if (wasStale) {
    team.stale_level = 0;
    publish(db, team.organization_id, "team.stale", team.id, { ...serializeTeam(db, team), cleared: true }, { roles: ["admin", "dispatcher"] });
  }
}

export function pushLocation(ctx: Ctx, points: { lat: number; lng: number; recorded_at: string }[]) {
  requireRole(ctx, ["responder"]);
  const team = ctx.user.team_id ? getTeam(ctx, ctx.user.team_id) : undefined;
  if (!team || !points.length) return { accepted: 0 };
  const last = points[points.length - 1];
  team.manual_location_until = Date.now() + 2 * 60_000;
  team.silent = false;
  setTeamLocation(ctx.db, team, { lat: last.lat, lng: last.lng });
  return { accepted: points.length };
}

export function setDuty(ctx: Ctx, onDuty: boolean, userId = ctx.user.id) {
  const user = ctx.db.users.find((u) => u.id === userId && u.organization_id === ctx.orgId);
  if (!user) throw new HttpError(404, "NOT_FOUND");
  user.on_duty = onDuty;
  const team = ctx.db.teams.find((t) => t.id === user.team_id);
  const member = team?.members.find((m) => m.user_id === user.id);
  if (team && member) {
    member.on_duty = onDuty;
    emitTeam(ctx, team);
  }
  audit(ctx, "member.duty", "user", user.id, `${user.name} ${onDuty ? "on" : "off"} duty`);
  return user;
}

// ---------- escalation + stale sweep (§6.4, §6.5) — runs every few seconds ----------

export function sweep(db: DB) {
  const now = Date.now();
  for (const org of db.orgs) {
    const sys = { db, orgId: org.id, user: { id: "system", name: "ResQGrid", role: "admin" } as User };
    const policy = (p: Priority) => db.policies[org.id].find((x) => x.priority === p)!;
    const dispatchers = usersWithRole(db, org.id, ["dispatcher"]);
    const admins = usersWithRole(db, org.id, ["admin"]);

    // Critical report still untriaged.
    for (const r of db.reports.filter((x) => x.organization_id === org.id && x.status === "new" && x.priority === "critical" && !x.merged_into_id && !x.archived_at)) {
      const t = policy("critical").untriaged_timeout_s ?? 120;
      const age = (now - Date.parse(r.created_at)) / 1000;
      if (age > t && r.untriaged_level === 0) {
        r.untriaged_level = 1;
        criticalAlert(db, r, true);
      } else if (age > 2 * t && r.untriaged_level === 1) {
        r.untriaged_level = 2;
        notify(db, org.id, admins, { type: "report.untriaged", title: `Critical report untriaged for ${Math.round(age / 60)} min`, body: r.reference_code, link: `/dispatch?report=${r.id}`, priority: "high" });
      }
    }

    for (const t of db.tasks.filter((x) => x.organization_id === org.id)) {
      const r = db.reports.find((x) => x.id === t.report_id)!;
      // Pending task not accepted.
      if (t.status === "pending" && t.assigned_team_id && t.escalation_deadline && (r.priority === "critical" || r.priority === "high")) {
        const over = now - Date.parse(t.escalation_deadline);
        const timeout = policy(r.priority).accept_timeout_s * 1000;
        const mins = Math.round((now - Date.parse(t.assigned_at!)) / 60_000);
        const next = over >= timeout && r.priority === "critical" ? 2 : over >= 0 ? 1 : 0;
        if (next > t.escalation_level) {
          t.escalation_level = next as 1 | 2;
          taskEvent(db, org.id, t, "escalated", undefined, undefined, "ResQGrid", `Level ${next}: not accepted after ${mins} min`);
          emitTask(sys, t, "task.escalated", { level: next, minutes_waiting: mins });
          notify(db, org.id, next === 2 ? [...dispatchers, ...admins] : dispatchers, {
            type: "task.escalated",
            title: `Escalation L${next}: ${r.title}`,
            body: `Not accepted after ${mins} min. Consider the next eligible team.`,
            link: `/dispatch?report=${r.id}`,
            priority: "high",
          });
        }
      }
      // Accepted but not en route.
      if (t.status === "accepted" && !t.en_route_reminded && t.accepted_at && now - Date.parse(t.accepted_at) > policy(r.priority).en_route_timeout_s * 1000) {
        t.en_route_reminded = true;
        const team = db.teams.find((x) => x.id === t.assigned_team_id);
        notify(db, org.id, [...dispatchers, ...(team?.members.map((m) => m.user_id) ?? [])], {
          type: "task.not_en_route",
          title: `${team?.name} accepted but isn't en route`,
          body: r.title,
          link: `/tasks/${t.id}`,
        });
      }
    }

    // Stale location.
    for (const team of db.teams.filter((x) => x.organization_id === org.id)) {
      if (!isStale(db, team)) continue;
      const mins = (now - Date.parse(team.last_location_at!)) / 60_000;
      const level = mins >= 20 ? 3 : mins >= 10 ? 2 : 1;
      if (level <= team.stale_level) continue;
      team.stale_level = level as 1 | 2 | 3;
      emitTeam(sys, team, "team.stale");
      if (level >= 2) {
        notify(db, org.id, [...dispatchers, ...team.members.map((m) => m.user_id)], {
          type: "team.stale",
          title: `${team.name} location is stale`,
          body: `No update for ${Math.round(mins)} min on an active task.`,
          link: "/teams",
          priority: level === 3 ? "high" : "normal",
        });
      }
    }

    for (const req of db.overrideRequests) if (req.status === "pending" && Date.parse(req.expires_at) < now) req.status = "expired";
  }
}

// ---------- analytics (§5.6) ----------

function stats(values: number[]) {
  if (!values.length) return { median_s: null, p90_s: null };
  const s = [...values].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))];
  return { median_s: Math.round(q(0.5)), p90_s: Math.round(q(0.9)) };
}

export function responseTimes(ctx: Ctx, groupBy: "category" | "team" | "priority" | "incident") {
  const groups = new Map<string, { triage: number[]; assign: number[]; accept: number[]; on_site: number[]; resolve: number[]; count: number }>();
  const diff = (a?: string, b?: string) => (a && b ? (Date.parse(b) - Date.parse(a)) / 1000 : undefined);
  for (const r of ctx.db.reports.filter((x) => x.organization_id === ctx.orgId && !x.rejected)) {
    const task = ctx.db.tasks.filter((t) => t.report_id === r.id).sort((a, b) => (a.created_at < b.created_at ? -1 : 1))[0];
    const team = task && ctx.db.teams.find((t) => t.id === task.assigned_team_id);
    const key =
      groupBy === "category" ? r.category
      : groupBy === "priority" ? r.priority
      : groupBy === "team" ? team?.name ?? "Unassigned"
      : ctx.db.incidents.find((i) => i.id === r.incident_id)?.title ?? "No incident";
    const g = groups.get(key) ?? { triage: [], assign: [], accept: [], on_site: [], resolve: [], count: 0 };
    g.count++;
    const push = (arr: number[], v?: number) => v !== undefined && v >= 0 && arr.push(v);
    push(g.triage, diff(r.created_at, r.triaged_at));
    push(g.assign, diff(r.created_at, task?.assigned_at));
    push(g.accept, diff(r.created_at, task?.accepted_at));
    push(g.on_site, diff(r.created_at, task?.on_site_at));
    push(g.resolve, diff(r.created_at, r.resolved_at));
    groups.set(key, g);
  }
  return [...groups.entries()]
    .map(([group, g]) => ({
      group,
      count: g.count,
      triage: stats(g.triage),
      assign: stats(g.assign),
      accept: stats(g.accept),
      on_site: stats(g.on_site),
      resolve: stats(g.resolve),
    }))
    .sort((a, b) => b.count - a.count);
}

export function liveKpis(ctx: Ctx) {
  const reports = ctx.db.reports.filter((r) => r.organization_id === ctx.orgId && !r.archived_at && !r.merged_into_id);
  const open = reports.filter((r) => !["resolved", "closed"].includes(r.status));
  const teams = ctx.db.teams.filter((t) => t.organization_id === ctx.orgId).map((t) => serializeTeam(ctx.db, t));
  const units = ctx.db.resources.filter((r) => r.organization_id === ctx.orgId && r.kind === "unit");
  const shelters = ctx.db.shelters.filter((s) => s.organization_id === ctx.orgId && s.status !== "closed");
  const unassigned = open.filter((r) => (r.status === "new" || r.status === "triaged") && Date.now() - Date.parse(r.created_at) > 5 * 60_000);
  return {
    open_reports: open.length,
    critical_open: open.filter((r) => r.priority === "critical").length,
    unassigned_over_5m: unassigned.length,
    teams: {
      available: teams.filter((t) => t.availability === "available").length,
      busy: teams.filter((t) => t.availability === "busy" && !t.is_stale).length,
      stale: teams.filter((t) => t.is_stale).length,
      off_duty: teams.filter((t) => t.availability === "off_duty").length,
    },
    units: {
      available: units.filter((u) => u.status === "available").length,
      reserved: units.filter((u) => u.status === "reserved").length,
      deployed: units.filter((u) => u.status === "deployed").length,
      unavailable: units.filter((u) => u.status === "unavailable").length,
    },
    shelter_beds_free: shelters.reduce((s, x) => s + Math.max(0, x.capacity - x.occupancy), 0),
    shelter_beds_total: shelters.reduce((s, x) => s + x.capacity, 0),
  };
}

export function teamPerformance(ctx: Ctx) {
  return ctx.db.teams
    .filter((t) => t.organization_id === ctx.orgId)
    .map((team) => {
      const tasks = ctx.db.tasks.filter((t) => t.assigned_team_id === team.id);
      const declines = ctx.db.taskTimeline.filter((e) => e.organization_id === ctx.orgId && e.type === "declined" && e.note && tasks.some((t) => t.id === e.parent_id)).length;
      const onSite = tasks.filter((t) => t.on_site_at && t.assigned_at).map((t) => (Date.parse(t.on_site_at!) - Date.parse(t.assigned_at!)) / 1000);
      return {
        team_id: team.id,
        team_name: team.name,
        tasks_completed: tasks.filter((t) => t.status === "completed").length,
        decline_rate: tasks.length ? declines / (tasks.length + declines) : 0,
        open_tasks: tasks.filter((t) => ACTIVE_TASK_STATUSES.includes(t.status)).length,
        on_site_median_s: stats(onSite).median_s,
      };
    });
}

export function dailyCounts(ctx: Ctx) {
  const days: { date: string; reports: number; resolved: number; critical: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    days.push({ date: key, reports: 0, resolved: 0, critical: 0 });
  }
  for (const r of ctx.db.reports.filter((x) => x.organization_id === ctx.orgId)) {
    const row = days.find((d) => d.date === r.created_at.slice(0, 10));
    if (row) {
      row.reports++;
      if (r.priority === "critical") row.critical++;
    }
    const res = r.resolved_at && days.find((d) => d.date === r.resolved_at!.slice(0, 10));
    if (res) res.resolved++;
  }
  return days;
}
