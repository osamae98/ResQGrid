"use client";

import { CATEGORIES, PRIORITIES, type Category, type Priority, type Report, type ReportContact, type Task } from "@resqgrid/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Ban, Camera, CheckCheck, Copy, ExternalLink, Eye, Lock, MapPin, Phone, Plus, Undo2, Users, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CategoryLabel, PriorityBadge, PriorityIcon, ReportStatusBadge, TaskStatusBadge } from "@/components/domain/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/misc";
import { api, errorMessage } from "@/lib/api";
import { ago, CATEGORY_LABEL, dateTime, km, PRIORITY_LABEL, since } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { useT } from "@/lib/i18n";
import { useIncidents, useReport, useTasks } from "@/lib/queries";
import { can, useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { DispatchForm } from "./dispatch-form";

export function ReportPanel({ reportId, onClose, showFullLink = true }: { reportId: string; onClose?: () => void; showFullLink?: boolean }) {
  const tr = useT();
  const { user } = useSession();
  const report = useReport(reportId);
  const tasks = useTasks();
  const r = report.data;
  const reportTasks = tasks.data?.filter((t) => t.report_id === reportId) ?? [];
  const [addTask, setAddTask] = useState(false);
  useEffect(() => setAddTask(false), [reportId]);

  if (report.isLoading) return <div className="flex flex-col gap-3 p-4"><Skeleton className="h-6 w-1/2" /><Skeleton className="h-24" /><Skeleton className="h-40" /></div>;
  if (!r) return <p className="p-4 text-sm text-muted-foreground">{tr("Report not found.")}</p>;

  const open = !["resolved", "closed"].includes(r.status) && !r.merged_into_id && !r.archived_at;
  const activeTasks = reportTasks.filter((t) => !["completed", "cancelled"].includes(t.status));
  const needsTeam = reportTasks.find((t) => t.status === "pending" && !t.assigned_team_id);
  const showDispatch = can.dispatch(user?.role) && open && r.status !== "new" && !needsTeam && (activeTasks.length === 0 || addTask);

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 flex items-start gap-2 border-b bg-card/95 px-4 py-3 backdrop-blur">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <PriorityBadge priority={r.priority} />
            <ReportStatusBadge status={r.status} />
            <CategoryLabel category={r.category} />
            <span className="font-mono text-xs text-muted-foreground">{r.reference_code}</span>
          </div>
          <h2 className="mt-1 text-base font-semibold leading-snug" dir="auto">{r.title}</h2>
          <p className="text-xs text-muted-foreground">
            {r.source === "public" ? tr("Public report") : tr("Staff report")} · {ago(r.created_at)} · {dateTime(r.created_at)}
          </p>
        </div>
        {showFullLink ? (
          <Button asChild variant="ghost" size="icon" aria-label={tr("Open full report in a new tab")}>
            <Link href={`/reports/${r.id}`} target="_blank" rel="noopener">
              <ExternalLink />
            </Link>
          </Button>
        ) : null}
        {onClose ? (
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={tr("Close panel")}>
            <X />
          </Button>
        ) : null}
      </div>

      <div className="flex flex-col gap-4 p-4">
        {r.archived_at ? (
          <div className="rounded-md border border-stale bg-muted p-2 text-sm">
            {tr("Archived")} {ago(r.archived_at)}: {r.archive_reason}
          </div>
        ) : null}

        <DuplicateBanner r={r} />

        <section className="flex flex-col gap-2 text-sm">
          <p className="whitespace-pre-wrap" dir="auto">{r.description}</p>
          <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5" /> {r.address_text ?? `${r.location.lat.toFixed(4)}, ${r.location.lng.toFixed(4)}`}
            </span>
            <span className="inline-flex items-center gap-1">
              <Users className="size-3.5" /> {r.people_affected ?? "?"} {tr("affected")}
            </span>
            <span className="inline-flex items-center gap-1">
              <Camera className="size-3.5" /> {r.photo_count} {tr(r.photo_count === 1 ? "photo" : "photos")}
            </span>
          </div>
          <ContactBlock r={r} />
        </section>

        {r.status === "new" && can.triage(user?.role) && !r.merged_into_id ? <TriageForm r={r} /> : null}
        {r.status !== "new" && open && can.triage(user?.role) ? <QuickEdit r={r} /> : null}

        {reportTasks.length ? (
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tr("Tasks")}</h3>
            {reportTasks.map((t) => (
              <TaskCard key={t.id} t={t} />
            ))}
          </section>
        ) : null}

        {needsTeam && can.dispatch(user?.role) ? (
          <section className="flex flex-col gap-2 rounded-lg border border-critical/40 p-3">
            <h3 className="text-sm font-semibold">{tr("Declined, needs reassigning:")} {tr(needsTeam.decline_reason ?? "")}</h3>
            <DispatchForm report={r} taskId={needsTeam.id} />
          </section>
        ) : null}

        {showDispatch ? (
          <section className="flex flex-col gap-2 rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">{activeTasks.length ? tr("Add another task") : tr("Dispatch a team")}</h3>
              {addTask ? (
                <Button variant="ghost" size="sm" onClick={() => setAddTask(false)}>
                  {tr("Cancel")}
                </Button>
              ) : null}
            </div>
            <DispatchForm report={r} onDone={() => setAddTask(false)} />
          </section>
        ) : can.dispatch(user?.role) && open && activeTasks.length && !needsTeam ? (
          <Button variant="outline" size="sm" onClick={() => setAddTask(true)}>
            <Plus /> {tr("Add another task")}
          </Button>
        ) : null}

        <ReportActions r={r} />
      </div>
    </div>
  );
}

function ContactBlock({ r }: { r: Report }) {
  const tr = useT();
  const { user } = useSession();
  const [contact, setContact] = useState<ReportContact>();
  useEffect(() => setContact(undefined), [r.id]);
  const reveal = useMutation({ mutationFn: () => api.reports.contact(r.id), onSuccess: setContact, onError: (e) => toast.error(errorMessage(e)) });
  if (!r.has_contact) return <p className="text-xs text-muted-foreground">{tr("No reporter contact given.")}</p>;
  if (!can.viewPii(user?.role))
    return (
      <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Lock className="size-3" /> {tr("Reporter contact hidden for your role")}
      </p>
    );
  return contact ? (
    <div className="flex items-center gap-3 rounded-md bg-muted px-3 py-2 text-sm">
      <span className="font-medium">{contact.name ?? "–"}</span>
      {contact.phone ? (
        <a className="inline-flex items-center gap-1 text-primary hover:underline" href={`tel:${contact.phone}`}>
          <Phone className="size-3.5" />
          {contact.phone}
        </a>
      ) : null}
      <span className="ms-auto text-[11px] text-muted-foreground">{tr("view logged")}</span>
    </div>
  ) : (
    <Button variant="outline" size="sm" className="self-start" onClick={() => reveal.mutate()} disabled={reveal.isPending}>
      <Eye /> {tr("Show reporter contact")}
    </Button>
  );
}

function DuplicateBanner({ r }: { r: Report }) {
  const tr = useT();
  const qc = useQueryClient();
  const { user } = useSession();
  const dups = useQuery({ queryKey: ["dups", r.id, r.possible_duplicate_ids.join(), r.merged_ids.join()], queryFn: () => api.reports.duplicates(r.id), enabled: r.possible_duplicate_ids.length + r.merged_ids.length > 0 });
  const merged = useReport(r.merged_into_id);
  const inv = () => ["reports", "report", "dups"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const merge = useMutation({
    mutationFn: ({ dup, primary }: { dup: string; primary: string }) => api.reports.merge(dup, primary),
    onSuccess: () => (toast.success(tr("Merged. The duplicate left the queue; photos and contacts are kept.")), inv()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const unmerge = useMutation({ mutationFn: (id: string) => api.reports.unmerge(id), onSuccess: () => (toast.success(tr("Merge undone")), inv()), onError: (e) => toast.error(errorMessage(e)) });

  if (r.merged_into_id)
    return (
      <div className="flex items-center gap-2 rounded-md border border-high/40 bg-high/10 p-2 text-sm">
        <Copy className="size-4 text-high" />
        <span className="flex-1">
          {tr("Merged into")}{" "}
          <Link className="font-mono text-primary hover:underline" href={`/reports/${r.merged_into_id}`}>
            {merged.data?.reference_code ?? tr("primary")}
          </Link>
        </span>
        {can.triage(user?.role) ? (
          <Button size="sm" variant="outline" onClick={() => unmerge.mutate(r.id)}>
            <Undo2 /> {tr("Undo merge")}
          </Button>
        ) : null}
      </div>
    );

  const possible = dups.data?.filter((d) => r.possible_duplicate_ids.includes(d.id)) ?? [];
  const mergedIn = dups.data?.filter((d) => r.merged_ids.includes(d.id)) ?? [];
  if (!possible.length && !mergedIn.length) return null;
  return (
    <div className="flex flex-col gap-3 rounded-md border border-high/40 bg-high/10 p-3 text-sm">
      {possible.map((d) => {
        const thisIsNewer = r.created_at > d.created_at;
        const dist = Math.round(
          6371000 * 2 * Math.asin(Math.sqrt(Math.sin(((d.location.lat - r.location.lat) * Math.PI) / 360) ** 2 + Math.cos((r.location.lat * Math.PI) / 180) * Math.cos((d.location.lat * Math.PI) / 180) * Math.sin(((d.location.lng - r.location.lng) * Math.PI) / 360) ** 2)),
        );
        return (
          // Stacked, not side by side: the merge button used to squeeze the text into a narrow column.
          <div key={d.id} className="flex gap-2.5">
            <Copy className="mt-0.5 size-4 shrink-0 text-high" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="font-medium">{tr("Possible duplicate")}</span>
              <span className="flex min-w-0 items-baseline gap-1.5">
                <span className="shrink-0 font-mono text-xs">{d.reference_code}</span>
                <span className="truncate text-muted-foreground" dir="auto">{d.title}</span>
              </span>
              <span className="text-xs text-muted-foreground">
                {km(dist / 1000)} · {Math.abs(Math.round((Date.parse(r.created_at) - Date.parse(d.created_at)) / 60000))} {tr("min apart")}
              </span>
              {can.triage(user?.role) ? (
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  {/* The older report stays as the primary; the button names it so it's clear which one remains. */}
                  <Button
                    size="sm"
                    variant="outline"
                    className="bg-card"
                    disabled={merge.isPending}
                    title={`${tr("Keeps")} ${thisIsNewer ? d.reference_code : r.reference_code} (${tr("older")}). ${thisIsNewer ? r.reference_code : d.reference_code} ${tr("leaves the queue; photos and contacts are kept. You can undo.")}`}
                    onClick={() => merge.mutate(thisIsNewer ? { dup: r.id, primary: d.id } : { dup: d.id, primary: r.id })}
                  >
                    {tr("Merge into")} <span className="font-mono">{thisIsNewer ? d.reference_code : r.reference_code}</span>
                  </Button>
                  <span className="text-xs text-muted-foreground">{tr("Keeps the older report. You can undo.")}</span>
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
      {mergedIn.length ? (
        <p className="text-xs">
          {tr("Merged in:")} {mergedIn.map((d) => d.reference_code).join(", ")}
        </p>
      ) : null}
    </div>
  );
}

function TriageForm({ r }: { r: Report }) {
  const tr = useT();
  const qc = useQueryClient();
  const { user } = useSession();
  const incidents = useIncidents();
  const [priority, setPriority] = useState<Priority>(r.priority);
  const [category, setCategory] = useState<Category>(r.category);
  const [incident, setIncident] = useState<string>(r.incident_id ?? "");
  const now = useNow();
  useEffect(() => {
    setPriority(r.priority);
    setCategory(r.category);
    setIncident(r.incident_id ?? "");
  }, [r.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const triage = useMutation({
    mutationFn: (reject?: boolean) => api.reports.triage(r.id, { priority, category, incident_id: incident || null, reject }),
    onSuccess: (_d, reject) => {
      toast.success(reject ? tr("Report rejected") : tr("Triaged"));
      ["reports", "report", "kpis"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  // Dispatch straight from triage: the form below sees the triage choices, and Assign triages first.
  const draft: Report = { ...r, priority, category, incident_id: incident || undefined };
  return (
    <>
    <section className="flex flex-col gap-3 rounded-lg border border-primary/40 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{tr("Triage")}</h3>
        <span className={cn("text-xs tabular-nums", r.priority === "critical" ? "font-semibold text-critical" : "text-muted-foreground")}>{tr("waiting")} {since(r.created_at, now)}</span>
      </div>
      <div className="grid grid-cols-4 gap-1" role="radiogroup" aria-label={tr("Priority")}>
        {PRIORITIES.map((p) => (
          <button
            key={p}
            role="radio"
            aria-checked={priority === p}
            onClick={() => setPriority(p)}
            className={cn(
              "flex flex-col items-center gap-0.5 rounded-md border py-1.5 text-xs font-medium",
              priority === p ? (p === "medium" ? "bg-medium text-black" : `bg-${p} border-transparent text-white`) : "hover:bg-accent",
            )}
            style={priority === p ? { background: `var(--p-${p})` } : undefined}
          >
            <PriorityIcon priority={p} className="size-4" />
            {tr(PRIORITY_LABEL[p])}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label={tr("Category")}>
          <Select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {tr(CATEGORY_LABEL[c])}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={tr("Incident")}>
          <Select value={incident} onChange={(e) => setIncident(e.target.value)}>
            <option value="">{tr("None")}</option>
            {incidents.data
              ?.filter((i) => i.status !== "closed")
              .map((i) => (
                <option key={i.id} value={i.id}>
                  {i.title}
                </option>
              ))}
          </Select>
        </Field>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={() => triage.mutate(false)} disabled={triage.isPending}>
          <CheckCheck /> {tr("Triage only")}
        </Button>
        <ConfirmButton
          variant="outline"
          disabled={triage.isPending}
          title={`${tr("Reject")} ${r.reference_code}?`}
          description={tr("Use this for prank or invalid reports. The report is closed, not deleted, and the rejection is recorded in the audit log.")}
          confirmLabel={tr("Reject report")}
          destructive
          onConfirm={() => triage.mutate(true)}
        >
          <Ban /> {tr("Reject")}
        </ConfirmButton>
      </div>
    </section>
    {can.dispatch(user?.role) ? (
      <section className="flex flex-col gap-2 rounded-lg border p-3">
        <h3 className="text-sm font-semibold">{tr("Dispatch a team")}</h3>
        <DispatchForm
          report={draft}
          beforeAssign={() => api.reports.triage(r.id, { priority, category, incident_id: incident || null }).then(() => undefined)}
        />
      </section>
    ) : null}
    </>
  );
}

/** Priority/incident edits after triage. Changes are staged and need an explicit Save, because a
 *  stray change here re-ranks the queue and the escalation timers. */
function QuickEdit({ r }: { r: Report }) {
  const tr = useT();
  const qc = useQueryClient();
  const incidents = useIncidents();
  const t = useT();
  const [draft, setDraft] = useState<{ priority?: Priority; incident_id?: string | null }>({});
  useEffect(() => setDraft({}), [r.id]);
  const priority = draft.priority ?? r.priority;
  const incidentId = draft.incident_id !== undefined ? draft.incident_id : (r.incident_id ?? null);
  const priorityChanged = priority !== r.priority;
  const incidentChanged = incidentId !== (r.incident_id ?? null);
  const dirty = priorityChanged || incidentChanged;
  const incidentTitle = (id: string | null) => (id ? (incidents.data?.find((i) => i.id === id)?.title ?? tr("incident")) : tr("None"));

  const m = useMutation({
    mutationFn: () => api.reports.triage(r.id, { priority, incident_id: incidentChanged ? incidentId : r.incident_id }),
    onSuccess: () => {
      toast.success(
        [priorityChanged ? `${t("Priority")}: ${t(PRIORITY_LABEL[r.priority])} → ${t(PRIORITY_LABEL[priority])}` : "", incidentChanged ? `${t("Incident")}: ${incidentTitle(incidentId)}` : ""]
          .filter(Boolean)
          .join(" · "),
      );
      setDraft({});
      ["reports", "report", "suggestions", "kpis"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="flex flex-col gap-2">
    <div className="grid grid-cols-2 gap-2">
      <Field label={tr("Priority")}>
        <Select value={priority} onChange={(e) => setDraft((d) => ({ ...d, priority: e.target.value as Priority }))}>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              <PriorityIcon priority={p} /> {tr(PRIORITY_LABEL[p])}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={tr("Incident")}>
        <Select value={incidentId ?? ""} onChange={(e) => setDraft((d) => ({ ...d, incident_id: e.target.value || null }))}>
          <option value="">{tr("None")}</option>
          {incidents.data?.filter((i) => i.status !== "closed").map((i) => (
            <option key={i.id} value={i.id}>
              {i.title}
            </option>
          ))}
        </Select>
      </Field>
    </div>
      {dirty ? (
        <div role="alert" className={cn("flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm", priorityChanged && PRIORITIES.indexOf(priority) > PRIORITIES.indexOf(r.priority) ? "border-high/50 bg-high/10" : "bg-muted")}>
          <span className="flex-1">
            {priorityChanged ? (
              <span className="block">
                {t("Change priority to")} <strong>{t(PRIORITY_LABEL[priority])}</strong> ({t("was")} {t(PRIORITY_LABEL[r.priority])})
              </span>
            ) : null}
            {incidentChanged ? (
              <span className="block">
                {t("Move to incident")} <strong>{incidentTitle(incidentId)}</strong>
              </span>
            ) : null}
          </span>
          <Button size="sm" variant="outline" onClick={() => setDraft({})} disabled={m.isPending}>
            {t("Cancel")}
          </Button>
          <Button size="sm" onClick={() => m.mutate()} disabled={m.isPending}>
            {t("Save")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function TaskCard({ t }: { t: Task }) {
  const tr = useT();
  const now = useNow();
  return (
    <Link
      href={`/tasks/${t.id}`}
      className={cn("flex flex-col gap-1 rounded-md border p-2.5 text-sm hover:bg-accent/50", t.escalation_level > 0 && "border-critical bg-critical/5")}
    >
      <div className="flex items-center gap-2">
        <TaskStatusBadge status={t.status} unassigned={t.status === "pending" && !t.assigned_team_id} />
        <span className="font-medium">{t.team_name ?? tr("No team")}</span>
        {t.escalation_level ? <Badge variant="critical">{tr("Escalated")} L{t.escalation_level}</Badge> : null}
        {t.override_reason ? <Badge variant="warning">{tr("Override")}</Badge> : null}
        <span className="ms-auto text-xs tabular-nums text-muted-foreground">{km(t.distance_km)}</span>
      </div>
      {t.status === "pending" && t.assigned_at && t.assigned_team_id ? (
        <span className="text-xs text-muted-foreground">
          {tr("waiting for accept")} {since(t.assigned_at, now)}
          {t.escalation_deadline ? ` · ${tr("escalates")} ${Date.parse(t.escalation_deadline) > now ? `${tr("in")} ${since(new Date(now - (Date.parse(t.escalation_deadline) - now)).toISOString(), now)}` : tr("now")}` : ""}
        </span>
      ) : null}
      {t.resources.filter((a) => !a.released_at).length ? (
        <div className="flex flex-wrap gap-1">
          {t.resources
            .filter((a) => !a.released_at)
            .map((a) => (
              <Badge key={a.id} variant="outline">
                {a.resource_name}
                {a.kind === "stock" ? ` × ${a.qty}` : ""} · {tr(a.state)}
              </Badge>
            ))}
        </div>
      ) : null}
      {t.status === "completed" ? <p className="text-xs text-muted-foreground" dir="auto">{t.resolution_note}</p> : null}
    </Link>
  );
}

function ReportActions({ r }: { r: Report }) {
  const tr = useT();
  const { user } = useSession();
  const qc = useQueryClient();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [reason, setReason] = useState("");
  const inv = () => ["reports", "report", "kpis"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const archive = useMutation({ mutationFn: () => api.reports.archive(r.id, reason), onSuccess: () => (toast.success(tr("Archived")), setArchiveOpen(false), inv()), onError: (e) => toast.error(errorMessage(e)) });
  const restore = useMutation({ mutationFn: () => api.reports.restore(r.id), onSuccess: () => (toast.success(tr("Restored")), inv()), onError: (e) => toast.error(errorMessage(e)) });
  const close = useMutation({ mutationFn: () => api.reports.close(r.id), onSuccess: () => (toast.success(tr("Closed")), inv()), onError: (e) => toast.error(errorMessage(e)) });
  if (!can.archive(user?.role)) return null;
  return (
    <div className="flex flex-wrap gap-2 border-t pt-3">
      {r.status === "resolved" ? (
        <Button variant="outline" size="sm" onClick={() => close.mutate()}>
          <CheckCheck /> {tr("Close report")}
        </Button>
      ) : null}
      {r.archived_at ? (
        can.restore(user?.role) ? (
          <Button variant="outline" size="sm" onClick={() => restore.mutate()}>
            <ArchiveRestore /> {tr("Restore")}
          </Button>
        ) : null
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setArchiveOpen(true)}>
          <Archive /> {tr("Archive")}
        </Button>
      )}
      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent title={tr("Archive report")} description={tr("Reports are never deleted. Archived reports leave default views; an admin can restore them.")}>
          <Field label={tr("Reason (required)")}>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setArchiveOpen(false)}>
              {tr("Cancel")}
            </Button>
            <Button disabled={!reason.trim() || archive.isPending} onClick={() => archive.mutate()}>
              {tr("Archive")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
