"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { use, useState } from "react";
import { toast } from "sonner";
import { Comments } from "@/components/domain/comments";
import { PriorityBadge, ReportStatusBadge } from "@/components/domain/badges";
import { Button } from "@/components/ui/button";
import { TaskCard } from "@/components/dispatch/report-panel";
import { LiveMap } from "@/components/map/live-map";
import { Badge } from "@/components/ui/badge";
import { ConfirmButton } from "@/components/ui/confirm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { Stat } from "@/components/ui/misc";
import { api, errorMessage } from "@/lib/api";
import { PRIORITIES } from "@resqgrid/api-client";
import { ago, km } from "@/lib/format";
import { useReports, useResources, useTasks, useTeams } from "@/lib/queries";
import { can, useSession } from "@/lib/session";
import { useT } from "@/lib/i18n";

export default function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const tr = useT();
  const { id } = use(params);
  const { user } = useSession();
  const qc = useQueryClient();
  const incident = useQuery({ queryKey: ["incidents", id], queryFn: () => api.incidents.get(id) });
  const reports = useReports({ incident_id: id });
  const tasks = useTasks({ incident_id: id });
  const [allReports, setAllReports] = useState(false);
  const [allTasks, setAllTasks] = useState(false);
  const resources = useResources();
  const teams = useTeams();
  const inv = () => qc.invalidateQueries({ queryKey: ["incidents"] });
  const update = useMutation({
    mutationFn: (status: "active" | "monitoring") => api.incidents.update(id, { status }),
    onSuccess: inv,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const close = useMutation({ mutationFn: () => api.incidents.close(id), onSuccess: () => (toast.success(tr("Incident closed")), inv()), onError: (e) => toast.error(errorMessage(e)) });
  const i = incident.data;
  if (!i) return null;
  const linkedResources = resources.data?.filter((r) => r.incident_id === id) ?? [];
  // No scroll areas inside the page (they trap the wheel): show the most urgent few, expand in place.
  const isOpen = (s: string) => !["resolved", "closed"].includes(s);
  const linked = [...(reports.data?.items ?? [])].sort(
    (a, b) => Number(isOpen(b.status)) - Number(isOpen(a.status)) || PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) || (a.created_at < b.created_at ? 1 : -1),
  );
  const activeTasks = tasks.data?.filter((t) => !["completed", "cancelled"].includes(t.status)) ?? [];
  const open = reports.data?.items.filter((r) => !["resolved", "closed"].includes(r.status) && !r.merged_into_id) ?? [];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      <Link href="/incidents" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 rtl:rotate-180" /> {tr("Incidents")}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold" dir="auto">{i.title}</h1>
          <p className="text-sm capitalize text-muted-foreground">
            {tr(i.type)} · {km(i.radius_km)} · {tr("commander")} {i.commander_name} · {tr("opened")} {ago(i.created_at)}
          </p>
        </div>
        {can.dispatch(user?.role) && i.status !== "closed" ? (
          <div className="flex gap-2">
            <Select value={i.status} onChange={(e) => update.mutate(e.target.value as "active")} aria-label={tr("Incident status")} className="w-36">
              <option value="active">{tr("Active")}</option>
              <option value="monitoring">{tr("Monitoring")}</option>
            </Select>
            <ConfirmButton
              variant="outline"
              disabled={close.isPending}
              title={`${tr("Close")} “${i.title}”?`}
              description={
                <>
                  {i.stats?.open_reports ? (
                    <p className="mb-2 font-medium text-high">
                      {i.stats.open_reports} {tr(i.stats.open_reports === 1 ? "report is still open in this incident." : "reports are still open in this incident.")}
                    </p>
                  ) : null}
                  <p>{tr("It leaves the incident pickers and can't be reopened. Linked reports and tasks are not changed.")}</p>
                </>
              }
              confirmLabel={tr("Close incident")}
              onConfirm={() => close.mutate()}
            >
              {tr("Close incident")}
            </ConfirmButton>
          </div>
        ) : (
          <Badge variant="stale">{tr(i.status)}</Badge>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={tr("Open reports")} value={i.stats?.open_reports} />
        <Stat label={tr("Active tasks")} value={i.stats?.active_tasks} />
        <Stat label={tr("Units deployed")} value={i.stats?.resources_deployed} />
        <Stat label={tr("Total reports")} value={reports.data?.total} />
      </div>
      <Card className="h-80 overflow-hidden">
        <LiveMap reports={open} teams={teams.data} incidents={[i]} resources={linkedResources} tasks={tasks.data} center={i.center} zoom={13} />
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{tr("Linked reports")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            {(allReports ? linked : linked.slice(0, 8)).map((r) => (
              <Link key={r.id} href={`/reports/${r.id}`} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent">
                <PriorityBadge priority={r.priority} compact />
                <span className="flex-1 truncate" dir="auto">{r.title}</span>
                <ReportStatusBadge status={r.status} />
              </Link>
            ))}
            {linked.length > 8 ? (
              <Button variant="ghost" size="sm" className="mt-1 self-start" onClick={() => setAllReports((v) => !v)} aria-expanded={allReports}>
                {allReports ? tr("Show less") : `${tr("Show all")} (${linked.length})`}
              </Button>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{tr("Tasks")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {(allTasks ? activeTasks : activeTasks.slice(0, 5)).map((t) => <TaskCard key={t.id} t={t} />)}
            {activeTasks.length > 5 ? (
              <Button variant="ghost" size="sm" className="self-start" onClick={() => setAllTasks((v) => !v)} aria-expanded={allTasks}>
                {allTasks ? tr("Show less") : `${tr("Show all")} (${activeTasks.length})`}
              </Button>
            ) : null}
            {tasks.data?.every((t) => ["completed", "cancelled"].includes(t.status)) ? <p className="text-sm text-muted-foreground">{tr("No active tasks.")}</p> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{tr("Resources")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            {linkedResources.map((r) => (
              <div key={r.id} className="flex items-center gap-2">
                <span className="flex-1">{tr(r.name)}</span>
                <span className="text-xs text-muted-foreground">{r.depot_name}</span>
                {r.kind === "unit" ? <Badge variant={r.status === "available" ? "available" : r.status === "unavailable" ? "stale" : "busy"}>{tr(r.status ?? "")}</Badge> : <Badge variant="outline">{(r.on_hand ?? 0) - (r.reserved ?? 0)} {tr(r.unit_label ?? "")}</Badge>}
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{tr("Comments")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Comments parentType="incident" parentId={id} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
