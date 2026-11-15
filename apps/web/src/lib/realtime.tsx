"use client";

// Real-time client (§9). The mock speaks SSE with the WS envelope; swap the transport for
// WebSocket when apps/api lands — consumers only see `useRealtime` and query invalidation.
import type { ConnectionState, EventEnvelope, LatLng, Team } from "@resqgrid/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { qk } from "./queries";

type Listener = (e: EventEnvelope) => void;

interface Realtime {
  state: ConnectionState;
  subscribe: (fn: Listener) => () => void;
}

const Ctx = createContext<Realtime>({ state: "offline", subscribe: () => () => {} });

export function RealtimeProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  const qc = useQueryClient();
  const [state, setState] = useState<ConnectionState>("reconnecting");
  const listeners = useRef(new Set<Listener>());
  const lastSeq = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!enabled) return;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;

    const invalidate = (...keys: ReadonlyArray<readonly unknown[]>) => keys.forEach((k) => qc.invalidateQueries({ queryKey: k }));

    const apply = (e: EventEnvelope) => {
      // Gap in the per-channel sequence → resync through REST.
      const prev = lastSeq.current[e.channel];
      lastSeq.current[e.channel] = e.seq;
      if (prev !== undefined && e.seq > prev + 1 && e.type !== "team.location_updated") {
        qc.invalidateQueries();
        return;
      }
      switch (e.type) {
        case "report.created":
        case "report.updated":
        case "report.merged":
          invalidate(qk.reports, qk.report(e.entity_id), qk.kpis, ["report-timeline", e.entity_id], qk.incidents);
          break;
        case "task.assigned":
        case "task.status_changed":
        case "task.escalated":
          invalidate(qk.tasks, qk.task(e.entity_id), ["task-timeline", e.entity_id], qk.reports, qk.kpis, qk.teams, qk.suggestions, qk.resources);
          break;
        case "team.location_updated": {
          // Hot path: patch the cache in place instead of refetching.
          const d = e.data as unknown as { team_id: string; lat: number; lng: number; ts: string };
          qc.setQueryData<Team[]>(qk.teams, (old) =>
            old?.map((t) => (t.id === d.team_id ? { ...t, last_location: { lat: d.lat, lng: d.lng } as LatLng, last_location_at: d.ts, is_stale: false } : t)),
          );
          qc.invalidateQueries({ queryKey: ["task-trail"] });
          break;
        }
        case "team.availability_changed":
        case "team.stale":
          invalidate(qk.teams, qk.suggestions, qk.kpis);
          break;
        case "resource.changed":
          invalidate(qk.resources, qk.kpis);
          break;
        case "shelter.changed":
          invalidate(qk.shelters, qk.kpis);
          break;
        case "comment.created": {
          const d = e.data as unknown as { parent_type: string; parent_id: string };
          invalidate(["comments", d.parent_type, d.parent_id]);
          break;
        }
        case "notification.created":
          invalidate(qk.notifications);
          break;
      }
      listeners.current.forEach((fn) => fn(e));
    };

    const connect = () => {
      es = new EventSource(api.eventsUrl(), { withCredentials: true });
      es.addEventListener("ready", () => {
        failures = 0;
        setState("live");
        // Anything missed while disconnected is refetched.
        qc.invalidateQueries();
      });
      es.onmessage = (m) => {
        try {
          apply(JSON.parse(m.data));
        } catch {}
      };
      es.onerror = () => {
        es?.close();
        failures++;
        setState(failures > 3 ? "offline" : "reconnecting");
        retry = setTimeout(connect, Math.min(15_000, 1000 * 2 ** failures));
      };
    };
    connect();
    return () => {
      clearTimeout(retry);
      es?.close();
    };
  }, [enabled, qc]);

  // While not live, fall back to 10 s polling (§12.1 availability).
  useEffect(() => {
    qc.setDefaultOptions({ queries: { ...qc.getDefaultOptions().queries, refetchInterval: state === "live" ? false : 10_000 } });
  }, [state, qc]);

  const subscribe = (fn: Listener) => {
    listeners.current.add(fn);
    return () => listeners.current.delete(fn);
  };

  return <Ctx.Provider value={{ state, subscribe }}>{children}</Ctx.Provider>;
}

export const useRealtime = () => useContext(Ctx);

export function useRealtimeEvent(fn: Listener) {
  const { subscribe } = useRealtime();
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => subscribe((e) => ref.current(e)), [subscribe]);
}

// One shared AudioContext. Browsers start it "suspended" until the user interacts with the page
// (autoplay policy), so a fresh tab or a reload would play nothing. We resume it on the first
// pointer/key event and expose the state so the UI can ask the user to turn sound on.
let audioCtx: AudioContext | undefined;
const soundListeners = new Set<() => void>();
const notifySound = () => soundListeners.forEach((fn) => fn());

function getAudio() {
  if (typeof window === "undefined") return undefined;
  if (!audioCtx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return undefined;
    audioCtx = new Ctor();
    audioCtx.onstatechange = notifySound;
  }
  return audioCtx;
}

/** Resume audio after a user gesture. Safe to call repeatedly. */
export function unlockSound() {
  const ctx = getAudio();
  if (ctx && ctx.state !== "running") ctx.resume().then(notifySound, () => {});
}

/** Whether alert sounds can play right now. Unlocks automatically on the first click or key press. */
export function useSoundReady() {
  const [ready, setReady] = useState(true);
  useEffect(() => {
    const ctx = getAudio();
    if (!ctx) return;
    const update = () => setReady(ctx.state === "running");
    soundListeners.add(update);
    update();
    const onGesture = () => unlockSound();
    window.addEventListener("pointerdown", onGesture);
    window.addEventListener("keydown", onGesture);
    return () => {
      soundListeners.delete(update);
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
  }, []);
  return ready;
}

/** Two-tone alert for new critical reports only (§13.1). */
export function playCriticalSound() {
  try {
    const ctx = getAudio();
    if (!ctx) return;
    if (ctx.state !== "running") ctx.resume().catch(() => {});
    [0, 0.22].forEach((t, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = i ? 660 : 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.2);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.21);
    });
  } catch {}
}
