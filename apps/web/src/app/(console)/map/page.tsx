"use client";

import { CATEGORIES, PRIORITIES, REPORT_STATUSES, type Category, type Priority, type ReportStatus } from "@resqgrid/api-client";
import { Check, Layers, Link2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo } from "react";
import { toast } from "sonner";
import { ReportPanel } from "@/components/dispatch/report-panel";
import { ALL_LAYERS, LiveMap, MapLegend, type MapLayers } from "@/components/map/live-map";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { CATEGORY_LABEL, PRIORITY_LABEL, REPORT_STATUS_LABEL } from "@/lib/format";
import { useIncidents, useReports, useResources, useShelters, useTasks, useTeams } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { LoadError } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

const LAYER_LABEL: Record<keyof MapLayers, string> = { reports: "Reports", teams: "Teams", units: "Units", shelters: "Shelters", incidents: "Incident areas" };

function FullMap() {
  const tr = useT();
  const params = useSearchParams();
  const router = useRouter();
  const { org } = useSession();

  // Filters live in the URL so they persist and can be shared (§13.2).
  const set = (k: string, v?: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    router.replace(`/map?${p}`, { scroll: false });
  };
  const hidden = new Set(params.get("hide")?.split(",").filter(Boolean));
  const layers = Object.fromEntries(Object.keys(ALL_LAYERS).map((k) => [k, !hidden.has(k)])) as unknown as MapLayers;
  const toggleLayer = (k: string) => {
    const h = new Set(hidden);
    if (h.has(k)) h.delete(k);
    else h.add(k);
    set("hide", [...h].join(","));
  };
  const category = params.get("category") as Category | null;
  const priority = params.get("priority") as Priority | null;
  const status = params.get("status") as ReportStatus | null;
  const teamId = params.get("team");
  const incidentId = params.get("incident");
  const selected = params.get("report") ?? undefined;

  const reports = useReports({ include_archived: false });
  const teams = useTeams();
  const resources = useResources();
  const shelters = useShelters();
  const incidents = useIncidents();
  const tasks = useTasks();

  const filtered = useMemo(() => {
    const teamReports = teamId ? new Set(tasks.data?.filter((t) => t.assigned_team_id === teamId).map((t) => t.report_id)) : undefined;
    return reports.data?.items.filter(
      (r) =>
        !r.merged_into_id &&
        (status ? r.status === status : !["resolved", "closed"].includes(r.status)) &&
        (!category || r.category === category) &&
        (!priority || r.priority === priority) &&
        (!incidentId || r.incident_id === incidentId) &&
        (!teamReports || teamReports.has(r.id)),
    );
  }, [reports.data, status, category, priority, incidentId, teamId, tasks.data]);

  return (
    <div className="relative grid h-full min-h-0 grid-cols-1 lg:grid-cols-[1fr_400px]">
      <div className="relative min-h-[60dvh]">
        <LoadError queries={[reports, teams, resources, shelters, incidents, tasks]} what="map data" className="absolute inset-x-2 top-2 z-[600] mb-0 shadow-md" />
        <LiveMap
          reports={filtered}
          teams={teamId ? teams.data?.filter((t) => t.id === teamId) : teams.data}
          resources={resources.data}
          shelters={shelters.data}
          incidents={incidentId ? incidents.data?.filter((i) => i.id === incidentId) : incidents.data}
          tasks={tasks.data}
          layers={layers}
          selectedReportId={selected}
          onSelectReport={(id) => set("report", id)}
          center={org?.operating_area.center}
          zoom={13}
        />
        <div className="absolute end-3 top-3 z-[500] flex w-80 max-w-[calc(100%-1.5rem)] flex-col gap-3 rounded-lg border bg-card/95 p-3 text-sm shadow-lg backdrop-blur">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <Layers className="size-4" /> {tr("Layers & filters")}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                navigator.clipboard?.writeText(location.href);
                toast.success(tr("Link copied"));
              }}
              aria-label={tr("Copy shareable link")}
            >
              <Link2 />
            </Button>
          </div>
          <div className="flex flex-wrap gap-1">
            {(Object.keys(LAYER_LABEL) as (keyof MapLayers)[]).map((k) => (
              <button
                key={k}
                aria-pressed={layers[k]}
                onClick={() => toggleLayer(k)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors",
                  layers[k] ? "border-primary bg-primary/10 text-primary" : "border-dashed border-muted-foreground/50 text-muted-foreground hover:text-foreground",
                )}
              >
                {layers[k] ? <Check className="size-3" aria-hidden /> : null}
                {tr(LAYER_LABEL[k])}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Select aria-label={tr("Status")} className="px-2.5 text-xs" value={status ?? ""} onChange={(e) => set("status", e.target.value)}>
              <option value="">{tr("Open statuses")}</option>
              {REPORT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {tr(REPORT_STATUS_LABEL[s])}
                </option>
              ))}
            </Select>
            <Select aria-label={tr("Priority")} className="px-2.5 text-xs" value={priority ?? ""} onChange={(e) => set("priority", e.target.value)}>
              <option value="">{tr("All priorities")}</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {tr(PRIORITY_LABEL[p])}
                </option>
              ))}
            </Select>
            <Select aria-label={tr("Category")} className="px-2.5 text-xs" value={category ?? ""} onChange={(e) => set("category", e.target.value)}>
              <option value="">{tr("All categories")}</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {tr(CATEGORY_LABEL[c])}
                </option>
              ))}
            </Select>
            <Select aria-label={tr("Team")} className="px-2.5 text-xs" value={teamId ?? ""} onChange={(e) => set("team", e.target.value)}>
              <option value="">{tr("All teams")}</option>
              {teams.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
            <Select aria-label={tr("Incident")} className="col-span-2 px-2.5 text-xs" value={incidentId ?? ""} onChange={(e) => set("incident", e.target.value)}>
              <option value="">{tr("All incidents")}</option>
              {incidents.data?.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.title}
                </option>
              ))}
            </Select>
          </div>
          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground">{tr("Legend")}</summary>
            <div className="pt-2">
              <MapLegend />
            </div>
          </details>
        </div>
      </div>
      <aside className="min-h-0 overflow-y-auto border-s bg-card max-lg:border-t">
        {selected ? (
          <ReportPanel reportId={selected} onClose={() => set("report")} />
        ) : (
          <div className="p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">{filtered?.length ?? 0} {tr("reports on the map")}</p>
            <p className="mt-1">{tr("Click a pin for details. Filters and layers are saved in the link, so you can share this exact view.")}</p>
          </div>
        )}
      </aside>
    </div>
  );
}

export default function MapPage() {
  return (
    <Suspense>
      <FullMap />
    </Suspense>
  );
}
