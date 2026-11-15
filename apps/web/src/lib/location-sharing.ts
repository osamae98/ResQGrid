"use client";

// Responder location streaming (LOC-1): every 15 s while moving, 60 s while still,
// queued in localStorage when offline and flushed in a batch on reconnect.
import { useEffect, useRef, useState } from "react";
import { api } from "./api";

type Point = { lat: number; lng: number; accuracy_m: number; speed?: number; heading?: number; recorded_at: string };
export type SharingState = "off" | "starting" | "on" | "denied" | "unavailable";

const KEY = "rq.locationQueue";
const readQueue = (): Point[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
};
const writeQueue = (q: Point[]) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(q.slice(-200)));
  } catch {}
};

export function useLocationSharing(enabled: boolean) {
  const [state, setState] = useState<SharingState>("off");
  const [last, setLast] = useState<Point>();
  const [queued, setQueued] = useState(0);
  const lastSent = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setState("off");
      return;
    }
    if (!("geolocation" in navigator)) {
      setState("unavailable");
      return;
    }
    setState("starting");

    const flush = async () => {
      const q = readQueue();
      if (!q.length || !navigator.onLine) return setQueued(q.length);
      try {
        await api.location.push(q);
        writeQueue([]);
        setQueued(0);
      } catch {
        setQueued(q.length);
      }
    };

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setState("on");
        const p: Point = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy_m: Math.round(pos.coords.accuracy),
          speed: pos.coords.speed ?? undefined,
          heading: pos.coords.heading ?? undefined,
          recorded_at: new Date(pos.timestamp).toISOString(),
        };
        setLast(p);
        const moving = (p.speed ?? 0) > 1;
        if (Date.now() - lastSent.current < (moving ? 15_000 : 60_000)) return;
        lastSent.current = Date.now();
        writeQueue([...readQueue(), p]);
        void flush();
      },
      (err) => setState(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: true, maximumAge: 10_000 },
    );
    window.addEventListener("online", flush);
    void flush();
    return () => {
      navigator.geolocation.clearWatch(id);
      window.removeEventListener("online", flush);
    };
  }, [enabled]);

  return { state, last, queued };
}
