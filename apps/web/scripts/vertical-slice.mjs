// Runs the PRD §4.1 vertical slice against the API (mock by default): node scripts/vertical-slice.mjs [baseUrl]
const BASE = process.argv[2] ?? "http://localhost:3000/api/mock";
const jars = {};

async function call(who, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(jars[who] ? { Cookie: jars[who] } : {}), "X-Forwarded-For": "10.1.2.3" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const cookie = res.headers.get("set-cookie");
  if (cookie) jars[who] = cookie.split(";")[0];
  const text = await res.text();
  const json = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return json;
}
const login = (who, email) => call(who, "POST", "/api/v1/auth/login", { email, password: "demo1234" });
const check = (cond, msg) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) process.exitCode = 1;
};

await call("x", "POST", "/api/v1/dev/reset");
await login("disp", "dispatcher@cairo-rescue.test");
await login("resp", "responder@cairo-rescue.test");
await login("admin", "admin@cairo-rescue.test");
await login("viewer", "viewer@cairo-rescue.test");
await login("giza", "dispatcher@giza-relief.test");

// 1. Report
const { reference_code } = await call("public", "POST", "/public/v1/cairo-rescue/reports", {
  category: "medical",
  description: "Elderly man collapsed, not breathing well",
  location: { lat: 30.0561, lng: 31.3301 },
  name: "Mariam",
  phone: "+20 100 555 1234",
  life_threatening: true,
  fill_ms: 9000,
});
check(/^RQ-[0-9A-Z]{5}$/.test(reference_code), `public report accepted, reference ${reference_code}`);

// 2. Alert
const list = await call("disp", "GET", `/api/v1/reports?q=${reference_code}`);
const report = list.items[0];
check(report.priority === "critical" && report.status === "new", `stored as new + critical`);
const notes = await call("disp", "GET", "/api/v1/notifications");
check(notes.some((n) => n.type === "report.critical_alert" && n.body?.includes(reference_code)), "dispatcher got the critical alert");

// 3. Triage
const incidents = await call("disp", "GET", "/api/v1/incidents");
const triaged = await call("disp", "POST", `/api/v1/reports/${report.id}/triage`, { priority: "critical", incident_id: incidents.find((i) => i.status === "active").id });
check(triaged.status === "triaged", "triaged and linked to the active incident");

// 4. Suggest
const sugg = await call("disp", "GET", `/api/v1/reports/${report.id}/suggested-teams`);
const top = sugg[0];
const medic1 = sugg.find((s) => s.team_name === "Medic Team 1");
check(top.team_name === "Medic Team 2" && top.eligible, `top suggestion ${top.team_name} (${top.distance_km} km, paramedic ✓)`);
check(medic1 && !medic1.eligible && medic1.reasons.includes("busy") && medic1.distance_km < top.distance_km, `Medic Team 1 closer (${medic1?.distance_km} km) but greyed: ${medic1?.reasons}`);
const gizaSugg = sugg.some((s) => s.team_name.startsWith("Giza"));
check(!gizaSugg, "no Giza teams in Cairo suggestions (isolation)");

// 5. Assign + reserve Ambulance A-14
const resources = await call("disp", "GET", "/api/v1/resources");
const a14 = resources.find((r) => r.name === "Ambulance A-14");
let ineligible;
try {
  await call("disp", "POST", "/api/v1/tasks", { report_id: report.id, team_id: medic1.team_id, instructions: "x", required_capabilities: ["paramedic"], resources: [] });
} catch (e) {
  ineligible = e.message;
}
check(ineligible?.includes("TEAM_INELIGIBLE"), "dispatcher can't assign the busy team without an admin override (409)");
const task = await call("disp", "POST", "/api/v1/tasks", {
  report_id: report.id,
  team_id: top.team_id,
  instructions: "Elderly man collapsed. Approach from Abbas El Akkad.",
  required_capabilities: ["paramedic"],
  resources: [{ resource_id: a14.id }],
});
check(task.status === "pending" && task.resources[0]?.state === "reserved" && !!task.escalation_deadline, "task pending, A-14 reserved, escalation deadline set");
let doubleBook;
try {
  await call("disp", "POST", `/api/v1/tasks/${task.id}/resources`, { resource_id: a14.id });
} catch (e) {
  doubleBook = e.message;
}
check(doubleBook?.includes("RESOURCE_UNAVAILABLE"), "A-14 can't be reserved twice");
check((await call("disp", "GET", `/api/v1/reports/${report.id}`)).status === "assigned", "report → assigned");

// PII gating
const viewerReport = await call("viewer", "GET", `/api/v1/reports/${report.id}`);
let viewerPii;
try {
  await call("viewer", "GET", `/api/v1/reports/${report.id}/contact`);
} catch (e) {
  viewerPii = e.message;
}
check(!("contact" in viewerReport) && viewerPii?.includes("403"), "viewer gets no reporter contact");
const respContact = await call("resp", "GET", `/api/v1/reports/${report.id}/contact`);
check(respContact.phone === "+20 100 555 1234", "assigned responder can read the contact");
let gizaRead;
try {
  await call("giza", "GET", `/api/v1/reports/${report.id}`);
} catch (e) {
  gizaRead = e.message;
}
check(gizaRead?.includes("404"), "Giza dispatcher gets 404 on a Cairo report");

// 6. Accept and move
let t = await call("resp", "POST", `/api/v1/tasks/${task.id}/accept`);
const after = (await call("disp", "GET", "/api/v1/resources")).find((r) => r.id === a14.id);
check(t.status === "accepted" && after.status === "deployed" && !t.escalation_deadline, "accepted: A-14 deployed, escalation cancelled");
t = await call("resp", "POST", `/api/v1/tasks/${task.id}/en-route`);
await call("resp", "POST", "/api/v1/me/location", { points: [{ lat: 30.052, lng: 31.329, accuracy_m: 8, recorded_at: new Date().toISOString() }] });
check((await call("disp", "GET", `/api/v1/reports/${report.id}`)).status === "in_progress", "en route: report → in_progress");

// 7. Arrive and resolve
await call("resp", "POST", `/api/v1/tasks/${task.id}/on-site`);
let noNote;
try {
  await call("resp", "POST", `/api/v1/tasks/${task.id}/complete`, { outcome: "transported", resolution_note: "ok" });
} catch (e) {
  noNote = e.message;
}
check(noNote?.includes("RESOLUTION_NOTE_REQUIRED"), "completing without a proper note → 422");
t = await call("resp", "POST", `/api/v1/tasks/${task.id}/complete`, { outcome: "transported", resolution_note: "Patient stabilised, transported to Heliopolis Hospital" });
const final = await call("disp", "GET", `/api/v1/reports/${report.id}`);
const a14end = (await call("disp", "GET", "/api/v1/resources")).find((r) => r.id === a14.id);
const team = (await call("disp", "GET", "/api/v1/teams")).find((x) => x.id === top.team_id);
check(t.status === "completed" && final.status === "resolved", "task completed, report resolved");
check(a14end.status === "available" && team.availability === "available", "A-14 and Medic Team 2 back to available");

// 8. Review
const rt = await call("admin", "GET", "/api/v1/analytics/response-times?group_by=category");
const medical = rt.find((r) => r.group === "medical");
check(medical && medical.resolve.median_s !== null, `analytics: medical median time-to-resolve ${Math.round(medical.resolve.median_s / 60)} min over ${medical.count} reports`);
const timeline = await call("admin", "GET", `/api/v1/tasks/${task.id}/timeline`);
check(timeline.length >= 6, `task timeline has ${timeline.length} events`);
const audit = await call("admin", "GET", "/api/v1/audit-logs?action=pii");
check(audit.some((a) => a.summary.includes(reference_code)), "PII view recorded in the audit log");
