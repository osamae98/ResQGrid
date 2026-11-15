// Singleton mock state + background loops (simulate_responders.py and the escalation scheduler).
import { createSeed, type DB } from "./db";
import { distanceKm, offset, stepTowards } from "./geo";
import { activeTaskOf, setTeamLocation, sweep } from "./services";

const g = globalThis as unknown as { __rqDb?: DB; __rqTimers?: NodeJS.Timeout[] };

export function getDb(): DB {
  if (!g.__rqDb) {
    g.__rqDb = createSeed();
    startLoops();
  }
  return g.__rqDb;
}

export function resetDb() {
  g.__rqDb = createSeed();
  return g.__rqDb;
}

function startLoops() {
  for (const t of g.__rqTimers ?? []) clearInterval(t);
  g.__rqTimers = [
    setInterval(() => {
      try {
        sweep(getDb());
      } catch (e) {
        console.error("[mock] sweep failed", e);
      }
    }, 5000),
    setInterval(() => {
      try {
        simulateResponders(getDb());
      } catch (e) {
        console.error("[mock] simulator failed", e);
      }
    }, 5000),
  ];
}

/** Moves seeded teams so the demo looks live. Moving teams report every 15 s, still ones every 60 s (LOC-1). */
function simulateResponders(db: DB) {
  const now = Date.now();
  for (const team of db.teams) {
    if (team.silent) continue;
    if (team.manual_location_until && team.manual_location_until > now) continue;
    if (!team.members.some((m) => m.on_duty)) continue;
    const task = activeTaskOf(db, team);
    const moving = task?.status === "en_route";
    const age = now - Date.parse(team.last_location_at ?? "0");
    if (age < (moving ? 15_000 : 60_000)) continue;
    const pos = team.last_location ?? team.home_base;
    let next = pos;
    if (moving) {
      const target = db.reports.find((r) => r.id === task!.report_id)!.location;
      // ~30 km/h over 15 s.
      next = stepTowards(pos, target, 0.125);
      if (distanceKm(next, target) < 0.03) next = target;
    } else if (!task || task.status !== "on_site") {
      // Small drift around their position while available.
      next = offset(pos, 0.01 + Math.random() * 0.02, Math.random() * 360);
    }
    setTeamLocation(db, team, next);
  }
}
