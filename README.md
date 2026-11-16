# RescueGrid frontend

Web app for the RescueGrid MVP (PRD v3). The backend doesn't exist yet, so the app ships with an
in-process **mock API** that speaks the PRD's REST and event shapes. Pointing the app at the real
FastAPI service later is a config change.

```
resqgrid/
├─ apps/web                 Next.js 15 (App Router) · TypeScript · Tailwind v4 · TanStack Query · react-leaflet · Recharts
│  ├─ src/app/(console)     Staff console: dispatch, map, board, reports, incidents, teams, resources, shelters, analytics, settings, audit
│  ├─ src/app/responder     Mobile responder view (PWA manifest)
│  ├─ src/app/r/[slug]      Public report form + status lookup (no login)
│  ├─ src/app/api/mock      Mock backend entry (delete when apps/api exists)
│  └─ src/mock-server       Seed data + services mirroring PRD rules
└─ packages/api-client      Shared types + typed client (to be generated from OpenAPI later)
```

## Run

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

Sign in with any demo account on the login page (password `demo1234`). The public form is at
`/r/cairo-rescue`.

| Role | Cairo Rescue Network |
|---|---|
| Admin | admin@cairo-rescue.test |
| Dispatcher | dispatcher@cairo-rescue.test |
| Responder (Medic Team 2) | responder@cairo-rescue.test |
| Volunteer coordinator | coordinator@cairo-rescue.test |
| Viewer | viewer@cairo-rescue.test |

The same roles exist for `@giza-relief.test`. Giza's teams sit metres from Cairo's, so tenant isolation shows on the map.

### Feature flags

Set in `apps/web/.env.development` (loaded by `pnpm dev` only) or the deploy environment:

| Variable | Default | Effect |
|---|---|---|
| `NEXT_PUBLIC_DEMO_MODE` | off (`true` in dev) | Demo accounts on login, **Simulate critical report**, **Reset demo data** |
| `NEXT_PUBLIC_PHOTO_UPLOAD` | off | Photo picker on the public form. Keep off until the presign endpoint exists |
| `NEXT_PUBLIC_EMERGENCY_NUMBER` | `123` | Number shown to reporters who answer "life in danger" |

## Demo the vertical slice (PRD §4.1)

1. Open `/r/cairo-rescue` on a phone-sized window, pick **Medical**, answer **Yes** to "life in danger", drop a pin and send.
2. In another window, sign in as the dispatcher: the report appears in the queue with sound and a toast. Or click **Simulate critical report**.
3. Confirm triage. Suggestions rank **Medic Team 2** first. **Medic Team 1** is closer but greyed out as *busy*.
4. Tick **Ambulance A-14** and assign.
5. Sign in as the responder (a private window keeps both sessions): **Accept → I'm on my way → Arrived → Complete**.
6. Sign in as the admin and open **Analytics** and the task timeline.

The same flow runs headless:

```bash
node apps/web/scripts/vertical-slice.mjs
```

The script resets the mock data and checks 22 PRD rules, including suggestion order, 409 on ineligible
assignment and double booking, PII gating, cross-org 404, 422 on a missing resolution note, and resource return.

## What the mock implements

- Report, task and unit state machines; report status follows its tasks; `409 INVALID_TRANSITION`.
- Capability-aware suggestions: available + fresh + capable, ranked by distance; ineligible teams listed with reasons.
- Admin override with reason; dispatcher override requests (5 min expiry, one-click approve).
- Unit and stock reservation, deploy on accept, return/consume on complete, release on cancel.
- Shelter occupancy with capacity override and automatic full/open status.
- Escalation sweeper (untriaged critical, unaccepted tasks L1/L2, accepted but not en route) and stale-location flags.
- Duplicate detection (same category, 200 m, 60 min), merge and undo.
- Reporter PII in a separate endpoint, role-gated and audited. Rate limits, honeypot and minimum fill time on public intake.
- Live events over SSE with the PRD envelope (`type, org_id, channel, entity_id, seq, ts, data`), gap detection, and fallback to 10 s polling.
- A responder simulator moves seeded teams so the map looks live.

State is in memory. Restarting the dev server, or **Settings → Reset demo data**, reseeds it.

## Switching to the real backend

1. Set `NEXT_PUBLIC_API_URL` to the API origin. The client calls `/api/v1/...` and `/public/v1/...` under it.
2. Swap the SSE transport in `src/lib/realtime.tsx` for `WS /ws`. Consumers only use `useRealtime` and query invalidation.
3. Replace `packages/api-client/src/types.ts` with types generated from the OpenAPI spec.
4. Delete `src/app/api/mock` and `src/mock-server`.

## Not done yet

- Photo upload is local preview only (needs the presign endpoint). CAPTCHA is a settings toggle placeholder.
- Arabic covers the shell, statuses and the public form. The full pass is M3.
- No offline queue for responder status actions (location points are queued). The service worker is Phase 2.
- No marker clustering on the map.
- No automated UI tests yet. The PRD's Playwright slice can follow `scripts/vertical-slice.mjs`.
