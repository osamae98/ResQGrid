// Domain types shared by the web app and (later) generated from the FastAPI OpenAPI spec.
// Field names follow PRD v3 §10. Timestamps are ISO-8601 UTC strings.

export type ID = string;
export type ISODate = string;

export type Role = "admin" | "dispatcher" | "responder" | "volunteer_coordinator" | "viewer";

export const CATEGORIES = [
  "medical",
  "fire",
  "flood",
  "rescue",
  "shelter",
  "food_water",
  "road_block",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const PRIORITIES = ["critical", "high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const REPORT_STATUSES = ["new", "triaged", "assigned", "in_progress", "resolved", "closed"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const TASK_STATUSES = ["pending", "accepted", "en_route", "on_site", "completed", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const ACTIVE_TASK_STATUSES: TaskStatus[] = ["pending", "accepted", "en_route", "on_site"];

export type TeamAvailability = "available" | "busy" | "off_duty";
export type UnitStatus = "available" | "reserved" | "deployed" | "unavailable";
export type ShelterStatus = "open" | "full" | "closed";
export type IncidentStatus = "active" | "monitoring" | "closed";
export type ReportSource = "public" | "dispatcher" | "field";

export const OUTCOMES = ["treated_on_site", "transported", "referred", "no_action_needed", "not_found"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const OVERRIDE_REASONS = [
  "no_eligible_team_nearby",
  "mass_casualty",
  "capability_verified_offline",
  "location_confirmed_by_phone",
  "other",
] as const;
export type OverrideReason = (typeof OVERRIDE_REASONS)[number];

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Organization {
  id: ID;
  name: string;
  slug: string;
  timezone: string;
  operating_area: { center: LatLng; radius_km: number };
}

export interface User {
  id: ID;
  email: string;
  name: string;
  role: Role;
  organization_id: ID;
  team_id?: ID;
  is_active: boolean;
  on_duty?: boolean;
}

export interface Me {
  user: User;
  organization: Organization;
}

export interface Capability {
  id: ID;
  key: string;
  name: string;
}

export interface MemberCapability {
  key: string;
  expires_at?: ISODate;
}

export interface TeamMember {
  user_id: ID;
  name: string;
  is_lead: boolean;
  on_duty: boolean;
  capabilities: MemberCapability[];
}

export interface Team {
  id: ID;
  name: string;
  type: "medical" | "water_rescue" | "fire" | "search_rescue" | "logistics" | "volunteer";
  is_volunteer: boolean;
  availability: TeamAvailability;
  home_base: LatLng;
  last_location?: LatLng;
  last_location_at?: ISODate;
  lead_id?: ID;
  members: TeamMember[];
  /** Union of unexpired capabilities of on-duty members (CAP-1). */
  capabilities: string[];
  /** Active task and no fix within the stale window (LOC-3). */
  is_stale: boolean;
  active_task_id?: ID;
  tasks_completed_today: number;
}

export interface Incident {
  id: ID;
  title: string;
  type: string;
  status: IncidentStatus;
  center: LatLng;
  radius_km: number;
  commander_id?: ID;
  commander_name?: string;
  created_at: ISODate;
  closed_at?: ISODate;
  stats?: { open_reports: number; active_tasks: number; resources_deployed: number };
}

export interface Report {
  id: ID;
  reference_code: string;
  incident_id?: ID;
  title: string;
  description: string;
  category: Category;
  priority: Priority;
  status: ReportStatus;
  location: LatLng;
  address_text?: string;
  people_affected?: number;
  source: ReportSource;
  created_at: ISODate;
  updated_at: ISODate;
  triaged_at?: ISODate;
  resolved_at?: ISODate;
  archived_at?: ISODate;
  archive_reason?: string;
  /** Open reports of the same category within 200 m / 60 min (REP-4). */
  possible_duplicate_ids: ID[];
  merged_into_id?: ID;
  merged_ids: ID[];
  task_ids: ID[];
  photo_count: number;
  /** True when a ReportContact row exists. The contact itself is fetched separately and audited. */
  has_contact: boolean;
  rejected?: boolean;
}

export interface ReportContact {
  name?: string;
  phone?: string;
}

export interface TimelineEvent {
  id: ID;
  type: string;
  actor_name?: string;
  from_status?: string;
  to_status?: string;
  note?: string;
  location?: LatLng;
  occurred_at: ISODate;
}

export interface ResourceAssignment {
  id: ID;
  resource_id: ID;
  resource_name: string;
  resource_type: string;
  kind: "unit" | "stock";
  task_id: ID;
  qty: number;
  state: "reserved" | "deployed" | "returned" | "consumed";
  reserved_at: ISODate;
  deployed_at?: ISODate;
  released_at?: ISODate;
}

export interface TaskReportSummary {
  reference_code: string;
  title: string;
  category: Category;
  priority: Priority;
  location: LatLng;
  address_text?: string;
}

export interface Task {
  id: ID;
  report_id: ID;
  report: TaskReportSummary;
  incident_id?: ID;
  assigned_team_id?: ID;
  team_name?: string;
  status: TaskStatus;
  required_capabilities: string[];
  instructions: string;
  distance_km?: number;
  override_by?: string;
  override_reason?: string;
  decline_reason?: string;
  resolution_note?: string;
  outcome?: Outcome;
  people_helped?: number;
  target_shelter_id?: ID;
  created_at: ISODate;
  assigned_at?: ISODate;
  accepted_at?: ISODate;
  en_route_at?: ISODate;
  on_site_at?: ISODate;
  completed_at?: ISODate;
  cancelled_at?: ISODate;
  archived_at?: ISODate;
  /** 0 none, 1 dispatchers alerted, 2 admins notified (§6.4). */
  escalation_level: 0 | 1 | 2;
  escalation_deadline?: ISODate;
  resources: ResourceAssignment[];
}

export interface Depot {
  id: ID;
  name: string;
  location: LatLng;
}

export interface Resource {
  id: ID;
  kind: "unit" | "stock";
  type: string;
  name: string;
  /** Units only. */
  status?: UnitStatus;
  unavailable_reason?: string;
  depot_id?: ID;
  depot_name?: string;
  location: LatLng;
  owner_team_id?: ID;
  incident_id?: ID;
  /** Stock only (§7.2). */
  on_hand?: number;
  reserved?: number;
  unit_label?: string;
  low_stock_threshold?: number;
  active_task_id?: ID;
}

export type ShelterFacility = "medical" | "food" | "accessibility";

export interface Shelter {
  id: ID;
  name: string;
  location: LatLng;
  capacity: number;
  occupancy: number;
  status: ShelterStatus;
  facilities: ShelterFacility[];
  contact: string;
  distance_km?: number;
}

export interface TeamSuggestion {
  team_id: ID;
  team_name: string;
  distance_km: number;
  eligible: boolean;
  /** e.g. "busy", "stale:12m", "missing:water_rescue", "off_duty", "holding_critical". */
  reasons: string[];
  capabilities: { key: string; ok: boolean }[];
  last_seen_s?: number;
  availability: TeamAvailability;
}

export interface OverrideRequest {
  id: ID;
  task_id: ID;
  team_id: ID;
  team_name: string;
  requested_by: string;
  reason: OverrideReason;
  note?: string;
  created_at: ISODate;
  expires_at: ISODate;
  status: "pending" | "approved" | "expired";
}

export interface Notification {
  id: ID;
  type: string;
  title: string;
  body?: string;
  link?: string;
  priority?: "normal" | "high";
  read_at?: ISODate;
  created_at: ISODate;
}

export interface Comment {
  id: ID;
  parent_type: "report" | "task" | "incident";
  parent_id: ID;
  author_name: string;
  body: string;
  mentions: string[];
  created_at: ISODate;
}

export interface AuditEntry {
  id: ID;
  actor_name: string;
  action: string;
  entity_type: string;
  entity_id: ID;
  summary: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  created_at: ISODate;
}

export interface EscalationPolicy {
  priority: Priority;
  untriaged_timeout_s?: number;
  accept_timeout_s: number;
  en_route_timeout_s: number;
  stale_location_s: number;
}

export interface CategoryRule {
  category: Category;
  default_priority: Priority;
  required_capabilities: string[];
  critical_capabilities?: string[];
}

export interface LiveKpis {
  open_reports: number;
  critical_open: number;
  unassigned_over_5m: number;
  teams: { available: number; busy: number; stale: number; off_duty: number };
  units: { available: number; reserved: number; deployed: number; unavailable: number };
  shelter_beds_free: number;
  shelter_beds_total: number;
}

export interface DurationStat {
  median_s: number | null;
  p90_s: number | null;
}

export interface ResponseTimeRow {
  group: string;
  count: number;
  triage: DurationStat;
  assign: DurationStat;
  accept: DurationStat;
  on_site: DurationStat;
  resolve: DurationStat;
}

export interface TeamPerformanceRow {
  team_id: ID;
  team_name: string;
  tasks_completed: number;
  decline_rate: number;
  open_tasks: number;
  on_site_median_s: number | null;
}

export interface PublicIntake {
  organization: Pick<Organization, "name" | "slug" | "operating_area">;
  categories: Category[];
  incident?: { id: ID; title: string };
}

export interface PublicReportStatus {
  reference_code: string;
  status: ReportStatus;
  updated_at: ISODate;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}
