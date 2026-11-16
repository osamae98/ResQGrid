// Mock backend entry point. Delete this folder (and src/mock-server) once apps/api serves /api/v1.
import type { NextRequest } from "next/server";
import type { EventEnvelope } from "@resqgrid/api-client";
import { subscribers, type Subscriber } from "@/mock-server/bus";
import { currentVersion, eventsSince, lastEventId, persistent, withState } from "@/mock-server/persist";
import { authenticate, handle, SESSION_COOKIE } from "@/mock-server/router";
import { seed, tick } from "@/mock-server/state";

const hooks = { seed, tick };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// SSE streams end here on Vercel; the browser reconnects (retry: 3000) and resumes.
export const maxDuration = 300;

async function dispatch(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const sessionUserId = req.cookies.get(SESSION_COOKIE)?.value;

  if (path.join("/") === "events" && req.method === "GET") return sse(req, sessionUserId);

  let body: Record<string, unknown> = {};
  if (req.method !== "GET" && req.method !== "DELETE") body = await req.json().catch(() => ({}));
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "127.0.0.1";

  // Small artificial latency so loading states are visible.
  await new Promise((r) => setTimeout(r, 60 + Math.random() * 120));

  const res = await withState(req.method !== "GET", () => handle({ method: req.method, path: "/" + path.join("/"), query: req.nextUrl.searchParams, body, ip, sessionUserId }), hooks);
  const headers = new Headers();
  if (res.setSession !== undefined) {
    headers.append(
      "Set-Cookie",
      res.setSession
        ? `${SESSION_COOKIE}=${res.setSession}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 86400}`
        : `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    );
  }
  if (res.status === 429) {
    const retry = (res.body as { error?: { details?: { retry_after_s?: number } } })?.error?.details?.retry_after_s;
    if (retry) headers.set("Retry-After", String(retry));
  }
  if (res.csv !== undefined) {
    headers.set("Content-Type", "text/csv; charset=utf-8");
    headers.set("Content-Disposition", `attachment; filename="${path[path.length - 1]}"`);
    return new Response(res.csv, { status: res.status, headers });
  }
  if (res.status === 204 || res.body === undefined) return new Response(null, { status: res.status === 200 ? 204 : res.status, headers });
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(res.body), { status: res.status, headers });
}

/** Server-sent events stand in for WS /ws; same envelope, heartbeat every 25 s. */
async function sse(req: NextRequest, sessionUserId?: string) {
  const user = await withState(false, () => authenticate(sessionUserId), hooks);
  if (!user) return new Response(JSON.stringify({ error: { code: "UNAUTHENTICATED" } }), { status: 401 });
  // Start after the newest event, so a stream only sends what happens once it is open.
  const start = persistent ? { eid: await lastEventId(), ver: await currentVersion() } : { eid: 0, ver: 0 };
  const enc = new TextEncoder();
  let sub: Subscriber | undefined;
  let heartbeat: NodeJS.Timeout | undefined;
  let poll: NodeJS.Timeout | undefined;
  const stream = new ReadableStream({
    start(controller) {
      const write = (s: string) => {
        try {
          controller.enqueue(enc.encode(s));
        } catch {
          cleanup();
        }
      };
      const send = (e: EventEnvelope) => write(`data: ${JSON.stringify(e)}\n\n`);
      if (persistent) {
        // Events can be published on any instance: poll the shared list instead of an in-memory set.
        const who = { orgId: user.organization_id, userId: user.id, role: user.role };
        let busy = false;
        let lastEid = start.eid;
        let lastVer = start.ver;
        poll = setInterval(async () => {
          if (busy) return;
          busy = true;
          try {
            const ver = await currentVersion();
            if (ver === lastVer) return;
            lastVer = ver;
            for (const e of await eventsSince(lastEid, who)) {
              send(e.env);
              lastEid = e.eid;
            }
          } catch (e) {
            console.error("[mock] event poll failed", e);
          } finally {
            busy = false;
          }
        }, 2000);
      } else {
        sub = { orgId: user.organization_id, userId: user.id, role: user.role, send };
        subscribers.add(sub);
      }
      write(`retry: 3000\n\n`);
      write(`event: ready\ndata: {}\n\n`);
      heartbeat = setInterval(() => write(`: heartbeat\n\n`), 25_000);
      req.signal.addEventListener("abort", cleanup);
    },
    cancel: cleanup,
  });
  function cleanup() {
    if (sub) subscribers.delete(sub);
    if (heartbeat) clearInterval(heartbeat);
    if (poll) clearInterval(poll);
  }
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}

export { dispatch as GET, dispatch as POST, dispatch as PATCH, dispatch as PUT, dispatch as DELETE };
