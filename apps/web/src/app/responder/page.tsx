"use client";

import { OUTCOMES, type Outcome, type ReportContact, type Task } from "@resqgrid/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronRight, Eye, LogOut, MapPin, MapPinOff, Navigation, Phone, Plus, Radio, Undo2, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CapabilityChip, CategoryLabel, PriorityBadge, TaskStatusBadge } from "@/components/domain/badges";
import { NewReportDialog } from "@/components/dispatch/new-report-dialog";
import { LiveMap } from "@/components/map/live-map";
import { LiveBadge, SoundBanner } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api, errorMessage } from "@/lib/api";
import { ago, dateTime, km, OUTCOME_LABEL, since } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { useT } from "@/lib/i18n";
import { useLocationSharing } from "@/lib/location-sharing";
import { qk, useTasks, useTeams } from "@/lib/queries";
import { playCriticalSound, useRealtimeEvent } from "@/lib/realtime";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

const ORDER = { pending: 0, on_site: 1, en_route: 2, accepted: 3 } as Record<string, number>;
const UNDO_MS = 5000;

export default function ResponderHome() {
  const t = useT();
  const { user } = useSession();
  const qc = useQueryClient();
  const router = useRouter();
  const tasks = useTasks({ mine: true });
  const teams = useTeams();
  const team = teams.data?.find((x) => x.id === user?.team_id);
  const onDuty = !!team?.members.find((m) => m.user_id === user?.id)?.on_duty;
  const sharing = useLocationSharing(onDuty);
  const [fieldReport, setFieldReport] = useState(false);

  useRealtimeEvent((e) => {
    if (e.type === "task.assigned") {
      playCriticalSound();
      navigator.vibrate?.([200, 100, 200]);
      toast.info(t("New task assigned"), { duration: 10_000 });
    }
  });

  const active = useMemo(
    () => tasks.data?.filter((x) => ["pending", "accepted", "en_route", "on_site"].includes(x.status) && x.assigned_team_id === user?.team_id).sort((a, b) => ORDER[a.status] - ORDER[b.status]),
    [tasks.data, user?.team_id],
  );
  const [pickedId, setPickedId] = useState<string>();
  // A newly assigned (pending) task always comes first so it can't be missed; otherwise keep the one the responder picked.
  const current = active?.find((x) => x.status === "pending") ?? active?.find((x) => x.id === pickedId) ?? active?.[0];
  const others = active?.filter((x) => x.id !== current?.id) ?? [];
  const history = tasks.data?.filter((x) => x.status === "completed" || x.status === "cancelled").slice(0, 10) ?? [];

  const duty = useMutation({
    mutationFn: (on: boolean) => api.location.setDuty(on),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.teams }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const logout = useMutation({ mutationFn: api.auth.logout, onSuccess: () => (qc.clear(), router.replace("/login")) });

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col bg-background">
      <header className="sticky top-0 z-[600] flex flex-col gap-2 border-b bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{team?.name ?? t("No team")}</div>
            <div className="truncate text-xs text-muted-foreground">{user?.name}</div>
          </div>
          <LiveBadge />
          <Button variant="ghost" size="icon" onClick={() => logout.mutate()} aria-label={t("Sign out")}>
            <LogOut />
          </Button>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex flex-1 items-center gap-2 text-sm font-medium">
            <Switch checked={onDuty} onCheckedChange={(v) => duty.mutate(v)} disabled={duty.isPending} aria-label={t("On duty")} />
            {onDuty ? t("On duty") : t("Off duty")}
          </label>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium",
              sharing.state === "on" ? "bg-available/15 text-available" : onDuty ? "bg-high/15 text-high" : "bg-muted text-muted-foreground",
            )}
            role="status"
          >
            {sharing.state === "on" ? <MapPin className="size-3.5" /> : <MapPinOff className="size-3.5" />}
            {sharing.state === "on"
              ? `${t("Location sharing on")}${sharing.queued ? ` · ${sharing.queued} ${t("queued")}` : ""}`
              : sharing.state === "denied"
                ? t("Location blocked — allow it in settings")
                : sharing.state === "starting"
                  ? t("Getting location…")
                  : onDuty
                    ? t("Location unavailable")
                    : t("Location sharing off")}
          </span>
        </div>
      </header>
      {onDuty ? <SoundBanner /> : null}

      <main className="flex flex-1 flex-col gap-4 p-4">
        {current ? (
          <CurrentTask key={current.id} task={current} teamLocation={team?.last_location} />
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed p-8 text-center">
            <Radio className="size-8 text-muted-foreground" />
            <p className="font-medium">{t("No active task")}</p>
            <p className="text-sm text-muted-foreground">{onDuty ? t("You'll hear a tone when a task is assigned.") : t("Go on duty to receive tasks.")}</p>
          </div>
        )}

        {others.length ? (
          <section>
            <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
              {t("Other open tasks")} ({others.length})
            </h2>
            <ul className="divide-y rounded-xl border">
              {others.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setPickedId(o.id);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                    className="flex min-h-14 w-full items-center gap-2 p-3 text-start text-sm hover:bg-accent/50"
                  >
                    <PriorityBadge priority={o.report.priority} />
                    <TaskStatusBadge status={o.status} />
                    <span className="flex-1 truncate" dir="auto">{o.report.title}</span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <Button variant="outline" size="lg" className="h-12" onClick={() => setFieldReport(true)}>
          <Plus /> {t("Field report")}
        </Button>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{t("History")}</h2>
          <ul className="divide-y rounded-xl border">
            {history.length === 0 ? <li className="p-3 text-sm text-muted-foreground">{t("No completed tasks yet.")}</li> : null}
            {history.map((h) => (
              <li key={h.id}>
                <details className="group">
                  <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 p-3 text-sm [&::-webkit-details-marker]:hidden">
                    <TaskStatusBadge status={h.status} />
                    <span className="flex-1 truncate" dir="auto">{h.report.title}</span>
                    <span className="text-xs text-muted-foreground">{ago(h.completed_at ?? h.cancelled_at)}</span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90 rtl:rotate-180 rtl:group-open:rotate-90" aria-hidden />
                  </summary>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-3 pb-3 text-xs">
                    <dt className="text-muted-foreground">{t("Reference")}</dt>
                    <dd className="font-mono">{h.report.reference_code}</dd>
                    {h.report.address_text ? (
                      <>
                        <dt className="text-muted-foreground">{t("Location")}</dt>
                        <dd dir="auto">{h.report.address_text}</dd>
                      </>
                    ) : null}
                    {h.outcome ? (
                      <>
                        <dt className="text-muted-foreground">{t("Outcome")}</dt>
                        <dd>{t(OUTCOME_LABEL[h.outcome])}</dd>
                      </>
                    ) : null}
                    {h.people_helped !== undefined ? (
                      <>
                        <dt className="text-muted-foreground">{t("People helped")}</dt>
                        <dd>{h.people_helped}</dd>
                      </>
                    ) : null}
                    {h.resolution_note ? (
                      <>
                        <dt className="text-muted-foreground">{t("Note")}</dt>
                        <dd className="whitespace-pre-wrap" dir="auto">{h.resolution_note}</dd>
                      </>
                    ) : null}
                    <dt className="text-muted-foreground">{h.status === "completed" ? t("Completed") : t("Cancelled")}</dt>
                    <dd>{dateTime(h.completed_at ?? h.cancelled_at)}</dd>
                  </dl>
                </details>
              </li>
            ))}
          </ul>
        </section>
      </main>
      <NewReportDialog open={fieldReport} onOpenChange={setFieldReport} />
    </div>
  );
}

function CurrentTask({ task: t, teamLocation }: { task: Task; teamLocation?: { lat: number; lng: number } }) {
  const tr = useT();
  const qc = useQueryClient();
  const now = useNow();
  const [declineOpen, setDeclineOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [contact, setContact] = useState<ReportContact>();

  const inv = () => ["tasks", "task", "teams"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const act = useMutation({
    mutationFn: (fn: () => Promise<Task>) => fn(),
    onSuccess: inv,
    onError: (e) => (toast.error(errorMessage(e)), inv()),
  });
  const reveal = useMutation({ mutationFn: () => api.reports.contact(t.report_id), onSuccess: setContact, onError: (e) => toast.error(errorMessage(e)) });

  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${t.report.location.lat},${t.report.location.lng}`;
  const next =
    t.status === "pending"
      ? { label: tr("Accept"), icon: CheckCircle2, run: () => api.tasks.accept(t.id), undoable: false }
      : t.status === "accepted"
        ? { label: tr("I'm on my way"), icon: Navigation, run: () => api.tasks.enRoute(t.id), undoable: true }
        : t.status === "en_route"
          ? { label: tr("Arrived"), icon: MapPin, run: () => api.tasks.onSite(t.id), undoable: true }
          : { label: tr("Complete"), icon: CheckCircle2, run: undefined, undoable: false };

  // Status taps can't be reversed on the server, so "On my way" and "Arrived" wait UNDO_MS
  // before sending. Leaving the screen sends right away rather than dropping the update.
  const [queued, setQueued] = useState<{ label: string; run: () => Promise<Task>; at: number }>();
  const queuedRef = useRef(queued);
  queuedRef.current = queued;
  useEffect(() => {
    if (!queued) return;
    const id = setTimeout(() => {
      setQueued(undefined);
      act.mutate(queued.run);
    }, Math.max(0, queued.at + UNDO_MS - Date.now()));
    return () => clearTimeout(id);
  }, [queued]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () => () => {
      if (queuedRef.current) queuedRef.current.run().catch(() => {});
    },
    [],
  );
  // `now` ticks once a second, so it can lag the tap; clamp to the window.
  const secondsLeft = queued ? Math.min(UNDO_MS / 1000, Math.max(1, Math.ceil((queued.at + UNDO_MS - now) / 1000))) : 0;

  return (
    <article className={cn("flex flex-col overflow-hidden rounded-2xl border bg-card shadow-sm", t.report.priority === "critical" && "border-critical", t.escalation_level > 0 && "ring-2 ring-critical")}>
      <div className="flex flex-col gap-2 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <PriorityBadge priority={t.report.priority} />
          <TaskStatusBadge status={t.status} />
          <CategoryLabel category={t.report.category} />
          <span className="ms-auto font-mono text-xs text-muted-foreground">{t.report.reference_code}</span>
        </div>
        <h1 className="text-lg font-semibold leading-snug" dir="auto">{t.report.title}</h1>
        <p className="flex items-start gap-1.5 text-sm">
          <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>
            {t.report.address_text ?? tr("Pinned location")}
            {t.distance_km !== undefined ? <span className="text-muted-foreground"> · {km(t.distance_km)}</span> : null}
          </span>
        </p>
        <p className="text-sm text-muted-foreground" dir="auto">{t.instructions}</p>
        <div className="flex flex-wrap gap-1">
          {t.required_capabilities.map((c) => (
            <CapabilityChip key={c} k={c} />
          ))}
          {t.resources
            .filter((a) => !a.released_at)
            .map((a) => (
              <span key={a.id} className="rounded border px-1.5 py-0.5 text-[11px]">
                {a.resource_name}
                {a.kind === "stock" ? ` × ${a.qty}` : ""}
              </span>
            ))}
        </div>
        {t.status === "pending" ? <p className="text-xs font-medium text-high">{tr("Waiting for you")} {since(t.assigned_at, now)}</p> : null}
        {contact ? (
          <div className="flex items-center gap-3 rounded-lg bg-muted p-3">
            <Users className="size-4 text-muted-foreground" />
            <span className="flex-1 font-medium">{contact.name ?? tr("Reporter")}</span>
            {contact.phone ? (
              <Button asChild size="sm">
                <a href={`tel:${contact.phone}`}>
                  <Phone /> {tr("Call reporter")}
                </a>
              </Button>
            ) : null}
          </div>
        ) : t.status !== "pending" ? (
          <Button variant="outline" size="lg" className="h-12" onClick={() => reveal.mutate()}>
            <Eye /> {tr("Show reporter contact")}
          </Button>
        ) : null}
      </div>
      <div className="relative h-48 border-y">
        <LiveMap
          reports={[{ id: t.report_id, reference_code: t.report.reference_code, title: t.report.title, priority: t.report.priority, category: t.report.category, status: "in_progress", location: t.report.location } as never]}
          teams={teamLocation ? [{ id: "me", name: "You", availability: "busy", is_stale: false, last_location: teamLocation, capabilities: [] } as never] : []}
          center={t.report.location}
          zoom={14}
        />
        <a href={mapsUrl} target="_blank" rel="noreferrer" className="absolute bottom-2 end-2 z-[500] inline-flex h-10 items-center gap-1 rounded-full bg-card px-4 text-sm font-medium shadow-md">
          {tr("Open in Maps")} <ChevronRight className="size-4 rtl:rotate-180" />
        </a>
      </div>
      <div className="flex flex-col gap-2 p-4">
        {queued ? (
          <div role="status" className="flex h-16 items-center gap-3 rounded-lg border-2 border-primary bg-primary/10 px-4">
            <span className="flex-1 text-sm">
              <span className="block font-semibold">{queued.label}</span>
              <span className="text-muted-foreground">
                {tr("Sending in")} {secondsLeft}s
              </span>
            </span>
            <Button variant="outline" size="lg" className="h-12" onClick={() => setQueued(undefined)}>
              <Undo2 /> {tr("Undo")}
            </Button>
          </div>
        ) : (
          <Button
            size="xl"
            className="h-16 w-full text-lg"
            variant={t.status === "on_site" ? "success" : "default"}
            disabled={act.isPending}
            onClick={() =>
              !next.run ? setCompleteOpen(true) : next.undoable ? setQueued({ label: next.label, run: next.run, at: Date.now() }) : act.mutate(next.run)
            }
          >
            <next.icon /> {next.label}
          </Button>
        )}
        {t.status === "pending" ? (
          <Button variant="ghost" size="lg" className="h-12 text-destructive" onClick={() => setDeclineOpen(true)}>
            {tr("Decline")}
          </Button>
        ) : null}
      </div>
      <DeclineSheet open={declineOpen} onOpenChange={setDeclineOpen} onSubmit={(r) => act.mutate(() => api.tasks.decline(t.id, r), { onSuccess: () => setDeclineOpen(false) })} />
      <CompleteSheet task={t} open={completeOpen} onOpenChange={setCompleteOpen} onDone={() => (setCompleteOpen(false), inv())} />
    </article>
  );
}

function DeclineSheet({ open, onOpenChange, onSubmit }: { open: boolean; onOpenChange: (o: boolean) => void; onSubmit: (reason: string) => void }) {
  const tr = useT();
  const [reason, setReason] = useState("");
  const quick = ["Already on another case", "Vehicle problem", "Can't reach the location", "Missing equipment"];
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[90dvh] gap-4 overflow-y-auto rounded-t-2xl p-5">
        <SheetHeader className="p-0 text-start">
          <SheetTitle>{tr("Decline task")}</SheetTitle>
          <SheetDescription>{tr("The dispatcher gets a fresh suggestion right away.")}</SheetDescription>
        </SheetHeader>
        <div className="grid gap-2">
          {quick.map((q) => (
            <button key={q} className={cn("h-12 rounded-lg border px-3 text-start text-sm", reason === q && "border-primary bg-primary/10")} onClick={() => setReason(q)}>
              {tr(q)}
            </button>
          ))}
        </div>
        <Field label={tr("Or describe")}>
          <Input value={quick.includes(reason) ? "" : reason} onChange={(e) => setReason(e.target.value)} className="h-12" />
        </Field>
        {!reason.trim() ? (
          <p id="decline-missing" className="text-center text-xs text-muted-foreground" aria-live="polite">
            {tr("Pick a reason or describe it.")}
          </p>
        ) : null}
        <Button size="lg" variant="destructive" className="h-12" disabled={!reason.trim()} aria-describedby={!reason.trim() ? "decline-missing" : undefined} onClick={() => onSubmit(reason)}>
          {tr("Decline")}
        </Button>
      </SheetContent>
    </Sheet>
  );
}

function CompleteSheet({ task: t, open, onOpenChange, onDone }: { task: Task; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const tr = useT();
  const [outcome, setOutcome] = useState<Outcome>();
  const [note, setNote] = useState("");
  const [people, setPeople] = useState("");
  const stock = t.resources.filter((a) => a.kind === "stock" && !a.released_at);
  const [used, setUsed] = useState<Record<string, number>>({});
  useEffect(() => setUsed(Object.fromEntries(stock.map((a) => [a.resource_id, a.qty]))), [t.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const complete = useMutation({
    mutationFn: () => api.tasks.complete(t.id, { outcome: outcome!, resolution_note: note, people_helped: people ? Number(people) : undefined, consumed: used }),
    onSuccess: () => (toast.success(tr("Task completed. Thank you.")), onDone()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const short = note.trim().length < 10;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[90dvh] gap-4 overflow-y-auto rounded-t-2xl p-5">
        <SheetHeader className="p-0 text-start">
          <SheetTitle>{tr("Complete task")}</SheetTitle>
          <SheetDescription>{dateTime(new Date().toISOString())}</SheetDescription>
        </SheetHeader>
        <div className="grid gap-2" role="radiogroup" aria-label={tr("Outcome")}>
          {OUTCOMES.map((o) => (
            <button key={o} role="radio" aria-checked={outcome === o} className={cn("h-12 rounded-lg border px-3 text-start text-sm font-medium", outcome === o && "border-primary bg-primary/10 text-primary")} onClick={() => setOutcome(o)}>
              {tr(OUTCOME_LABEL[o])}
            </button>
          ))}
        </div>
        <Field label={tr("Resolution note")} error={note && short ? `${10 - note.trim().length} ${tr("more characters needed")}` : undefined}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="text-base" placeholder={tr("Patient stabilised, transported to Heliopolis Hospital")} />
        </Field>
        <Field label={tr("People helped (optional)")}>
          <Input type="number" inputMode="numeric" value={people} onChange={(e) => setPeople(e.target.value)} className="h-12 w-32 text-base" />
        </Field>
        {stock.length ? (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">{tr("Supplies used — the rest goes back to stock")}</span>
            {stock.map((a) => (
              <label key={a.id} className="flex items-center gap-2 text-sm">
                <span className="flex-1">{a.resource_name}</span>
                <Input type="number" min={0} max={a.qty} value={used[a.resource_id] ?? 0} onChange={(e) => setUsed((u) => ({ ...u, [a.resource_id]: Math.min(a.qty, Math.max(0, Number(e.target.value))) }))} className="h-10 w-20" />
                <span className="text-xs text-muted-foreground">/ {a.qty}</span>
              </label>
            ))}
          </div>
        ) : null}
        {!outcome || short ? (
          <p id="complete-missing" className="text-center text-xs text-muted-foreground" aria-live="polite">
            {!outcome ? tr("Pick an outcome above.") : tr("Write a short resolution note (at least 10 characters).")}
          </p>
        ) : null}
        <Button
          size="xl"
          variant="success"
          className="h-14"
          disabled={!outcome || short || complete.isPending}
          aria-describedby={!outcome || short ? "complete-missing" : undefined}
          onClick={() => complete.mutate()}
        >
          <CheckCircle2 /> {tr("Complete")}
        </Button>
      </SheetContent>
    </Sheet>
  );
}
