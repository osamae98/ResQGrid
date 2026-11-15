"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Radio, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, errorMessage, formatReason } from "@/lib/api";
import { since } from "@/lib/format";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { ReportPanel } from "@/components/dispatch/report-panel";
import { ReportQueue } from "@/components/dispatch/report-queue";
import { LiveMap } from "@/components/map/live-map";
import { Empty, Stat } from "@/components/ui/misc";
import { useIncidents, useKpis, useReports, useResources, useShelters, useTasks, useTeams } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { useT } from "@/lib/i18n";

function DispatchConsole() {
  const tr = useT();
  const params = useSearchParams();
  const router = useRouter();
  const selectedId = params.get("report") ?? undefined;
  const { org } = useSession();

  const reports = useReports();
  const tasks = useTasks();
  const teams = useTeams();
  const resources = useResources();
  const shelters = useShelters();
  const incidents = useIncidents();

  const select = useCallback((id?: string) => router.replace(id ? `/dispatch?report=${id}` : "/dispatch", { scroll: false }), [router]);

  // Esc closes the report (mainly for the sheet on smaller screens), unless a dialog is open.
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("[role=dialog]")) select(undefined);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, select]);

  const mapReports = useMemo(() => reports.data?.items.filter((r) => !r.merged_into_id && !["resolved", "closed"].includes(r.status)), [reports.data]);
  const selected = reports.data?.items.find((r) => r.id === selectedId);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <KpiStrip />
      <OverrideRequests />
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[320px_1fr_420px]">
        <aside className="min-h-0 border-e bg-card max-lg:h-72" aria-label={tr("Queue")}>
          <ReportQueue reports={reports.data?.items} tasks={tasks.data} loading={reports.isLoading} selectedId={selectedId} onSelect={select} />
        </aside>
        <section className="relative min-h-80" aria-label={tr("Map")}>
          <LiveMap
            reports={mapReports}
            teams={teams.data}
            resources={resources.data}
            shelters={shelters.data}
            incidents={incidents.data}
            tasks={tasks.data}
            selectedReportId={selectedId}
            onSelectReport={select}
            center={org?.operating_area.center}
            focus={selected?.location}
          />
        </section>
        {/* Below lg the detail panel is a sheet over the map, so picking a report doesn't mean scrolling past the map. */}
        {selectedId ? (
          <button type="button" aria-label={tr("Close report")} className="fixed inset-0 z-[1040] bg-black/30 lg:hidden" onClick={() => select(undefined)} />
        ) : null}
        <aside
          className={cn(
            "min-h-0 overflow-y-auto border-s bg-card",
            selectedId
              ? "max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:top-16 max-lg:z-[1050] max-lg:rounded-t-xl max-lg:border-t max-lg:shadow-2xl sm:max-lg:start-auto sm:max-lg:top-12 sm:max-lg:w-[440px] sm:max-lg:rounded-none"
              : "max-lg:hidden",
          )}
          aria-label={tr("Report detail")}
        >
          {selectedId ? (
            <ReportPanel reportId={selectedId} onClose={() => select(undefined)} />
          ) : (
            <Empty icon={<Radio />} title={tr("Select a report")} className="h-full">
              {tr("Pick a report from the queue or the map. Use ↑ ↓ to move through the queue.")}
            </Empty>
          )}
        </aside>
      </div>
    </div>
  );
}

function KpiStrip() {
  const tr = useT();
  const { data: k } = useKpis();
  return (
    <div className="grid shrink-0 grid-cols-3 gap-2 border-b bg-background p-2 sm:grid-cols-4 xl:grid-cols-7">
      <Stat label={tr("Open reports")} value={k?.open_reports ?? "–"} />
      <Stat label={tr("Critical open")} value={k?.critical_open ?? "–"} tone={k?.critical_open ? "critical" : undefined} />
      <Stat label={tr("Unassigned > 5 min")} value={k?.unassigned_over_5m ?? "–"} tone={k?.unassigned_over_5m ? "warning" : undefined} />
      <Stat label={tr("Teams available")} value={k ? `${k.teams.available}` : "–"} sub={k ? `${k.teams.busy} ${tr("busy")} · ${k.teams.off_duty} ${tr("off duty")}` : undefined} tone="ok" />
      <Stat label={tr("Teams stale")} value={k?.teams.stale ?? "–"} tone={k?.teams.stale ? "warning" : undefined} />
      <Stat label={tr("Units")} value={k ? `${k.units.available} ${tr("available")}` : "–"} sub={k ? `${k.units.reserved} ${tr("reserved")} · ${k.units.deployed} ${tr("deployed")}` : undefined} />
      <Stat label={tr("Shelter beds free")} value={k ? k.shelter_beds_free : "–"} sub={k ? `${tr("of")} ${k.shelter_beds_total}` : undefined} />
    </div>
  );
}

/** Admins approve dispatcher override requests in one click; requests expire after 5 min (§6.3). */
function OverrideRequests() {
  const tr = useT();
  const { user } = useSession();
  const qc = useQueryClient();
  const reqs = useQuery({ queryKey: ["override-requests"], queryFn: api.tasks.overrideRequests, enabled: user?.role === "admin", refetchInterval: 10_000 });
  const approve = useMutation({
    mutationFn: api.tasks.overrideApprove,
    onSuccess: (t) => {
      toast.success(`${tr("Override approved")} — ${t.team_name}`);
      ["override-requests", "tasks", "reports", "teams", "resources"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e) => (toast.error(errorMessage(e)), qc.invalidateQueries({ queryKey: ["override-requests"] })),
  });
  const pending = reqs.data?.filter((r) => r.status === "pending" && Date.parse(r.expires_at) > Date.now()) ?? [];
  if (!pending.length) return null;
  return (
    <div className="flex flex-col gap-1 border-b bg-high/10 px-3 py-2">
      {pending.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
          <ShieldCheck className="size-4 text-high" />
          <span>
            <strong>{r.requested_by}</strong> {tr("requests an override to assign")} <strong>{r.team_name}</strong> — {formatReason(r.reason)}
            {r.note ? `: ${r.note}` : ""}
          </span>
          <span className="text-xs text-muted-foreground">{tr("expires in")} {since(new Date(2 * Date.now() - Date.parse(r.expires_at)).toISOString())}</span>
          <Button size="sm" className="ms-auto" disabled={approve.isPending} onClick={() => approve.mutate(r.id)}>
            {tr("Approve")}
          </Button>
        </div>
      ))}
    </div>
  );
}

export default function DispatchPage() {
  return (
    <Suspense>
      <DispatchConsole />
    </Suspense>
  );
}
