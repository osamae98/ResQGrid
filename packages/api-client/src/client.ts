import type {
  AuditEntry,
  Capability,
  Category,
  CategoryRule,
  Comment,
  Depot,
  EscalationPolicy,
  ID,
  Incident,
  LatLng,
  LiveKpis,
  Me,
  Notification,
  Outcome,
  OverrideReason,
  OverrideRequest,
  Page,
  Priority,
  PublicIntake,
  PublicReportStatus,
  Report,
  ReportContact,
  ReportStatus,
  Resource,
  ResponseTimeRow,
  Role,
  Shelter,
  Task,
  TaskStatus,
  Team,
  TeamAvailability,
  TeamPerformanceRow,
  TeamSuggestion,
  TimelineEvent,
  User,
} from "./types";

export interface ApiErrorBody {
  error: { code: string; message?: string; details?: Record<string, unknown> };
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
    public details?: Record<string, unknown>,
  ) {
    super(message ?? code);
  }
}

export interface ReportFilters {
  status?: ReportStatus[];
  priority?: Priority[];
  category?: Category[];
  incident_id?: ID;
  q?: string;
  include_archived?: boolean;
  page?: number;
  page_size?: number;
}

export interface TaskFilters {
  status?: TaskStatus[];
  team_id?: ID;
  incident_id?: ID;
  mine?: boolean;
}

export interface PublicReportInput {
  category: Category;
  description: string;
  location: LatLng;
  address_text?: string;
  people_affected?: number;
  name?: string;
  phone?: string;
  photo_count?: number;
  /** "Is anyone's life in danger?" — marks the report critical. */
  life_threatening?: boolean;
  /** Honeypot (§8.4): must stay empty. */
  website?: string;
  /** Milliseconds the form was open, for the minimum fill time check. */
  fill_ms?: number;
  incident_token?: string;
}

export interface CreateReportInput {
  title?: string;
  description: string;
  category: Category;
  priority?: Priority;
  location: LatLng;
  address_text?: string;
  people_affected?: number;
  incident_id?: ID;
  name?: string;
  phone?: string;
}

export interface CreateTaskInput {
  report_id: ID;
  team_id: ID;
  instructions: string;
  required_capabilities: string[];
  resources: { resource_id: ID; qty?: number }[];
  target_shelter_id?: ID;
  override_reason?: OverrideReason;
  override_note?: string;
}

export interface ClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  onUnauthorized?: () => void;
}

type Query = Record<string, string | number | boolean | string[] | undefined>;

function qs(params?: Query) {
  if (!params) return "";
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    sp.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

function idempotencyKey() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

export function createApiClient(opts: ClientOptions) {
  const f = opts.fetch ?? fetch;

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    // Mutations carry an Idempotency-Key so field retries are safe (§11).
    if (method !== "GET") headers["Idempotency-Key"] = idempotencyKey();
    const res = await f(`${opts.baseUrl}${path}`, {
      method,
      headers,
      credentials: "include",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 204) return undefined as T;
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401) opts.onUnauthorized?.();
      const err = (json as ApiErrorBody).error ?? { code: "HTTP_" + res.status };
      throw new ApiError(res.status, err.code, err.message, err.details);
    }
    return json as T;
  }

  const get = <T>(p: string, q?: Query) => request<T>("GET", p + qs(q));
  const post = <T>(p: string, b?: unknown) => request<T>("POST", p, b ?? {});
  const patch = <T>(p: string, b: unknown) => request<T>("PATCH", p, b);
  const put = <T>(p: string, b: unknown) => request<T>("PUT", p, b);
  const del = <T>(p: string) => request<T>("DELETE", p);

  const v1 = "/api/v1";

  return {
    auth: {
      login: (email: string, password: string) => post<Me>(`${v1}/auth/login`, { email, password }),
      logout: () => post<void>(`${v1}/auth/logout`),
      me: () => get<Me>(`${v1}/me`),
      registerOrg: (b: { org_name: string; slug: string; timezone: string; admin_name: string; email: string; password: string }) =>
        post<Me>(`${v1}/auth/register-org`, b),
      demoUsers: () => get<{ org: string; users: Pick<User, "email" | "name" | "role">[] }[]>(`${v1}/auth/demo-users`),
    },
    org: {
      get: () => get<Me["organization"]>(`${v1}/org`),
      update: (b: Partial<Me["organization"]>) => patch<Me["organization"]>(`${v1}/org`, b),
      users: () => get<User[]>(`${v1}/users`),
      invite: (email: string, role: Role) => post<{ id: ID; expires_at: string }>(`${v1}/invitations`, { email, role }),
      setUserActive: (id: ID, is_active: boolean) => patch<User>(`${v1}/users/${id}`, { is_active }),
    },
    public: {
      intake: (slug: string) => get<PublicIntake>(`/public/v1/${slug}/intake`),
      submit: (slug: string, b: PublicReportInput) =>
        post<{ reference_code: string }>(`/public/v1/${slug}/reports`, b),
      status: (reference: string) => get<PublicReportStatus>(`/public/v1/reports/${reference}`),
    },
    reports: {
      list: (f?: ReportFilters) => get<Page<Report>>(`${v1}/reports`, f as Query),
      get: (id: ID) => get<Report>(`${v1}/reports/${id}`),
      create: (b: CreateReportInput) => post<Report>(`${v1}/reports`, b),
      update: (id: ID, b: Partial<Pick<Report, "title" | "description" | "category" | "incident_id">>) =>
        patch<Report>(`${v1}/reports/${id}`, b),
      triage: (id: ID, b: { priority: Priority; category?: Category; incident_id?: ID | null; reject?: boolean }) =>
        post<Report>(`${v1}/reports/${id}/triage`, b),
      merge: (id: ID, primary_id: ID) => post<Report>(`${v1}/reports/${id}/merge`, { primary_id }),
      unmerge: (id: ID) => post<Report>(`${v1}/reports/${id}/unmerge`),
      archive: (id: ID, reason: string) => post<Report>(`${v1}/reports/${id}/archive`, { reason }),
      restore: (id: ID) => post<Report>(`${v1}/reports/${id}/restore`),
      close: (id: ID) => post<Report>(`${v1}/reports/${id}/close`),
      contact: (id: ID) => get<ReportContact>(`${v1}/reports/${id}/contact`),
      timeline: (id: ID) => get<TimelineEvent[]>(`${v1}/reports/${id}/timeline`),
      duplicates: (id: ID) => get<Report[]>(`${v1}/reports/${id}/duplicates`),
      suggestedTeams: (id: ID, capabilities?: string[]) =>
        get<TeamSuggestion[]>(`${v1}/reports/${id}/suggested-teams`, { capabilities }),
    },
    incidents: {
      list: () => get<Incident[]>(`${v1}/incidents`),
      get: (id: ID) => get<Incident>(`${v1}/incidents/${id}`),
      create: (b: Pick<Incident, "title" | "type" | "center" | "radius_km">) => post<Incident>(`${v1}/incidents`, b),
      update: (id: ID, b: Partial<Pick<Incident, "title" | "status" | "radius_km">>) => patch<Incident>(`${v1}/incidents/${id}`, b),
      close: (id: ID) => post<Incident>(`${v1}/incidents/${id}/close`),
    },
    teams: {
      list: () => get<Team[]>(`${v1}/teams`),
      create: (b: Pick<Team, "name" | "type" | "home_base"> & { is_volunteer?: boolean }) => post<Team>(`${v1}/teams`, b),
      setAvailability: (id: ID, availability: TeamAvailability) =>
        patch<Team>(`${v1}/teams/${id}/availability`, { availability }),
      setMemberDuty: (teamId: ID, userId: ID, on_duty: boolean) =>
        patch<Team>(`${v1}/teams/${teamId}/members/${userId}`, { on_duty }),
      capabilities: () => get<Capability[]>(`${v1}/capabilities`),
      categoryRules: () => get<CategoryRule[]>(`${v1}/category-rules`),
      putCategoryRules: (rules: CategoryRule[]) => put<CategoryRule[]>(`${v1}/category-rules`, rules),
    },
    location: {
      push: (points: { lat: number; lng: number; accuracy_m: number; speed?: number; heading?: number; recorded_at: string }[]) =>
        post<{ accepted: number }>(`${v1}/me/location`, { points }),
      setDuty: (on_duty: boolean) => post<User>(`${v1}/me/duty`, { on_duty }),
    },
    tasks: {
      list: (f?: TaskFilters) => get<Task[]>(`${v1}/tasks`, f as Query),
      get: (id: ID) => get<Task>(`${v1}/tasks/${id}`),
      create: (b: CreateTaskInput) => post<Task>(`${v1}/tasks`, b),
      timeline: (id: ID) => get<TimelineEvent[]>(`${v1}/tasks/${id}/timeline`),
      assign: (id: ID, team_id: ID, override?: { override_reason?: OverrideReason; override_note?: string }) =>
        post<Task>(`${v1}/tasks/${id}/assign`, { team_id, ...override }),
      trail: (id: ID) => get<LatLng[]>(`${v1}/tasks/${id}/trail`),
      accept: (id: ID) => post<Task>(`${v1}/tasks/${id}/accept`),
      decline: (id: ID, reason: string) => post<Task>(`${v1}/tasks/${id}/decline`, { reason }),
      enRoute: (id: ID) => post<Task>(`${v1}/tasks/${id}/en-route`),
      onSite: (id: ID) => post<Task>(`${v1}/tasks/${id}/on-site`),
      complete: (id: ID, b: { resolution_note: string; outcome: Outcome; people_helped?: number; consumed?: Record<ID, number> }) =>
        post<Task>(`${v1}/tasks/${id}/complete`, b),
      cancel: (id: ID, reason: string) => post<Task>(`${v1}/tasks/${id}/cancel`, { reason }),
      reserve: (id: ID, resource_id: ID, qty?: number) => post<Task>(`${v1}/tasks/${id}/resources`, { resource_id, qty }),
      release: (id: ID, assignment_id: ID) => del<Task>(`${v1}/tasks/${id}/resources/${assignment_id}`),
      overrideRequest: (b: Omit<CreateTaskInput, "override_note"> & { note?: string }) =>
        post<OverrideRequest>(`${v1}/tasks/override-request`, b),
      overrideRequests: () => get<OverrideRequest[]>(`${v1}/override-requests`),
      overrideApprove: (requestId: ID) => post<Task>(`${v1}/override-requests/${requestId}/approve`),
    },
    resources: {
      list: () => get<Resource[]>(`${v1}/resources`),
      depots: () => get<Depot[]>(`${v1}/depots`),
      markUnavailable: (id: ID, reason: string) => post<Resource>(`${v1}/resources/${id}/unavailable`, { reason }),
      markAvailable: (id: ID) => post<Resource>(`${v1}/resources/${id}/available`),
      adjustStock: (id: ID, delta: number, reason: string) => post<Resource>(`${v1}/stock/${id}/adjust`, { delta, reason }),
    },
    shelters: {
      list: () => get<Shelter[]>(`${v1}/shelters`),
      nearest: (lat: number, lng: number, beds = 1) => get<Shelter[]>(`${v1}/shelters/nearest`, { lat, lng, beds }),
      occupancy: (id: ID, delta: number, override_reason?: string) =>
        post<Shelter>(`${v1}/shelters/${id}/occupancy`, { delta, override_reason }),
      update: (id: ID, b: Partial<Pick<Shelter, "status" | "capacity" | "contact">>) => patch<Shelter>(`${v1}/shelters/${id}`, b),
    },
    comments: {
      list: (parent_type: Comment["parent_type"], id: ID) => get<Comment[]>(`${v1}/${parent_type}s/${id}/comments`),
      create: (parent_type: Comment["parent_type"], id: ID, body: string) =>
        post<Comment>(`${v1}/${parent_type}s/${id}/comments`, { body }),
    },
    notifications: {
      list: () => get<Notification[]>(`${v1}/notifications`),
      readAll: () => post<void>(`${v1}/notifications/read-all`),
      read: (id: ID) => post<void>(`${v1}/notifications/${id}/read`),
    },
    analytics: {
      live: () => get<LiveKpis>(`${v1}/analytics/live`),
      responseTimes: (group_by: "category" | "team" | "priority" | "incident") =>
        get<ResponseTimeRow[]>(`${v1}/analytics/response-times`, { group_by }),
      teamPerformance: () => get<TeamPerformanceRow[]>(`${v1}/analytics/team-performance`),
      daily: () => get<{ date: string; reports: number; resolved: number; critical: number }[]>(`${v1}/analytics/daily`),
      exportUrl: (name: string) => `${opts.baseUrl}${v1}/exports/${name}.csv`,
    },
    admin: {
      escalationPolicies: () => get<EscalationPolicy[]>(`${v1}/escalation-policies`),
      putEscalationPolicies: (p: EscalationPolicy[]) => put<EscalationPolicy[]>(`${v1}/escalation-policies`, p),
      auditLogs: (q?: { action?: string; entity_type?: string }) => get<AuditEntry[]>(`${v1}/audit-logs`, q),
    },
    dev: {
      reset: () => post<void>(`${v1}/dev/reset`),
      simulateReport: (b: { critical?: boolean; category?: Category } = {}) => post<{ reference_code: string }>(`${v1}/dev/simulate-report`, b),
    },
    eventsUrl: () => `${opts.baseUrl}/events`,
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
