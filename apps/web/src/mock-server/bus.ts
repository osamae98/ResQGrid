// Stand-in for the outbox → Redis pub/sub → gateway fan-out (PRD §9).
// The gateway re-checks org_id and role on every outbound event.
import type { EventEnvelope, EventType, ID, Role } from "@resqgrid/api-client";
import type { DB } from "./db";
import { persistent, queueEvent } from "./persist";

export interface Subscriber {
  orgId: ID;
  userId: ID;
  role: Role;
  send: (e: EventEnvelope) => void;
}

export interface Audience {
  roles?: Role[];
  userIds?: ID[];
}

const g = globalThis as unknown as { __rqSubs?: Set<Subscriber> };
export const subscribers: Set<Subscriber> = (g.__rqSubs ??= new Set());

// Location updates are throttled to one per team per 5 s (§9).
const lastLocationSent = new Map<ID, number>();

export function publish(db: DB, orgId: ID, type: EventType, entityId: ID, data: unknown, audience: Audience) {
  if (type === "team.location_updated") {
    const last = lastLocationSent.get(entityId) ?? 0;
    if (Date.now() - last < 5000) return;
    lastLocationSent.set(entityId, Date.now());
  }
  const channel = `org:${orgId}`;
  const seq = (db.seq[channel] = (db.seq[channel] ?? 0) + 1);
  const env: EventEnvelope = {
    type,
    org_id: orgId,
    channel,
    entity_id: entityId,
    seq,
    ts: new Date().toISOString(),
    data: data as Record<string, unknown>,
  };
  // Serverless: other instances hold the open streams, so events go through Redis (persist.ts).
  if (persistent) return queueEvent(env, audience);
  for (const s of subscribers) {
    if (s.orgId !== orgId) continue;
    const byRole = audience.roles?.includes(s.role);
    const byUser = audience.userIds?.includes(s.userId);
    if (byRole || byUser) s.send(env);
  }
}
