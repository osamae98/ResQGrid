// HTTP surface of the mock, shaped like PRD §11 (/api/v1, /public/v1).
import {
  ACTIVE_TASK_STATUSES,
  CATEGORIES,
  type Category,
  type CategoryRule,
  type Comment,
  type EscalationPolicy,
  type ID,
  type Report,
  type Role,
  type User,
} from "@resqgrid/api-client";
import { publish } from "./bus";
import { DEFAULT_CATEGORY_RULES, DEFAULT_POLICIES, newId, type DB, type UserRec } from "./db";
import { distanceKm, offset, round } from "./geo";
import * as S from "./services";
import { HttpError, type Ctx } from "./services";
import { getDb, resetDb } from "./state";

export const SESSION_COOKIE = "rq_session";

export interface Req {
  method: string;
  path: string;
  query: URLSearchParams;
  body: Record<string, unknown>;
  ip: string;
  sessionUserId?: string;
}

export interface Res {
  status: number;
  body?: unknown;
  setSession?: string | null;
  csv?: string;
}

type Handler = (ctx: Ctx, p: Record<string, string>, req: Req) => unknown;
type PublicHandler = (db: DB, p: Record<string, string>, req: Req) => unknown;

const routes: { method: string; parts: string[]; handler: Handler | PublicHandler; public?: boolean; raw?: boolean }[] = [];
const on = (method: string, path: string, handler: Handler) => routes.push({ method, parts: path.split("/").filter(Boolean), handler });
const pub = (method: string, path: string, handler: PublicHandler) => routes.push({ method, parts: path.split("/").filter(Boolean), handler, public: true });

const list = (q: URLSearchParams, k: string) => q.get(k)?.split(",").filter(Boolean) ?? [];
const toUser = (u: UserRec): User => {
  const { password, ...rest } = u;
  void password;
  return rest;
};
const me = (db: DB, u: UserRec) => ({ user: toUser(u), organization: db.orgs.find((o) => o.id === u.organization_id)! });
const tenant = <T extends { organization_id: ID }>(rows: T[], ctx: Ctx) => rows.filter((r) => r.organization_id === ctx.orgId);
const strip = <T extends { organization_id: ID }>(r: T) => {
  const { organization_id, ...rest } = r;
  void organization_id;
  return rest;
};

// ---------- auth ----------

pub("POST", "/api/v1/auth/login", (db, _p, req) => {
  const email = String(req.body.email ?? "").toLowerCase().trim();
  const u = db.users.find((x) => x.email === email);
  if (!u || u.password !== req.body.password) throw new HttpError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
  if (!u.is_active) throw new HttpError(403, "USER_DEACTIVATED", "This account has been deactivated");
  return { __session: u.id, body: me(db, u) };
});

pub("POST", "/api/v1/auth/logout", () => ({ __session: null, body: undefined }));

pub("GET", "/api/v1/auth/demo-users", (db) =>
  db.orgs.map((o) => ({
    org: o.name,
    users: (["admin", "dispatcher", "responder", "volunteer_coordinator", "viewer"] as Role[])
      .map((role) => db.users.find((u) => u.organization_id === o.id && u.role === role && (role !== "responder" || u.email.startsWith("responder@"))))
      .filter(Boolean)
      .map((u) => ({ email: u!.email, name: u!.name, role: u!.role })),
  })),
);

pub("POST", "/api/v1/auth/register-org", (db, _p, req) => {
  const b = req.body as Record<string, string>;
  if (!b.org_name || !b.slug || !b.email || !b.password || !b.admin_name) throw new HttpError(422, "VALIDATION_ERROR", "All fields are required");
  if (db.orgs.some((o) => o.slug === b.slug)) throw new HttpError(409, "SLUG_TAKEN", "That link is already taken");
  if (db.users.some((u) => u.email === b.email.toLowerCase())) throw new HttpError(409, "EMAIL_TAKEN", "An account with this email exists");
  const org = {
    id: newId("org"),
    name: b.org_name,
    slug: b.slug,
    timezone: b.timezone || "Africa/Cairo",
    operating_area: { center: { lat: 30.0561, lng: 31.3301 }, radius_km: 10 },
  };
  db.orgs.push(org);
  db.categoryRules[org.id] = structuredClone(DEFAULT_CATEGORY_RULES);
  db.policies[org.id] = structuredClone(DEFAULT_POLICIES);
  for (const c of db.capabilities.filter((x) => x.organization_id === "org_cairo"))
    db.capabilities.push({ ...c, id: newId("cap"), organization_id: org.id });
  const u: UserRec = { id: newId("usr"), email: b.email.toLowerCase(), name: b.admin_name, role: "admin", organization_id: org.id, is_active: true, password: b.password };
  db.users.push(u);
  return { __session: u.id, body: me(db, u) };
});

on("GET", "/api/v1/me", (ctx) => me(ctx.db, ctx.db.users.find((u) => u.id === ctx.user.id)!));
on("POST", "/api/v1/me/duty", (ctx, _p, req) => S.setDuty(ctx, !!req.body.on_duty));
on("POST", "/api/v1/me/location", (ctx, _p, req) => S.pushLocation(ctx, (req.body.points as never[]) ?? []));

// ---------- org and users ----------

on("GET", "/api/v1/org", (ctx) => ctx.db.orgs.find((o) => o.id === ctx.orgId));
on("PATCH", "/api/v1/org", (ctx, _p, req) => {
  S.requireRole(ctx, ["admin"]);
  const org = ctx.db.orgs.find((o) => o.id === ctx.orgId)!;
  const { name, timezone, operating_area } = req.body as Partial<typeof org>;
  Object.assign(org, JSON.parse(JSON.stringify({ name, timezone, operating_area })));
  S.audit(ctx, "org.updated", "organization", org.id, "Updated organisation settings");
  return org;
});
on("GET", "/api/v1/users", (ctx) => {
  S.requireRole(ctx, ["admin", "volunteer_coordinator"]);
  return tenant(ctx.db.users, ctx).map(toUser);
});
on("PATCH", "/api/v1/users/:id", (ctx, p, req) => {
  S.requireRole(ctx, ["admin"]);
  const u = ctx.db.users.find((x) => x.id === p.id && x.organization_id === ctx.orgId);
  if (!u) throw new HttpError(404, "NOT_FOUND");
  if (typeof req.body.is_active === "boolean") u.is_active = req.body.is_active;
  if (typeof req.body.role === "string") u.role = req.body.role as Role;
  S.audit(ctx, "user.updated", "user", u.id, `${u.name}: ${u.is_active ? "active" : "deactivated"}, role ${u.role}`);
  return toUser(u);
});
on("POST", "/api/v1/invitations", (ctx, _p, req) => {
  S.requireRole(ctx, ["admin"]);
  const expires_at = new Date(Date.now() + 72 * 3600_000).toISOString();
  S.audit(ctx, "invitation.created", "invitation", "-", `Invited ${req.body.email} as ${req.body.role}`);
  return { id: newId("inv"), expires_at };
});

// ---------- public intake ----------

pub("GET", "/public/v1/:slug/intake", (db, p) => {
  const org = db.orgs.find((o) => o.slug === p.slug);
  if (!org) throw new HttpError(404, "NOT_FOUND", "Unknown organisation");
  const incident = db.incidents.find((i) => i.organization_id === org.id && i.status === "active");
  return { organization: { name: org.name, slug: org.slug, operating_area: org.operating_area }, categories: CATEGORIES, incident: incident && { id: incident.id, title: incident.title } };
});
pub("POST", "/public/v1/:slug/reports", (db, p, req) => ({ status: 201, body: S.createPublicReport(db, p.slug, req.body as never, req.ip) }));
pub("GET", "/public/v1/reports/:ref", (db, p) => {
  const r = db.reports.find((x) => x.reference_code === p.ref.toUpperCase());
  if (!r) throw new HttpError(404, "NOT_FOUND", "No report with that reference");
  // Status and last update only (§8.4).
  return { reference_code: r.reference_code, status: r.status, updated_at: r.updated_at };
});

// ---------- reports ----------

function visibleReports(ctx: Ctx) {
  const all = tenant(ctx.db.reports, ctx);
  if (ctx.user.role !== "responder") return all;
  // Responders: reports of their team's tasks + open reports within 3 km.
  const team = ctx.db.teams.find((t) => t.id === ctx.user.team_id);
  const mine = new Set(ctx.db.tasks.filter((t) => t.assigned_team_id === team?.id).map((t) => t.report_id));
  return all.filter((r) => mine.has(r.id) || (team?.last_location && !["resolved", "closed"].includes(r.status) && distanceKm(r.location, team.last_location) < 3));
}

on("GET", "/api/v1/reports", (ctx, _p, req) => {
  const q = req.query;
  const status = list(q, "status");
  const priority = list(q, "priority");
  const category = list(q, "category");
  const text = q.get("q")?.toLowerCase();
  const includeArchived = q.get("include_archived") === "true";
  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  let rows = visibleReports(ctx).filter(
    (r) =>
      (includeArchived || !r.archived_at) &&
      (!status.length || status.includes(r.status)) &&
      (!priority.length || priority.includes(r.priority)) &&
      (!category.length || category.includes(r.category)) &&
      (!q.get("incident_id") || r.incident_id === q.get("incident_id")) &&
      (!text || `${r.reference_code} ${r.title} ${r.description} ${r.address_text}`.toLowerCase().includes(text)),
  );
  // Critical first, then age (§13.1).
  rows = rows.sort((a, b) => order[a.priority] - order[b.priority] || (a.created_at < b.created_at ? -1 : 1));
  if (q.get("sort") === "-created_at") rows = rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const page = Number(q.get("page") ?? 1);
  const size = Math.min(100, Number(q.get("page_size") ?? 100));
  return { items: rows.slice((page - 1) * size, page * size).map((r) => S.serializeReport(ctx.db, r)), total: rows.length, page, page_size: size };
});
on("POST", "/api/v1/reports", (ctx, _p, req) => ({ status: 201, body: S.createReport(ctx, req.body as never) }));
on("GET", "/api/v1/reports/:id", (ctx, p) => {
  const r = visibleReports(ctx).find((x) => x.id === p.id);
  if (!r) throw new HttpError(404, "NOT_FOUND", "Report not found");
  return S.serializeReport(ctx.db, r);
});
on("PATCH", "/api/v1/reports/:id", (ctx, p, req) => S.updateReport(ctx, p.id, req.body as Partial<Report>));
on("POST", "/api/v1/reports/:id/triage", (ctx, p, req) => S.triage(ctx, p.id, req.body as never));
on("POST", "/api/v1/reports/:id/merge", (ctx, p, req) => S.mergeReport(ctx, p.id, String(req.body.primary_id)));
on("POST", "/api/v1/reports/:id/unmerge", (ctx, p) => S.unmergeReport(ctx, p.id));
on("POST", "/api/v1/reports/:id/archive", (ctx, p, req) => S.archiveReport(ctx, p.id, String(req.body.reason ?? "")));
on("POST", "/api/v1/reports/:id/restore", (ctx, p) => S.restoreReport(ctx, p.id));
on("POST", "/api/v1/reports/:id/close", (ctx, p) => S.closeReport(ctx, p.id));
on("GET", "/api/v1/reports/:id/contact", (ctx, p) => S.readContact(ctx, p.id));
on("GET", "/api/v1/reports/:id/timeline", (ctx, p) => {
  S.getReport(ctx, p.id);
  return ctx.db.reportTimeline.filter((e) => e.parent_id === p.id && e.organization_id === ctx.orgId).map(strip).sort((a, b) => (a.occurred_at < b.occurred_at ? -1 : 1));
});
on("GET", "/api/v1/reports/:id/duplicates", (ctx, p) => {
  const r = S.serializeReport(ctx.db, S.getReport(ctx, p.id));
  const ids = new Set([...r.possible_duplicate_ids, ...r.merged_ids]);
  return tenant(ctx.db.reports, ctx).filter((x) => ids.has(x.id)).map((x) => S.serializeReport(ctx.db, x));
});
on("GET", "/api/v1/reports/:id/suggested-teams", (ctx, p, req) => {
  S.requireRole(ctx, ["admin", "dispatcher"]);
  const caps = req.query.get("capabilities");
  return S.suggestTeams(ctx, p.id, caps === null ? undefined : caps.split(",").filter(Boolean));
});

// ---------- incidents ----------

const withStats = (ctx: Ctx, i: DB["incidents"][number]) => ({
  ...strip(i),
  stats: {
    open_reports: ctx.db.reports.filter((r) => r.incident_id === i.id && !["resolved", "closed"].includes(r.status) && !r.archived_at && !r.merged_into_id).length,
    active_tasks: ctx.db.tasks.filter((t) => t.incident_id === i.id && ACTIVE_TASK_STATUSES.includes(t.status)).length,
    resources_deployed: ctx.db.resources.filter((r) => r.incident_id === i.id && r.status === "deployed").length,
  },
});
on("GET", "/api/v1/incidents", (ctx) => tenant(ctx.db.incidents, ctx).map((i) => withStats(ctx, i)));
on("GET", "/api/v1/incidents/:id", (ctx, p) => {
  const i = tenant(ctx.db.incidents, ctx).find((x) => x.id === p.id);
  if (!i) throw new HttpError(404, "NOT_FOUND");
  return withStats(ctx, i);
});
on("POST", "/api/v1/incidents", (ctx, _p, req) => {
  S.requireRole(ctx, ["admin", "dispatcher"]);
  const b = req.body as { title: string; type: string; center: { lat: number; lng: number }; radius_km: number };
  if (!b.title?.trim()) throw new HttpError(422, "VALIDATION_ERROR", "Title is required");
  const i = { id: newId("inc"), organization_id: ctx.orgId, title: b.title, type: b.type || "other", status: "active" as const, center: b.center, radius_km: b.radius_km || 2, commander_id: ctx.user.id, commander_name: ctx.user.name, created_at: new Date().toISOString() };
  ctx.db.incidents.push(i);
  S.audit(ctx, "incident.created", "incident", i.id, `Created incident ${i.title}`);
  return { status: 201, body: withStats(ctx, i) };
});
on("PATCH", "/api/v1/incidents/:id", (ctx, p, req) => {
  S.requireRole(ctx, ["admin", "dispatcher"]);
  const i = tenant(ctx.db.incidents, ctx).find((x) => x.id === p.id);
  if (!i) throw new HttpError(404, "NOT_FOUND");
  const { title, status, radius_km } = req.body as Partial<typeof i>;
  Object.assign(i, JSON.parse(JSON.stringify({ title, status, radius_km })));
  S.audit(ctx, "incident.updated", "incident", i.id, `Updated ${i.title}`);
  return withStats(ctx, i);
});
on("POST", "/api/v1/incidents/:id/close", (ctx, p) => {
  S.requireRole(ctx, ["admin", "dispatcher"]);
  const i = tenant(ctx.db.incidents, ctx).find((x) => x.id === p.id);
  if (!i) throw new HttpError(404, "NOT_FOUND");
  i.status = "closed";
  i.closed_at = new Date().toISOString();
  S.audit(ctx, "incident.closed", "incident", i.id, `Closed ${i.title}`);
  return withStats(ctx, i);
});

// ---------- teams and capabilities ----------

on("GET", "/api/v1/teams", (ctx) => tenant(ctx.db.teams, ctx).map((t) => S.serializeTeam(ctx.db, t)));
on("GET", "/api/v1/teams/locations", (ctx) =>
  tenant(ctx.db.teams, ctx).map((t) => ({ team_id: t.id, location: t.last_location, at: t.last_location_at })),
);
on("POST", "/api/v1/teams", (ctx, _p, req) => {
  S.requireRole(ctx, ["admin", "volunteer_coordinator"]);
  const b = req.body as { name: string; type: DB["teams"][number]["type"]; home_base: { lat: number; lng: number }; is_volunteer?: boolean };
  if (ctx.user.role === "volunteer_coordinator" && !b.is_volunteer) throw new HttpError(403, "FORBIDDEN", "Coordinators manage volunteer teams only");
  const org = ctx.db.orgs.find((o) => o.id === ctx.orgId)!;
  const t = {
    id: newId("team"),
    organization_id: ctx.orgId,
    name: b.name,
    type: b.type,
    is_volunteer: !!b.is_volunteer,
    availability: "off_duty" as const,
    home_base: b.home_base ?? org.operating_area.center,
    members: [],
    tasks_completed_today: 0,
    stale_level: 0 as const,
  };
  ctx.db.teams.push(t);
  S.audit(ctx, "team.created", "team", t.id, `Created team ${t.name}`);
  return { status: 201, body: S.serializeTeam(ctx.db, t) };
});
on("PATCH", "/api/v1/teams/:id/availability", (ctx, p, req) => {
  S.requireRole(ctx, ["admin", "dispatcher", "volunteer_coordinator", "responder"]);
  const t = S.getTeam(ctx, p.id);
  if (ctx.user.role === "responder" && ctx.user.team_id !== t.id) throw new HttpError(404, "NOT_FOUND");
  const before = t.availability;
  t.availability = req.body.availability as typeof t.availability;
  S.audit(ctx, "team.availability", "team", t.id, `${t.name}: ${before} → ${t.availability}`);
  return S.serializeTeam(ctx.db, t);
});
on("PATCH", "/api/v1/teams/:id/members/:userId", (ctx, p, req) => {
  S.requireRole(ctx, ["admin", "volunteer_coordinator", "responder"]);
  S.getTeam(ctx, p.id);
  if (ctx.user.role === "responder" && ctx.user.id !== p.userId) throw new HttpError(403, "FORBIDDEN");
  S.setDuty(ctx, !!req.body.on_duty, p.userId);
  return S.serializeTeam(ctx.db, S.getTeam(ctx, p.id));
});
on("GET", "/api/v1/capabilities", (ctx) => tenant(ctx.db.capabilities, ctx).map(strip));
on("GET", "/api/v1/category-rules", (ctx) => ctx.db.categoryRules[ctx.orgId]);
on("PUT", "/api/v1/category-rules", (ctx, _p, req) => {
  S.requireRole(ctx, ["admin"]);
  ctx.db.categoryRules[ctx.orgId] = req.body as unknown as CategoryRule[];
  S.audit(ctx, "category_rules.updated", "organization", ctx.orgId, "Updated category rules");
  return ctx.db.categoryRules[ctx.orgId];
});

// ---------- tasks ----------

on("GET", "/api/v1/tasks", (ctx, _p, req) => {
  const status = list(req.query, "status");
  let rows = tenant(ctx.db.tasks, ctx).filter((t) => !t.archived_at);
  if (ctx.user.role === "responder" || req.query.get("mine") === "true") rows = rows.filter((t) => t.assigned_team_id === ctx.user.team_id);
  if (status.length) rows = rows.filter((t) => status.includes(t.status));
  if (req.query.get("team_id")) rows = rows.filter((t) => t.assigned_team_id === req.query.get("team_id"));
  if (req.query.get("incident_id")) rows = rows.filter((t) => t.incident_id === req.query.get("incident_id"));
  return rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).map((t) => S.serializeTask(ctx.db, t));
});
on("POST", "/api/v1/tasks", (ctx, _p, req) => ({ status: 201, body: S.createTask(ctx, req.body as never) }));
on("GET", "/api/v1/tasks/:id", (ctx, p) => {
  const t = S.getTask(ctx, p.id);
  if (ctx.user.role === "responder" && t.assigned_team_id !== ctx.user.team_id) throw new HttpError(404, "NOT_FOUND");
  return S.serializeTask(ctx.db, t);
});
on("GET", "/api/v1/tasks/:id/timeline", (ctx, p) => {
  S.getTask(ctx, p.id);
  return ctx.db.taskTimeline.filter((e) => e.parent_id === p.id && e.organization_id === ctx.orgId).map(strip).sort((a, b) => (a.occurred_at < b.occurred_at ? -1 : 1));
});
on("GET", "/api/v1/tasks/:id/trail", (ctx, p) => S.getTask(ctx, p.id).trail);
on("POST", "/api/v1/tasks/:id/assign", (ctx, p, req) =>
  S.reassignTask(ctx, p.id, String(req.body.team_id), { reason: req.body.override_reason as string, note: req.body.override_note as string }),
);
on("POST", "/api/v1/tasks/:id/accept", (ctx, p) => S.transitionTask(ctx, p.id, "accept"));
on("POST", "/api/v1/tasks/:id/decline", (ctx, p, req) => S.declineTask(ctx, p.id, String(req.body.reason ?? "")));
on("POST", "/api/v1/tasks/:id/en-route", (ctx, p) => S.transitionTask(ctx, p.id, "en_route"));
on("POST", "/api/v1/tasks/:id/on-site", (ctx, p) => S.transitionTask(ctx, p.id, "on_site"));
on("POST", "/api/v1/tasks/:id/complete", (ctx, p, req) => S.transitionTask(ctx, p.id, "complete", req.body as never));
on("POST", "/api/v1/tasks/:id/cancel", (ctx, p, req) => S.transitionTask(ctx, p.id, "cancel", { reason: String(req.body.reason ?? "") }));
on("POST", "/api/v1/tasks/:id/resources", (ctx, p, req) => S.reserveForTask(ctx, p.id, String(req.body.resource_id), req.body.qty as number | undefined));
on("DELETE", "/api/v1/tasks/:id/resources/:aid", (ctx, p) => S.releaseFromTask(ctx, p.id, p.aid));
on("POST", "/api/v1/tasks/override-request", (ctx, _p, req) => S.requestOverride(ctx, req.body as never));
on("GET", "/api/v1/override-requests", (ctx) => tenant(ctx.db.overrideRequests, ctx).map(({ payload, organization_id, ...r }) => (void payload, void organization_id, r)));
on("POST", "/api/v1/override-requests/:id/approve", (ctx, p) => S.approveOverride(ctx, p.id));

// ---------- resources and shelters ----------

on("GET", "/api/v1/resources", (ctx) => {
  S.requireRole(ctx, ["admin", "dispatcher", "volunteer_coordinator", "viewer", "responder"]);
  return tenant(ctx.db.resources, ctx).map((r) => S.serializeResource(ctx.db, r));
});
on("GET", "/api/v1/depots", (ctx) => tenant(ctx.db.depots, ctx).map(strip));
on("POST", "/api/v1/resources/:id/unavailable", (ctx, p, req) => S.setUnitAvailability(ctx, p.id, false, String(req.body.reason ?? "")));
on("POST", "/api/v1/resources/:id/available", (ctx, p) => S.setUnitAvailability(ctx, p.id, true));
on("POST", "/api/v1/stock/:id/adjust", (ctx, p, req) => S.adjustStock(ctx, p.id, Number(req.body.delta), String(req.body.reason ?? "")));

on("GET", "/api/v1/shelters", (ctx) => tenant(ctx.db.shelters, ctx).map(strip));
on("GET", "/api/v1/shelters/nearest", (ctx, _p, req) => {
  const at = { lat: Number(req.query.get("lat")), lng: Number(req.query.get("lng")) };
  const beds = Number(req.query.get("beds") ?? 1);
  return tenant(ctx.db.shelters, ctx)
    .filter((s) => s.status === "open" && s.capacity - s.occupancy >= beds)
    .map((s) => ({ ...strip(s), distance_km: round(distanceKm(at, s.location)) }))
    .sort((a, b) => a.distance_km - b.distance_km)
    .slice(0, 5);
});
on("PATCH", "/api/v1/shelters/:id", (ctx, p, req) => strip(S.updateShelter(ctx, p.id, req.body as never)));
on("POST", "/api/v1/shelters/:id/occupancy", (ctx, p, req) =>
  strip(S.shelterOccupancy(ctx, p.id, Number(req.body.delta), req.body.override_reason as string | undefined)),
);

// ---------- comments, notifications ----------

for (const parent of ["report", "task", "incident"] as const) {
  on("GET", `/api/v1/${parent}s/:id/comments`, (ctx, p) =>
    tenant(ctx.db.comments, ctx).filter((c) => c.parent_type === parent && c.parent_id === p.id).map(strip),
  );
  on("POST", `/api/v1/${parent}s/:id/comments`, (ctx, p, req) => {
    const body = String(req.body.body ?? "").trim();
    if (!body) throw new HttpError(422, "VALIDATION_ERROR", "Comment can't be empty");
    const names = [...body.matchAll(/@([\p{L}]+)/gu)].map((m) => m[1].toLowerCase());
    const mentioned = tenant(ctx.db.users, ctx).filter((u) => names.includes(u.name.split(" ")[0].toLowerCase()));
    const c: Comment & { organization_id: ID } = {
      id: newId("cmt"),
      organization_id: ctx.orgId,
      parent_type: parent,
      parent_id: p.id,
      author_name: ctx.user.name,
      body,
      mentions: mentioned.map((u) => u.name),
      created_at: new Date().toISOString(),
    };
    ctx.db.comments.push(c);
    const link = parent === "task" ? `/tasks/${p.id}` : parent === "report" ? `/reports/${p.id}` : `/incidents/${p.id}`;
    S.notify(ctx.db, ctx.orgId, mentioned.map((u) => u.id), { type: "comment.mention", title: `${ctx.user.name} mentioned you`, body, link });
    publish(ctx.db, ctx.orgId, "comment.created", c.id, strip(c), { roles: ["admin", "dispatcher", "responder", "volunteer_coordinator", "viewer"] });
    return { status: 201, body: strip(c) };
  });
}

on("GET", "/api/v1/notifications", (ctx) =>
  ctx.db.notifications.filter((n) => n.user_id === ctx.user.id).slice(0, 100).map(({ user_id, organization_id, ...n }) => (void user_id, void organization_id, n)),
);
on("POST", "/api/v1/notifications/read-all", (ctx) => {
  const now = new Date().toISOString();
  for (const n of ctx.db.notifications) if (n.user_id === ctx.user.id && !n.read_at) n.read_at = now;
  return { status: 204 };
});
on("POST", "/api/v1/notifications/:id/read", (ctx, p) => {
  const n = ctx.db.notifications.find((x) => x.id === p.id && x.user_id === ctx.user.id);
  if (n) n.read_at = new Date().toISOString();
  return { status: 204 };
});

// ---------- analytics, exports ----------

const ANALYTICS: Role[] = ["admin", "dispatcher", "volunteer_coordinator", "viewer", "responder"];
on("GET", "/api/v1/analytics/live", (ctx) => (S.requireRole(ctx, ANALYTICS), S.liveKpis(ctx)));
on("GET", "/api/v1/analytics/response-times", (ctx, _p, req) => (S.requireRole(ctx, ANALYTICS), S.responseTimes(ctx, (req.query.get("group_by") as never) ?? "category")));
on("GET", "/api/v1/analytics/team-performance", (ctx) => {
  S.requireRole(ctx, ANALYTICS);
  const rows = S.teamPerformance(ctx);
  return ctx.user.role === "responder" ? rows.filter((r) => r.team_id === ctx.user.team_id) : rows;
});
on("GET", "/api/v1/analytics/daily", (ctx) => (S.requireRole(ctx, ANALYTICS), S.dailyCounts(ctx)));
on("GET", "/api/v1/exports/:name", (ctx, p) => {
  S.requireRole(ctx, ["admin", "dispatcher", "volunteer_coordinator", "viewer"]);
  const esc = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  let rows: Record<string, unknown>[] = [];
  const name = p.name.replace(/\.csv$/, "");
  // Reporter PII is never included in exports for any role.
  if (name === "reports")
    rows = tenant(ctx.db.reports, ctx).map((r) => ({ reference: r.reference_code, category: r.category, priority: r.priority, status: r.status, created_at: r.created_at, triaged_at: r.triaged_at, resolved_at: r.resolved_at, lat: r.location.lat, lng: r.location.lng, address: r.address_text }));
  else if (name === "tasks")
    rows = tenant(ctx.db.tasks, ctx).map((t) => ({ id: t.id, status: t.status, team: ctx.db.teams.find((x) => x.id === t.assigned_team_id)?.name, assigned_at: t.assigned_at, accepted_at: t.accepted_at, on_site_at: t.on_site_at, completed_at: t.completed_at, outcome: t.outcome }));
  else if (name === "team-performance") rows = S.teamPerformance(ctx) as never;
  else throw new HttpError(404, "NOT_FOUND");
  S.audit(ctx, "export.created", "export", name, `Exported ${name}.csv (${rows.length} rows)`);
  const header = Object.keys(rows[0] ?? { empty: "" });
  return { __csv: [header.join(","), ...rows.map((r) => header.map((h) => esc(r[h])).join(","))].join("\n") };
});

// ---------- admin ----------

on("GET", "/api/v1/escalation-policies", (ctx) => ctx.db.policies[ctx.orgId]);
on("PUT", "/api/v1/escalation-policies", (ctx, _p, req) => {
  S.requireRole(ctx, ["admin"]);
  ctx.db.policies[ctx.orgId] = req.body as unknown as EscalationPolicy[];
  S.audit(ctx, "escalation_policy.updated", "organization", ctx.orgId, "Updated escalation policies");
  return ctx.db.policies[ctx.orgId];
});
on("GET", "/api/v1/audit-logs", (ctx, _p, req) => {
  S.requireRole(ctx, ["admin"]);
  const action = req.query.get("action");
  const entity = req.query.get("entity_type");
  return tenant(ctx.db.audit, ctx)
    .filter((a) => (!action || a.action.startsWith(action)) && (!entity || a.entity_type === entity))
    .slice(0, 300)
    .map(strip);
});

// ---------- dev helpers (mock only) ----------

pub("POST", "/api/v1/dev/reset", () => {
  resetDb();
  return { status: 204 };
});
on("POST", "/api/v1/dev/simulate-report", (ctx, _p, req) => {
  const org = ctx.db.orgs.find((o) => o.id === ctx.orgId)!;
  const critical = req.body.critical !== false;
  const cat = (req.body.category as Category) ?? "medical";
  const loc = offset({ lat: 30.0561, lng: 31.3301 }, Math.random() * 0.3, Math.random() * 360);
  return S.createPublicReport(ctx.db, org.slug, {
    category: cat,
    description: critical ? "Elderly man collapsed, not breathing well" : "Water rising in the street, cars stuck",
    location: loc,
    address_text: "Abbas El Akkad St, Nasr City",
    people_affected: 1,
    name: "Mariam",
    phone: `+20 100 ${Math.floor(1000000 + Math.random() * 8999999)}`,
    life_threatening: critical,
  } as never, `sim-${Math.random()}`);
});

// ---------- dispatcher ----------

export function handle(req: Req): Res {
  const db = getDb();
  const parts = req.path.split("/").filter(Boolean);
  for (const r of routes) {
    if (r.method !== req.method || r.parts.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      if (r.parts[i].startsWith(":")) params[r.parts[i].slice(1)] = decodeURIComponent(parts[i]);
      else if (r.parts[i] !== parts[i]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    try {
      let out: unknown;
      if (r.public) out = (r.handler as PublicHandler)(db, params, req);
      else {
        const user = db.users.find((u) => u.id === req.sessionUserId);
        if (!user) throw new HttpError(401, "UNAUTHENTICATED", "Sign in required");
        if (!user.is_active) throw new HttpError(401, "USER_DEACTIVATED");
        out = (r.handler as Handler)({ db, user, orgId: user.organization_id }, params, req);
      }
      return toRes(out);
    } catch (e) {
      if (e instanceof HttpError) return { status: e.status, body: { error: { code: e.code, message: e.message, details: e.details } } };
      console.error("[mock]", e);
      return { status: 500, body: { error: { code: "INTERNAL", message: String(e) } } };
    }
  }
  return { status: 404, body: { error: { code: "ROUTE_NOT_FOUND", message: `${req.method} ${req.path}` } } };
}

function toRes(out: unknown): Res {
  if (out && typeof out === "object") {
    const o = out as Record<string, unknown>;
    if ("__session" in o) return { status: 200, body: o.body, setSession: o.__session as string | null };
    if ("__csv" in o) return { status: 200, csv: o.__csv as string };
    if ("status" in o && typeof o.status === "number" && Object.keys(o).every((k) => k === "status" || k === "body"))
      return { status: o.status, body: o.body };
  }
  return { status: out === undefined ? 204 : 200, body: out };
}

export function authenticate(sessionUserId?: string) {
  const db = getDb();
  return db.users.find((u) => u.id === sessionUserId && u.is_active);
}
