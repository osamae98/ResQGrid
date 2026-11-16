"use client";

import { useEffect, useRef, useState } from "react";

/** Re-renders every `ms` so live timers ("unassigned 3:12") tick. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Returns a key that changes when `version` changes after first render — use it to replay a flash animation. */
export function useFlashKey(id: string, version: string) {
  const first = useRef(version);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (version !== first.current) {
      first.current = version;
      setN((x) => x + 1);
    }
  }, [version]);
  return `${id}-${n}`;
}

/** Copy to clipboard with a short "copied" state for inline feedback. `copied` is false again after `ms`. */
export function useCopy(ms = 2000) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const id = setTimeout(() => setState("idle"), ms);
    return () => clearTimeout(id);
  }, [state, ms]);
  const copy = (text: string) => {
    if (!navigator.clipboard) return setState("failed");
    navigator.clipboard.writeText(text).then(
      () => setState("copied"),
      () => setState("failed"),
    );
  };
  return { state, copy };
}

/**
 * Sets the browser tab to "<page> · RescueGrid" in the current language. Client pages can't export
 * `metadata`, and the tab title is how people find the right tab during an incident.
 */
export function usePageTitle(page?: string) {
  useEffect(() => {
    const want = page ? `${page} · RescueGrid` : "RescueGrid";
    document.title = want;
    // Next re-applies the static metadata title on soft navigations (e.g. ?report=…); put ours back.
    const obs = new MutationObserver(() => {
      if (document.title !== want) document.title = want;
    });
    obs.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => obs.disconnect();
  }, [page]);
}
