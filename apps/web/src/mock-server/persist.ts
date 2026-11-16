// Shared state for the mock backend when it runs on serverless hosting (Vercel).
//
// Locally there is one Node process, so the DB lives in memory (state.ts) and events go straight
// to open SSE streams (bus.ts). On Vercel several instances serve requests at once, each with its
// own memory, so without this a report created on one instance is missing on the next request.
//
// With Upstash Redis configured, every request syncs the in-memory DB with Redis first, writes
// hold a short lock and save afterwards, the background loops run as a "tick" inside requests,
// and events are appended to a Redis list that every instance's SSE streams poll.
import type { EventEnvelope, ID, Role } from "@resqgrid/api-client";
import { Redis } from "@upstash/redis";
import type { Audience } from "./bus";
import type { DB } from "./db";

const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

export const persistent = !!(url && token);
const redis = persistent ? new Redis({ url: url!, token: token!, automaticDeserialization: false }) : undefined;

const K = { state: "rq:state", ver: "rq:ver", lock: "rq:lock", events: "rq:events" };
const TICK_MS = 5000;
const EVENTS_KEPT = 300;

export interface StoredEvent {
  eid: number;
  env: EventEnvelope;
  audience: Audience;
}

interface Snapshot {
  db: DB;
  ids: number;
  tick: number;
}

const g = globalThis as unknown as {
  __rqDb?: DB;
  __rqIdCounter?: number;
  __rqVer?: number;
  __rqTick?: number;
  __rqPending?: { env: EventEnvelope; audience: Audience }[];
};

/** bus.publish hands events here when persistent; they're written to Redis after the request saves. */
export function queueEvent(env: EventEnvelope, audience: Audience) {
  (g.__rqPending ??= []).push({ env, audience });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function lock(): Promise<string> {
  const id = Math.random().toString(36).slice(2);
  for (let i = 0; i < 40; i++) {
    if ((await redis!.set(K.lock, id, { nx: true, px: 5000 })) === "OK") return id;
    await sleep(75);
  }
  throw new Error("mock state is busy, try again");
}

async function unlock(id: string) {
  // Only release our own lock (it may have expired and been taken by another instance).
  if ((await redis!.get<string>(K.lock)) === id) await redis!.del(K.lock);
}

/** Pull the latest snapshot if another instance saved since we last looked. Returns false if Redis is empty. */
async function pull(): Promise<boolean> {
  const ver = Number((await redis!.get<string>(K.ver)) ?? 0);
  if (!ver) return false;
  if (ver === g.__rqVer && g.__rqDb) return true;
  const raw = await redis!.get<string>(K.state);
  if (!raw) return false;
  const snap = JSON.parse(raw) as Snapshot;
  g.__rqDb = snap.db;
  g.__rqIdCounter = snap.ids;
  g.__rqTick = snap.tick;
  g.__rqVer = ver;
  return true;
}

async function push() {
  const ver = (g.__rqVer ?? 0) + 1;
  const snap: Snapshot = { db: g.__rqDb!, ids: g.__rqIdCounter ?? 100_000, tick: g.__rqTick ?? 0 };
  const pending = g.__rqPending ?? [];
  g.__rqPending = [];
  const p = redis!.pipeline();
  p.set(K.state, JSON.stringify(snap));
  p.set(K.ver, String(ver));
  if (pending.length) {
    // eid sorts by save, then by order within the save, so streams can resume after the last one they sent.
    p.rpush(K.events, ...pending.map((e, i) => JSON.stringify({ eid: ver * 1000 + i, ...e } satisfies StoredEvent)));
    p.ltrim(K.events, -EVENTS_KEPT, -1);
  }
  await p.exec();
  g.__rqVer = ver;
}

/**
 * Runs one mock API request against shared state. `write` requests (anything but GET) hold the lock
 * and save; a GET also takes the lock when the background tick is due, so loops keep running on Vercel.
 */
export async function withState<T>(
  write: boolean,
  run: () => T,
  hooks: { seed: () => DB; tick: (db: DB) => void },
): Promise<T> {
  if (!persistent) return run();

  const tickDue = () => Date.now() - (g.__rqTick ?? 0) > TICK_MS;
  const fresh = await pull();
  if (!write && fresh && !tickDue()) return run();

  const id = await lock();
  try {
    if (!(await pull())) {
      g.__rqDb = hooks.seed();
      g.__rqVer = 0;
    }
    g.__rqPending = [];
    if (tickDue()) {
      g.__rqTick = Date.now();
      try {
        hooks.tick(g.__rqDb!);
      } catch (e) {
        console.error("[mock] tick failed", e);
      }
    }
    const out = run();
    await push();
    return out;
  } finally {
    await unlock(id);
  }
}

/** Latest event id, so a new stream only sends what happens after it connects. */
export async function lastEventId(): Promise<number> {
  const last = await redis!.lrange<string>(K.events, -1, -1);
  return last.length ? (JSON.parse(last[0]) as StoredEvent).eid : 0;
}

/** Events newer than `after` that this user may see (same org, and in the audience by role or id). */
export async function eventsSince(after: number, who: { orgId: ID; userId: ID; role: Role }): Promise<StoredEvent[]> {
  const raw = await redis!.lrange<string>(K.events, 0, -1);
  return raw
    .map((s) => JSON.parse(s) as StoredEvent)
    .filter(
      (e) =>
        e.eid > after &&
        e.env.org_id === who.orgId &&
        (e.audience.roles?.includes(who.role) || e.audience.userIds?.includes(who.userId)),
    );
}

/** Cheap change check for SSE polling: one GET instead of reading the event list every time. */
export async function currentVersion(): Promise<number> {
  return Number((await redis!.get<string>(K.ver)) ?? 0);
}
