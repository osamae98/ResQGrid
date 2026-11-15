"use client";

import { OUTCOMES, type Outcome, type Task } from "@resqgrid/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, Check, PackagePlus, Undo2 } from "lucide-react";
import Link from "next/link";
import { use, useState } from "react";
import { toast } from "sonner";
import { Comments } from "@/components/domain/comments";
import { CapabilityChip, CategoryLabel, PriorityBadge, TaskStatusBadge } from "@/components/domain/badges";
import { Timeline } from "@/components/domain/timeline";
import { LiveMap } from "@/components/map/live-map";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/misc";
import { api, errorMessage } from "@/lib/api";
import { capLabel, dateTime, duration, km, OUTCOME_LABEL, TASK_STATUS_LABEL } from "@/lib/format";
import { useResources, useTask, useTaskTimeline, useTeams } from "@/lib/queries";
import { can, useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

const STEPS: Task["status"][] = ["pending", "accepted", "en_route", "on_site", "completed"];

export default function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const tr = useT();
  const { id } = use(params);
  const task = useTask(id);
  const timeline = useTaskTimeline(id);
  const teams = useTeams();
  const trail = useQuery({ queryKey: ["task-trail", id], queryFn: () => api.tasks.trail(id), refetchInterval: 15_000 });
  const t = task.data;
  if (task.isLoading) return <div className="p-6"><Skeleton className="h-40" /></div>;
  if (!t) return <p className="p-6 text-sm text-muted-foreground">{tr("Task not found.")}</p>;
  const team = teams.data?.find((x) => x.id === t.assigned_team_id);
  const at = (s: Task["status"]) => ({ pending: t.assigned_at, accepted: t.accepted_at, en_route: t.en_route_at, on_site: t.on_site_at, completed: t.completed_at, cancelled: t.cancelled_at })[s];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      <Link href="/board" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 rtl:rotate-180" /> {tr("Board")}
      </Link>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <PriorityBadge priority={t.report.priority} />
            <TaskStatusBadge status={t.status} unassigned={t.status === "pending" && !t.assigned_team_id} />
            <CategoryLabel category={t.report.category} />
            {t.escalation_level ? <Badge variant="critical">{tr("Escalated")} L{t.escalation_level}</Badge> : null}
            {t.override_reason ? <Badge variant="warning">{tr("Override by")} {t.override_by}: {tr(capLabel(t.override_reason))}</Badge> : null}
          </div>
          <h1 className="mt-1 text-xl font-semibold" dir="auto">{t.report.title}</h1>
          <p className="text-sm text-muted-foreground">
            <Link className="font-mono text-primary hover:underline" href={`/reports/${t.report_id}`}>
              {t.report.reference_code}
            </Link>{" "}
            · {t.report.address_text} · {t.team_name ?? tr("no team")} {t.distance_km !== undefined ? `· ${km(t.distance_km)} ${tr("away")}` : ""}
          </p>
        </div>
        <TaskActions t={t} />
      </div>

      {t.status !== "cancelled" ? (
        <ol className="grid grid-cols-5 gap-1" aria-label={tr("Task progress")}>
          {STEPS.map((s) => {
            const done = !!at(s);
            const current = s === t.status;
            return (
              <li key={s} className={cn("rounded-md border px-2 py-1.5 text-xs", done ? "border-available/50 bg-available/10" : "text-muted-foreground", current && "ring-1 ring-primary")}>
                <div className="flex items-center gap-1 font-medium">
                  {done ? <Check className="size-3 text-available" /> : null}
                  {tr(TASK_STATUS_LABEL[s])}
                </div>
                <div className="tabular-nums">{dateTime(at(s))}</div>
                {s !== "pending" && at(s) && t.assigned_at ? <div className="tabular-nums text-muted-foreground">+{duration((Date.parse(at(s)!) - Date.parse(t.assigned_at)) / 1000)}</div> : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="rounded-md bg-muted p-3 text-sm">{tr("Cancelled")} {dateTime(t.cancelled_at)}</p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-4">
          <Card className="overflow-hidden">
            <div className="h-80">
              <LiveMap
                reports={[{ id: t.report_id, reference_code: t.report.reference_code, title: t.report.title, category: t.report.category, priority: t.report.priority, status: "in_progress", location: t.report.location } as never]}
                teams={team ? [team] : []}
                tasks={[t]}
                trail={trail.data}
                center={t.report.location}
                zoom={14}
              />
            </div>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{tr("Instructions")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <p dir="auto">{t.instructions}</p>
              <div className="flex flex-wrap gap-1">
                {t.required_capabilities.map((c) => (
                  <CapabilityChip key={c} k={c} ok={team?.capabilities.includes(c)} />
                ))}
              </div>
              {t.decline_reason ? <p className="text-xs text-critical">{tr("Declined")}: {tr(t.decline_reason)}</p> : null}
            </CardContent>
          </Card>
          {t.status === "completed" ? (
            <Card>
              <CardHeader>
                <CardTitle>{tr("Resolution")}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                <p className="font-medium">{t.outcome ? tr(OUTCOME_LABEL[t.outcome]) : ""}</p>
                <p dir="auto">{t.resolution_note}</p>
                {t.people_helped !== undefined ? <p className="text-muted-foreground">{t.people_helped} {tr("people helped")}</p> : null}
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>{tr("Comments")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Comments parentType="task" parentId={t.id} />
            </CardContent>
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          <ResourcesCard t={t} />
          <Card>
            <CardHeader>
              <CardTitle>{tr("Timeline")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Timeline events={timeline.data} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ResourcesCard({ t }: { t: Task }) {
  const tr = useT();
  const { user } = useSession();
  const qc = useQueryClient();
  const resources = useResources();
  const [pick, setPick] = useState("");
  const [qty, setQty] = useState(1);
  const inv = () => ["task", "resources", "tasks"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const reserve = useMutation({
    mutationFn: () => {
      const r = resources.data?.find((x) => x.id === pick);
      return api.tasks.reserve(t.id, pick, r?.kind === "stock" ? qty : undefined);
    },
    onSuccess: () => (toast.success(tr("Reserved")), setPick(""), inv()),
    onError: (e) => (toast.error(errorMessage(e)), inv()),
  });
  const release = useMutation({ mutationFn: (aid: string) => api.tasks.release(t.id, aid), onSuccess: () => (toast.success(tr("Released")), inv()), onError: (e) => toast.error(errorMessage(e)) });
  const open = !["completed", "cancelled"].includes(t.status);
  const picked = resources.data?.find((x) => x.id === pick);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tr("Resources")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {t.resources.length === 0 ? <p className="text-muted-foreground">{tr("None reserved.")}</p> : null}
        {t.resources.map((a) => (
          <div key={a.id} className="flex items-center gap-2">
            <span className="flex-1">
              {a.resource_name}
              {a.kind === "stock" ? ` × ${a.qty}` : ""}
            </span>
            <Badge variant={a.state === "deployed" ? "busy" : a.state === "reserved" ? "outline" : "stale"}>{tr(a.state)}</Badge>
            {open && !a.released_at && can.reserveResources(user?.role) ? (
              <Button size="sm" variant="ghost" onClick={() => release.mutate(a.id)} aria-label={`${tr("Release")} ${a.resource_name}`}>
                <Undo2 />
              </Button>
            ) : null}
          </div>
        ))}
        {open && can.reserveResources(user?.role) ? (
          <div className="mt-2 flex gap-2 border-t pt-3">
            <Select value={pick} onChange={(e) => setPick(e.target.value)} aria-label={tr("Resource to reserve")}>
              <option value="">{tr("Reserve a resource…")}</option>
              {resources.data
                ?.filter((r) => (r.kind === "unit" ? r.status === "available" : (r.on_hand ?? 0) - (r.reserved ?? 0) > 0))
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} — {r.depot_name}
                    {r.kind === "stock" ? ` (${(r.on_hand ?? 0) - (r.reserved ?? 0)} ${r.unit_label})` : ""}
                  </option>
                ))}
            </Select>
            {picked?.kind === "stock" ? <Input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} className="w-20" aria-label={tr("Quantity")} /> : null}
            <Button size="icon" disabled={!pick || reserve.isPending} onClick={() => reserve.mutate()} aria-label={tr("Reserve")}>
              <PackagePlus />
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function TaskActions({ t }: { t: Task }) {
  const tr = useT();
  const { user } = useSession();
  const qc = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState<Outcome>("treated_on_site");
  const inv = () => ["task", "tasks", "reports", "report", "teams", "resources", "task-timeline", "kpis"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const run = useMutation({
    mutationFn: (fn: () => Promise<Task>) => fn(),
    onSuccess: (x) => (toast.success(`${tr("Task")}: ${tr(TASK_STATUS_LABEL[x.status])}`), setCancelOpen(false), setCompleteOpen(false), inv()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!can.dispatch(user?.role) || ["completed", "cancelled"].includes(t.status)) return null;
  const onBehalf = { pending: "accept", accepted: "en_route", en_route: "on_site", on_site: "complete" }[t.status as "pending"];
  return (
    <div className="flex flex-wrap gap-2">
      {t.assigned_team_id && onBehalf ? (
        <Button
          variant="outline"
          size="sm"
          tooltip={tr("Recorded as an action on behalf of the team")}
          onClick={() => {
            if (onBehalf === "complete") return setCompleteOpen(true);
            run.mutate(() => (onBehalf === "accept" ? api.tasks.accept(t.id) : onBehalf === "en_route" ? api.tasks.enRoute(t.id) : api.tasks.onSite(t.id)));
          }}
        >
          {tr("Mark as")} {tr(TASK_STATUS_LABEL[onBehalf === "complete" ? "completed" : onBehalf === "accept" ? "accepted" : (onBehalf as "en_route" | "on_site")])} ({tr("on behalf")})
        </Button>
      ) : null}
      <Button variant="destructive" size="sm" onClick={() => setCancelOpen(true)}>
        <Ban /> {tr("Cancel task")}
      </Button>
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent title={tr("Cancel task")} description={tr("Reserved resources are released and the team becomes available.")}>
          <Field label={tr("Reason (required)")}>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              {tr("Keep task")}
            </Button>
            <Button variant="destructive" disabled={!reason.trim() || run.isPending} onClick={() => run.mutate(() => api.tasks.cancel(t.id, reason))}>
              {tr("Cancel task")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={completeOpen} onOpenChange={setCompleteOpen}>
        <DialogContent title={tr("Complete task (on behalf of team)")}>
          <Field label={tr("Outcome")}>
            <Select value={outcome} onChange={(e) => setOutcome(e.target.value as Outcome)}>
              {OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {tr(OUTCOME_LABEL[o])}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tr("Resolution note (at least 10 characters)")} error={note && note.trim().length < 10 ? `${10 - note.trim().length} ${tr("more characters needed")}` : undefined}>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="flex justify-end">
            <Button disabled={note.trim().length < 10 || run.isPending} onClick={() => run.mutate(() => api.tasks.complete(t.id, { resolution_note: note, outcome }))}>
              {tr("Complete")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
