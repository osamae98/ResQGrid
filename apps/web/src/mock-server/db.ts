// In-memory stand-in for PostgreSQL. Every tenant row carries organization_id (PRD §8.1).
// Replaced by the FastAPI backend later; the web app only talks to it over HTTP + SSE.
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
  Notification,
  Organization,
  OverrideRequest,
  Priority,
  Report,
  ReportContact,
  ReportStatus,
  ResourceAssignment,
  Resource,
  Shelter,
  Task,
  TeamMember,
  Team,
  TimelineEvent,
  User,
} from "@resqgrid/api-client";
import { offset } from "./geo";

type Tenant = { organization_id: ID };

export type UserRec = User & { password: string };
export type TeamRec = Omit<Team, "capabilities" | "is_stale" | "active_task_id"> &
  Tenant & {
    /** Simulator leaves the team alone while a real device is pushing fixes. */
    manual_location_until?: number;
    /** Set when a team's device stops sending (demo of LOC-3). */
    silent?: boolean;
    stale_level: 0 | 1 | 2 | 3;
  };
export type ReportRec = Omit<Report, "possible_duplicate_ids" | "merged_ids" | "task_ids" | "has_contact"> &
  Tenant & { contact?: ReportContact; untriaged_level: 0 | 1 | 2 };
export type TaskRec = Omit<Task, "report" | "team_name" | "resources"> &
  Tenant & { en_route_reminded?: boolean; trail: LatLng[] };
export type ResourceRec = Omit<Resource, "depot_name" | "active_task_id"> & Tenant;
export type AssignmentRec = ResourceAssignment & Tenant;
export type TimelineRec = TimelineEvent & Tenant & { parent_id: ID };
export type NotificationRec = Notification & Tenant & { user_id: ID };

export interface DB {
  orgs: Organization[];
  users: UserRec[];
  capabilities: (Capability & Tenant)[];
  categoryRules: Record<ID, CategoryRule[]>;
  policies: Record<ID, EscalationPolicy[]>;
  teams: TeamRec[];
  incidents: (Incident & Tenant)[];
  reports: ReportRec[];
  dupLinks: (Tenant & { id: ID; primary_report_id: ID; duplicate_report_id: ID; linked_by: string; unlinked_at?: string })[];
  reportTimeline: TimelineRec[];
  tasks: TaskRec[];
  taskTimeline: TimelineRec[];
  depots: (Depot & Tenant)[];
  resources: ResourceRec[];
  assignments: AssignmentRec[];
  shelters: (Shelter & Tenant)[];
  shelterEvents: (Tenant & { id: ID; shelter_id: ID; delta: number; actor_name: string; occurred_at: string })[];
  comments: (Comment & Tenant)[];
  notifications: NotificationRec[];
  audit: (AuditEntry & Tenant)[];
  overrideRequests: (OverrideRequest & Tenant & { payload: unknown })[];
  rate: Record<string, number[]>;
  seq: Record<string, number>;
}

// Sequential ids: the seed always produces the same ids, so sessions and links survive a dev-server restart.
// The counter lives on globalThis next to the DB (see state.ts). As a module variable it reset to 0
// on every hot reload while the DB survived, so new records reused existing ids (two "rep_0000").
const ids = globalThis as unknown as { __rqIdCounter?: number };
export const newId = (prefix: string) => {
  // Unset only when a DB from before this counter existed is still in memory: start well above the seed's ids.
  const n = ids.__rqIdCounter ?? 100_000;
  ids.__rqIdCounter = n + 1;
  return `${prefix}_${n.toString(36).padStart(4, "0")}`;
};

const REF_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export function referenceCode() {
  let s = "RQ-";
  for (let i = 0; i < 5; i++) s += REF_ALPHABET[Math.floor(Math.random() * REF_ALPHABET.length)];
  return s;
}

// Deterministic PRNG so the seed looks the same on every reset.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEFAULT_CATEGORY_RULES: CategoryRule[] = [
  { category: "medical", default_priority: "high", required_capabilities: ["first_aid"], critical_capabilities: ["paramedic"] },
  { category: "fire", default_priority: "critical", required_capabilities: ["fire_suppression"] },
  { category: "flood", default_priority: "high", required_capabilities: ["water_rescue"] },
  { category: "rescue", default_priority: "critical", required_capabilities: ["search_rescue"] },
  { category: "shelter", default_priority: "medium", required_capabilities: ["logistics"] },
  { category: "food_water", default_priority: "medium", required_capabilities: ["logistics"] },
  { category: "road_block", default_priority: "medium", required_capabilities: ["heavy_lifting"] },
  { category: "other", default_priority: "medium", required_capabilities: [] },
];

export const DEFAULT_POLICIES: EscalationPolicy[] = [
  { priority: "critical", untriaged_timeout_s: 120, accept_timeout_s: 180, en_route_timeout_s: 600, stale_location_s: 300 },
  { priority: "high", accept_timeout_s: 600, en_route_timeout_s: 600, stale_location_s: 300 },
  { priority: "medium", accept_timeout_s: 1800, en_route_timeout_s: 600, stale_location_s: 300 },
  { priority: "low", accept_timeout_s: 3600, en_route_timeout_s: 600, stale_location_s: 300 },
];

const CAPABILITY_CATALOG: [string, string][] = [
  ["first_aid", "First aid"],
  ["paramedic", "Paramedic"],
  ["water_rescue", "Water rescue"],
  ["fire_suppression", "Fire suppression"],
  ["heavy_lifting", "Heavy lifting"],
  ["search_rescue", "Search & rescue"],
  ["logistics", "Logistics"],
];

/** Nasr City — the vertical-slice report location (§4.1). */
export const NASR_CITY: LatLng = { lat: 30.0561, lng: 31.3301 };
const HELIOPOLIS: LatLng = { lat: 30.0911, lng: 31.3225 };

const REPORT_TEMPLATES: Record<Category, { title: string; description: string }[]> = {
  medical: [
    { title: "Person collapsed on street", description: "Middle-aged woman fainted near the bus stop, breathing but unresponsive." },
    { title: "Injured after wall collapse", description: "Two people with leg injuries, one bleeding heavily." },
    { title: "Diabetic emergency", description: "Elderly neighbour confused and sweating, family says diabetic." },
  ],
  fire: [
    { title: "Kitchen fire in apartment", description: "Smoke coming from third-floor window, residents evacuating." },
    { title: "Electrical fire at shop", description: "Sparks and smoke from a transformer next to a shop front." },
  ],
  flood: [
    { title: "Street flooded, car stuck", description: "Water knee-deep, a car is stalled with a driver inside." },
    { title: "Basement flooding", description: "Water entering basement flats, families moving to upper floors." },
    { title: "Family trapped by water", description: "Family of five on the roof, water rising around the house." },
  ],
  rescue: [
    { title: "Person trapped under debris", description: "Part of an old building collapsed, one person heard calling." },
    { title: "Child stuck in elevator", description: "Power cut, elevator stuck between floors with a child inside." },
  ],
  shelter: [
    { title: "Displaced families need beds", description: "Around 12 people from flooded homes need a place to stay tonight." },
  ],
  food_water: [
    { title: "Drinking water needed", description: "Building without water for two days, elderly residents." },
    { title: "Food packs for families", description: "Families in the school courtyard have not eaten since morning." },
  ],
  road_block: [
    { title: "Tree blocking road", description: "Large tree fell across the main road, ambulances can't pass." },
    { title: "Debris on bridge ramp", description: "Concrete blocks on the ramp, one lane closed." },
  ],
  other: [{ title: "Downed power line", description: "Cable hanging low over the sidewalk, sparking in the rain." }],
};

const STREETS = [
  "Abbas El Akkad St, Nasr City",
  "Makram Ebeid St, Nasr City",
  "Mostafa El Nahas St, Nasr City",
  "El Tayaran St, Nasr City",
  "Merghany St, Heliopolis",
  "Baghdad St, Korba, Heliopolis",
  "El Nozha St, Heliopolis",
  "Salah Salem Rd, Abbassia",
  "Youssef Abbas St, Nasr City",
  "El Thawra St, Heliopolis",
];

function iso(ms: number) {
  return new Date(ms).toISOString();
}

export function createSeed(): DB {
  ids.__rqIdCounter = 0;
  const now = Date.now();
  const rnd = mulberry32(42);
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const minutes = (m: number) => m * 60_000;

  const db: DB = {
    orgs: [],
    users: [],
    capabilities: [],
    categoryRules: {},
    policies: {},
    teams: [],
    incidents: [],
    reports: [],
    dupLinks: [],
    reportTimeline: [],
    tasks: [],
    taskTimeline: [],
    depots: [],
    resources: [],
    assignments: [],
    shelters: [],
    shelterEvents: [],
    comments: [],
    notifications: [],
    audit: [],
    overrideRequests: [],
    rate: {},
    seq: {},
  };

  // ---------- Organisations ----------
  const cairo: Organization = {
    id: "org_cairo",
    name: "Cairo Rescue Network",
    slug: "cairo-rescue",
    timezone: "Africa/Cairo",
    operating_area: { center: { lat: 30.072, lng: 31.33 }, radius_km: 8 },
  };
  const giza: Organization = {
    id: "org_giza",
    name: "Giza Relief Alliance",
    slug: "giza-relief",
    timezone: "Africa/Cairo",
    operating_area: { center: { lat: 30.06, lng: 31.335 }, radius_km: 8 },
  };
  db.orgs.push(cairo, giza);

  for (const org of db.orgs) {
    db.categoryRules[org.id] = structuredClone(DEFAULT_CATEGORY_RULES);
    db.policies[org.id] = structuredClone(DEFAULT_POLICIES);
    for (const [key, name] of CAPABILITY_CATALOG) {
      db.capabilities.push({ id: `cap_${org.id}_${key}`, key, name, organization_id: org.id });
    }
  }

  const addUser = (org: Organization, name: string, role: User["role"], email: string, team_id?: ID): UserRec => {
    const u: UserRec = {
      id: newId("usr"),
      email,
      name,
      role,
      organization_id: org.id,
      team_id,
      is_active: true,
      on_duty: role === "responder" ? true : undefined,
      password: "demo1234",
    };
    db.users.push(u);
    return u;
  };

  // One login per role per org (§14.2).
  const cairoAdmin = addUser(cairo, "Nadia Hassan", "admin", "admin@cairo-rescue.test");
  const cairoDispatcher = addUser(cairo, "Omar Farouk", "dispatcher", "dispatcher@cairo-rescue.test");
  addUser(cairo, "Mona Khalil", "volunteer_coordinator", "coordinator@cairo-rescue.test");
  addUser(cairo, "Tarek Mansour", "viewer", "viewer@cairo-rescue.test");
  addUser(giza, "Salma Adel", "admin", "admin@giza-relief.test");
  addUser(giza, "Youssef Samir", "dispatcher", "dispatcher@giza-relief.test");
  addUser(giza, "Hana Mostafa", "volunteer_coordinator", "coordinator@giza-relief.test");
  addUser(giza, "Karim Lotfy", "viewer", "viewer@giza-relief.test");

  const in6months = iso(now + 180 * 86_400_000);
  const expired = iso(now - 5 * 86_400_000);

  type TeamSpec = {
    org: Organization;
    name: string;
    type: TeamRec["type"];
    volunteer?: boolean;
    availability: TeamRec["availability"];
    at: LatLng;
    lastSeenMin: number;
    silent?: boolean;
    members: { name: string; email?: string; caps: string[]; expiredCaps?: string[]; lead?: boolean; onDuty?: boolean }[];
  };

  const teamSpecs: TeamSpec[] = [
    {
      org: cairo,
      name: "Medic Team 1",
      type: "medical",
      availability: "busy",
      at: offset(NASR_CITY, 0.6, 40),
      lastSeenMin: 0.2,
      members: [
        { name: "Ahmed Said", caps: ["paramedic", "first_aid"], lead: true },
        { name: "Laila Fathy", caps: ["first_aid"] },
      ],
    },
    {
      org: cairo,
      name: "Medic Team 2",
      type: "medical",
      availability: "available",
      at: offset(NASR_CITY, 1.2, 200),
      lastSeenMin: 0.33,
      members: [
        { name: "Sara Nabil", email: "responder@cairo-rescue.test", caps: ["paramedic", "first_aid"], lead: true },
        { name: "Hossam Reda", caps: ["first_aid"], expiredCaps: ["paramedic"] },
      ],
    },
    {
      org: cairo,
      name: "Water Rescue Alpha",
      type: "water_rescue",
      availability: "available",
      at: offset(HELIOPOLIS, 0.8, 120),
      lastSeenMin: 0.5,
      members: [
        { name: "Mahmoud Ali", caps: ["water_rescue", "search_rescue", "first_aid"], lead: true },
        { name: "Dina Sherif", caps: ["water_rescue"] },
        { name: "Amr Wagdy", caps: ["heavy_lifting"] },
      ],
    },
    {
      org: cairo,
      name: "Water Rescue Bravo",
      type: "water_rescue",
      availability: "busy",
      at: offset(NASR_CITY, 2.4, 300),
      lastSeenMin: 12,
      silent: true,
      members: [
        { name: "Khaled Ibrahim", caps: ["water_rescue", "search_rescue"], lead: true },
        { name: "Rania Gamal", caps: ["water_rescue", "first_aid"] },
      ],
    },
    {
      org: cairo,
      name: "Fire Unit 3",
      type: "fire",
      availability: "available",
      at: offset(HELIOPOLIS, 1.6, 230),
      lastSeenMin: 0.4,
      members: [
        { name: "Mostafa Kamal", caps: ["fire_suppression", "heavy_lifting"], lead: true },
        { name: "Yasmin Adly", caps: ["fire_suppression", "first_aid"] },
        { name: "Sherif Hany", caps: ["heavy_lifting", "search_rescue"] },
      ],
    },
    {
      org: cairo,
      name: "Relief Volunteers East",
      type: "volunteer",
      volunteer: true,
      availability: "available",
      at: offset(NASR_CITY, 1.8, 90),
      lastSeenMin: 1,
      members: [
        { name: "Nour Elsayed", caps: ["logistics", "first_aid"], lead: true },
        { name: "Ziad Hamdy", caps: ["logistics"] },
        { name: "Farida Osman", caps: ["logistics"], onDuty: false },
      ],
    },
    // Giza Relief Alliance — deliberately metres from Cairo's teams so isolation is visible (§14.2).
    {
      org: giza,
      name: "Giza Medics",
      type: "medical",
      availability: "available",
      at: offset(NASR_CITY, 0.05, 10),
      lastSeenMin: 0.3,
      members: [{ name: "Adham Tawfik", email: "responder@giza-relief.test", caps: ["paramedic", "first_aid"], lead: true }],
    },
    {
      org: giza,
      name: "Giza Water Team",
      type: "water_rescue",
      availability: "available",
      at: offset(HELIOPOLIS, 0.9, 110),
      lastSeenMin: 0.6,
      members: [{ name: "Mai Fouad", caps: ["water_rescue", "search_rescue"], lead: true }],
    },
  ];

  const teamByName: Record<string, TeamRec> = {};
  for (const s of teamSpecs) {
    const teamId = newId("team");
    const members: TeamMember[] = s.members.map((m) => {
      const u = addUser(
        s.org,
        m.name,
        "responder",
        m.email ?? `${m.name.toLowerCase().replace(/\s+/g, ".")}@${s.org.slug}.test`,
        teamId,
      );
      u.on_duty = m.onDuty ?? true;
      return {
        user_id: u.id,
        name: m.name,
        is_lead: !!m.lead,
        on_duty: m.onDuty ?? true,
        capabilities: [
          ...m.caps.map((key) => ({ key, expires_at: key === "paramedic" ? in6months : undefined })),
          ...(m.expiredCaps ?? []).map((key) => ({ key, expires_at: expired })),
        ],
      };
    });
    const t: TeamRec = {
      id: teamId,
      organization_id: s.org.id,
      name: s.name,
      type: s.type,
      is_volunteer: !!s.volunteer,
      availability: s.availability,
      home_base: s.at,
      last_location: s.at,
      last_location_at: iso(now - minutes(s.lastSeenMin)),
      lead_id: members.find((m) => m.is_lead)?.user_id,
      members,
      tasks_completed_today: Math.floor(rnd() * 4),
      silent: s.silent,
      stale_level: s.silent ? 2 : 0,
    };
    db.teams.push(t);
    teamByName[s.name] = t;
  }

  // ---------- Incidents ----------
  const flood: Incident & Tenant = {
    id: newId("inc"),
    organization_id: cairo.id,
    title: "Flood Response – Cairo East",
    type: "flood",
    status: "active",
    center: { lat: 30.07, lng: 31.33 },
    radius_km: 4,
    commander_id: cairoAdmin.id,
    commander_name: cairoAdmin.name,
    created_at: iso(now - 2 * 86_400_000),
  };
  db.incidents.push(flood, {
    id: newId("inc"),
    organization_id: cairo.id,
    title: "Ring Road pile-up",
    type: "accident",
    status: "closed",
    center: { lat: 30.105, lng: 31.36 },
    radius_km: 1,
    commander_name: cairoAdmin.name,
    commander_id: cairoAdmin.id,
    created_at: iso(now - 5 * 86_400_000),
    closed_at: iso(now - 4.8 * 86_400_000),
  });
  db.incidents.push({
    id: newId("inc"),
    organization_id: giza.id,
    title: "Giza Rainstorm Relief",
    type: "flood",
    status: "active",
    center: giza.operating_area.center,
    radius_km: 3,
    created_at: iso(now - 86_400_000),
  });

  // ---------- Depots, resources ----------
  const depotSpecs: [Organization, string, LatLng][] = [
    [cairo, "Nasr City Depot", offset(NASR_CITY, 0.9, 10)],
    [cairo, "Heliopolis Depot", offset(HELIOPOLIS, 0.4, 300)],
    [cairo, "Abbassia Depot", { lat: 30.0705, lng: 31.282 }],
    [giza, "Giza East Depot", offset(NASR_CITY, 0.3, 180)],
  ];
  const depots = depotSpecs.map(([org, name, location]) => {
    const d = { id: newId("dep"), organization_id: org.id, name, location };
    db.depots.push(d);
    return d;
  });

  const unit = (org: Organization, type: string, name: string, depot: (typeof depots)[number], status: Resource["status"] = "available", owner?: TeamRec, reason?: string) => {
    const r: ResourceRec = {
      id: newId("res"),
      organization_id: org.id,
      kind: "unit",
      type,
      name,
      status,
      depot_id: depot.id,
      location: { ...depot.location },
      owner_team_id: owner?.id,
      incident_id: flood.id,
      unavailable_reason: reason,
    };
    db.resources.push(r);
    return r;
  };
  const a11 = unit(cairo, "ambulance", "Ambulance A-11", depots[0], "deployed", teamByName["Medic Team 1"]);
  unit(cairo, "ambulance", "Ambulance A-12", depots[1]);
  unit(cairo, "ambulance", "Ambulance A-14", depots[0]);
  unit(cairo, "ambulance", "Ambulance A-15", depots[2], "unavailable", undefined, "Brake repair");
  const b1 = unit(cairo, "boat", "Rescue Boat B-1", depots[1], "deployed", teamByName["Water Rescue Bravo"]);
  unit(cairo, "boat", "Rescue Boat B-2", depots[1]);
  unit(cairo, "generator", "Generator G-1", depots[2]);
  unit(cairo, "vehicle", "Pickup V-3", depots[0]);
  unit(giza, "ambulance", "Giza Ambulance 1", depots[3]);

  const stock = (org: Organization, type: string, name: string, depot: (typeof depots)[number], on_hand: number, unit_label: string, low: number, reserved = 0) => {
    db.resources.push({
      id: newId("stk"),
      organization_id: org.id,
      kind: "stock",
      type,
      name,
      depot_id: depot.id,
      location: { ...depot.location },
      on_hand,
      reserved,
      unit_label,
      low_stock_threshold: low,
      incident_id: flood.id,
    });
  };
  stock(cairo, "medicine_kit", "Medicine kits", depots[0], 42, "kits", 15);
  stock(cairo, "food_pack", "Food packs", depots[0], 260, "packs", 100, 40);
  stock(cairo, "water", "Drinking water", depots[1], 1800, "litres", 500);
  stock(cairo, "blanket", "Blankets", depots[1], 70, "blankets", 80);
  stock(cairo, "food_pack", "Food packs", depots[2], 90, "packs", 100);
  stock(cairo, "medicine_kit", "Medicine kits", depots[2], 12, "kits", 15);
  stock(giza, "water", "Drinking water", depots[3], 600, "litres", 200);

  // ---------- Shelters ----------
  const shelter = (org: Organization, name: string, location: LatLng, capacity: number, occupancy: number, facilities: Shelter["facilities"], contact: string) =>
    db.shelters.push({
      id: newId("shl"),
      organization_id: org.id,
      name,
      location,
      capacity,
      occupancy,
      status: occupancy >= capacity ? "full" : "open",
      facilities,
      contact,
    });
  shelter(cairo, "Al-Azhar Youth Centre", offset(NASR_CITY, 1.4, 150), 120, 64, ["food", "medical"], "Hany Saber · +20 100 555 0101");
  shelter(cairo, "Heliopolis Sporting Club Hall", offset(HELIOPOLIS, 0.6, 20), 80, 80, ["food", "accessibility"], "Reem Aziz · +20 100 555 0102");
  shelter(cairo, "Nasr City School No. 12", offset(NASR_CITY, 2.2, 60), 150, 21, ["food", "medical", "accessibility"], "Wael Fikry · +20 100 555 0103");
  shelter(giza, "Giza Community Hall", offset(NASR_CITY, 0.4, 250), 60, 18, ["food"], "Ola Nassar · +20 100 555 0201");

  // ---------- Reports and tasks ----------
  const orgUsers = (org: Organization) => db.users.filter((u) => u.organization_id === org.id);
  const dispatcherOf = (org: Organization) => orgUsers(org).find((u) => u.role === "dispatcher")!;

  const addReportTimeline = (orgId: ID, reportId: ID, type: string, at: number, extra: Partial<TimelineEvent> = {}) =>
    db.reportTimeline.push({ id: newId("rte"), organization_id: orgId, parent_id: reportId, type, occurred_at: iso(at), ...extra });
  const addTaskTimeline = (orgId: ID, taskId: ID, at: number, from: string | undefined, to: string, actor?: string, note?: string) =>
    db.taskTimeline.push({
      id: newId("tte"),
      organization_id: orgId,
      parent_id: taskId,
      type: "status_changed",
      from_status: from,
      to_status: to,
      actor_name: actor,
      note,
      occurred_at: iso(at),
    });

  const capableTeams = (org: Organization, caps: string[]) =>
    db.teams.filter(
      (t) =>
        t.organization_id === org.id &&
        caps.every((c) => t.members.some((m) => m.on_duty && m.capabilities.some((mc) => mc.key === c))),
    );

  const rulesFor = (org: Organization, cat: Category) => db.categoryRules[org.id].find((r) => r.category === cat)!;

  function seedReport(
    org: Organization,
    opts: {
      category: Category;
      priority?: Priority;
      status: ReportStatus;
      createdAt: number;
      at: LatLng;
      template?: { title: string; description: string };
      teamName?: string;
      taskStatus?: Task["status"];
      incident?: boolean;
      contact?: ReportContact;
      address?: string;
      source?: Report["source"];
    },
  ): ReportRec {
    const rule = rulesFor(org, opts.category);
    const priority = opts.priority ?? rule.default_priority;
    const tpl = opts.template ?? pick(REPORT_TEMPLATES[opts.category]);
    const created = opts.createdAt;
    const r: ReportRec = {
      id: newId("rep"),
      organization_id: org.id,
      reference_code: referenceCode(),
      incident_id: opts.incident === false || org.id !== cairo.id ? undefined : flood.id,
      title: tpl.title,
      description: tpl.description,
      category: opts.category,
      priority,
      status: opts.status,
      location: opts.at,
      address_text: opts.address ?? pick(STREETS),
      people_affected: 1 + Math.floor(rnd() * 6),
      source: opts.source ?? (rnd() > 0.3 ? "public" : "dispatcher"),
      created_at: iso(created),
      updated_at: iso(created),
      photo_count: Math.floor(rnd() * 3),
      contact: opts.contact ?? (rnd() > 0.25 ? { name: pick(["Mariam", "Hassan", "Fatma", "Mohamed", "Aya", "Ibrahim"]), phone: `+20 10${Math.floor(10_000_000 + rnd() * 89_999_999)}` } : undefined),
      untriaged_level: 0,
      merged_into_id: undefined,
    };
    db.reports.push(r);
    addReportTimeline(org.id, r.id, "created", created, { note: `Received via ${r.source}` });

    if (opts.status === "new") return r;

    const triagedAt = created + minutes(0.5 + rnd() * 3);
    r.triaged_at = iso(triagedAt);
    addReportTimeline(org.id, r.id, "triaged", triagedAt, {
      actor_name: dispatcherOf(org).name,
      from_status: "new",
      to_status: "triaged",
      note: `Priority ${priority}`,
    });
    if (opts.status === "triaged") return r;

    const caps = priority === "critical" && rule.critical_capabilities ? rule.critical_capabilities : rule.required_capabilities;
    const team = opts.teamName ? teamByName[opts.teamName] : pick(capableTeams(org, caps).length ? capableTeams(org, caps) : db.teams.filter((t) => t.organization_id === org.id));
    const assignedAt = triagedAt + minutes(0.5 + rnd() * 4);
    const taskStatus: Task["status"] =
      opts.taskStatus ?? (opts.status === "assigned" ? "pending" : opts.status === "in_progress" ? "en_route" : "completed");
    const t: TaskRec = {
      id: newId("tsk"),
      organization_id: org.id,
      report_id: r.id,
      incident_id: r.incident_id,
      assigned_team_id: team.id,
      status: taskStatus,
      required_capabilities: caps,
      instructions: `Respond to ${opts.category.replace("_", " ")} report at ${r.address_text}.`,
      created_at: iso(assignedAt),
      assigned_at: iso(assignedAt),
      escalation_level: 0,
      distance_km: undefined,
      trail: [],
    };
    addTaskTimeline(org.id, t.id, assignedAt, undefined, "pending", dispatcherOf(org).name, `Assigned to ${team.name}`);
    const steps: [keyof TaskRec, Task["status"], number][] = [
      ["accepted_at", "accepted", 0.3 + rnd() * 2.5],
      ["en_route_at", "en_route", 0.2 + rnd() * 1.5],
      ["on_site_at", "on_site", 4 + rnd() * 14],
      ["completed_at", "completed", 8 + rnd() * 45],
    ];
    const order: Task["status"][] = ["pending", "accepted", "en_route", "on_site", "completed"];
    let at = assignedAt;
    let prev: Task["status"] = "pending";
    for (const [field, st, dm] of steps) {
      if (order.indexOf(st) > order.indexOf(taskStatus)) break;
      at += minutes(dm);
      (t as Record<string, unknown>)[field] = iso(at);
      const actor = team.members.find((m) => m.is_lead)?.name;
      addTaskTimeline(org.id, t.id, at, prev, st, actor, st === "completed" ? "Situation handled" : undefined);
      prev = st;
    }
    if (taskStatus === "completed") {
      t.outcome = pick(["treated_on_site", "transported", "referred", "no_action_needed"] as const);
      t.resolution_note = "Team handled the situation; residents safe and informed.";
      t.people_helped = r.people_affected;
      r.resolved_at = t.completed_at;
      addReportTimeline(org.id, r.id, "resolved", at, { from_status: "in_progress", to_status: "resolved" });
    }
    if (taskStatus === "pending") t.escalation_deadline = iso(assignedAt + minutes(priority === "critical" ? 3 : 10));
    db.tasks.push(t);
    return r;
  }

  // History: 7 days of resolved/closed reports for analytics.
  const cats: Category[] = ["medical", "medical", "flood", "flood", "fire", "rescue", "food_water", "shelter", "road_block", "other"];
  for (let i = 0; i < 34; i++) {
    const cat = cats[i % cats.length];
    const daysAgo = 0.2 + rnd() * 6.8;
    seedReport(cairo, {
      category: cat,
      priority: rnd() > 0.8 ? "critical" : undefined,
      status: daysAgo > 3 ? "closed" : "resolved",
      createdAt: now - daysAgo * 86_400_000,
      at: offset(NASR_CITY, 0.3 + rnd() * 4, rnd() * 360),
    });
  }

  // Live queue — open reports in Nasr City / Heliopolis.
  const live = (category: Category, status: ReportStatus, minsAgo: number, km: number, bearing: number, extra: Partial<Parameters<typeof seedReport>[1]> = {}) =>
    seedReport(cairo, { category, status, createdAt: now - minutes(minsAgo), at: offset(NASR_CITY, km, bearing), ...extra });

  // Medic Team 1 is busy here, with A-11 deployed (vertical slice: closer, but busy).
  const busyMedical = live("medical", "in_progress", 22, 0.9, 30, { teamName: "Medic Team 1", taskStatus: "on_site" });
  // Water Rescue Bravo is en route but its device went quiet 12 min ago (stale).
  const staleFlood = live("flood", "in_progress", 35, 2.6, 310, { priority: "critical", teamName: "Water Rescue Bravo", taskStatus: "en_route", template: REPORT_TEMPLATES.flood[2] });
  live("fire", "triaged", 7, 1.9, 75);
  live("flood", "new", 4, 1.1, 250, { template: REPORT_TEMPLATES.flood[0] });
  // Duplicate pair: same category, ~80 m apart, 20 min apart (REP-4).
  const dupA = live("flood", "triaged", 26, 3.1, 0, { template: REPORT_TEMPLATES.flood[1], address: "El Nozha St, Heliopolis" });
  seedReport(cairo, {
    category: "flood",
    status: "new",
    createdAt: now - minutes(6),
    at: offset(dupA.location, 0.08, 90),
    template: { title: "Water in basement flats", description: "Basement apartments flooding on El Nozha St, people need help moving things." },
    address: "El Nozha St, Heliopolis",
  });
  live("food_water", "new", 13, 1.7, 100);
  live("road_block", "triaged", 18, 2.0, 200);
  live("shelter", "new", 9, 2.3, 140);
  live("medical", "triaged", 3, 1.5, 330, { priority: "medium", template: REPORT_TEMPLATES.medical[2] });
  live("rescue", "new", 1.5, 2.8, 20, { template: REPORT_TEMPLATES.rescue[1] });
  live("other", "new", 11, 3.4, 230, { priority: "low" });
  live("food_water", "assigned", 28, 1.2, 160, { teamName: "Relief Volunteers East", taskStatus: "accepted" });
  live("medical", "new", 0.7, 0.4, 260, { priority: "high", template: REPORT_TEMPLATES.medical[1] });
  live("flood", "new", 16, 2.1, 280, { priority: "medium", incident: true });

  // The deployed units belong to the active tasks above.
  const linkUnit = (res: ResourceRec, report: ReportRec, state: "deployed") => {
    const task = db.tasks.find((t) => t.report_id === report.id)!;
    db.assignments.push({
      id: newId("asg"),
      organization_id: res.organization_id,
      resource_id: res.id,
      resource_name: res.name,
      resource_type: res.type,
      kind: "unit",
      task_id: task.id,
      qty: 1,
      state,
      reserved_at: task.assigned_at!,
      deployed_at: task.accepted_at,
    });
  };
  linkUnit(a11, busyMedical, "deployed");
  linkUnit(b1, staleFlood, "deployed");

  // Team positions follow their active tasks.
  const busyTask = db.tasks.find((t) => t.report_id === busyMedical.id)!;
  teamByName["Medic Team 1"].last_location = offset(busyMedical.location, 0.02, 90);
  busyTask.trail = [teamByName["Medic Team 1"].home_base, teamByName["Medic Team 1"].last_location!];

  // A team holding an open task is busy.
  for (const t of db.tasks) {
    if (["pending", "accepted", "en_route", "on_site"].includes(t.status)) {
      const team = db.teams.find((x) => x.id === t.assigned_team_id);
      if (team) team.availability = "busy";
    }
  }

  // Giza reports — 15, close to Cairo's teams.
  for (let i = 0; i < 15; i++) {
    const cat = cats[(i * 3) % cats.length];
    const status: ReportStatus = i < 5 ? "new" : i < 7 ? "triaged" : "resolved";
    seedReport(giza, {
      category: cat,
      status,
      createdAt: now - (status === "resolved" ? rnd() * 5 * 86_400_000 : minutes(1 + rnd() * 30)),
      at: offset(NASR_CITY, 0.2 + rnd() * 2.5, rnd() * 360),
      teamName: status === "resolved" ? (cat === "flood" || cat === "rescue" ? "Giza Water Team" : "Giza Medics") : undefined,
    });
  }

  // A few audit and notification rows so those screens aren't empty.
  db.audit.push({
    id: newId("aud"),
    organization_id: cairo.id,
    actor_name: cairoAdmin.name,
    action: "org.updated",
    entity_type: "organization",
    entity_id: cairo.id,
    summary: "Escalation policy for critical set to 3 min accept timeout",
    created_at: iso(now - 86_400_000),
  });
  db.notifications.push({
    id: newId("ntf"),
    organization_id: cairo.id,
    user_id: cairoDispatcher.id,
    type: "team.stale",
    title: "Water Rescue Bravo location is stale",
    body: "No location update for 12 min on an active critical task.",
    link: `/teams`,
    priority: "high",
    created_at: iso(now - minutes(2)),
  });

  return db;
}
