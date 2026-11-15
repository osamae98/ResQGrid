import type { ID, ISODate } from "./types";

// Real-time event catalog, PRD v3 §9.
export type EventType =
  | "report.created"
  | "report.updated"
  | "report.merged"
  | "report.critical_alert"
  | "task.assigned"
  | "task.status_changed"
  | "task.escalated"
  | "team.location_updated"
  | "team.availability_changed"
  | "team.stale"
  | "resource.changed"
  | "shelter.changed"
  | "comment.created"
  | "notification.created";

export interface EventEnvelope<T = Record<string, unknown>> {
  type: EventType;
  org_id: ID;
  /** org:{id}, team:{id} or user:{id} */
  channel: string;
  entity_id: ID;
  /** Per-channel sequence, used to detect gaps and resync. */
  seq: number;
  ts: ISODate;
  data: T;
}

export type ConnectionState = "live" | "reconnecting" | "offline";
