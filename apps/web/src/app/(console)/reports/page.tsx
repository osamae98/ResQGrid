"use client";

import { CATEGORIES, PRIORITIES, REPORT_STATUSES, type Report } from "@resqgrid/api-client";
import { ArrowDown, ArrowUp, ArrowUpDown, Copy, Download, Plus, Search, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { CATEGORY_ICON, CategoryLabel, PriorityBadge, PriorityIcon, REPORT_STATUS_ICON, ReportStatusBadge } from "@/components/domain/badges";
import { NewReportDialog } from "@/components/dispatch/new-report-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FacetFilter } from "@/components/ui/facet-filter";
import { Input } from "@/components/ui/input";
import { Empty, LoadError, PageHeader, Skeleton } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { ago, CATEGORY_LABEL, PRIORITY_LABEL, REPORT_STATUS_LABEL } from "@/lib/format";
import { useReports } from "@/lib/queries";
import { can, useSession } from "@/lib/session";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type SortKey = "reference_code" | "priority" | "status" | "created_at";
type Facet = "status" | "priority" | "category" | "source";

export default function ReportsPage() {
  const tr = useT();
  const { user } = useSession();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string[]>([]);
  const [priority, setPriority] = useState<string[]>([]);
  const [category, setCategory] = useState<string[]>([]);
  const [source, setSource] = useState<string[]>([]);
  const [archived, setArchived] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "created_at", dir: -1 });
  const [creating, setCreating] = useState(false);
  // Search and archive go to the API; facets, counts and sorting run on the loaded page so they're instant.
  const reports = useReports({ q: q || undefined, include_archived: archived });
  const all = useMemo(() => reports.data?.items ?? [], [reports.data]);

  const match = (r: Report, skip?: Facet) =>
    (skip === "status" || !status.length || status.includes(r.status)) &&
    (skip === "priority" || !priority.length || priority.includes(r.priority)) &&
    (skip === "category" || !category.length || category.includes(r.category)) &&
    (skip === "source" || !source.length || source.includes(r.source));
  // Each facet counts against the other active filters, like a data-table toolbar.
  const countBy = (key: Facet, field: (r: Report) => string) => {
    const m = new Map<string, number>();
    for (const r of all) if (match(r, key)) m.set(field(r), (m.get(field(r)) ?? 0) + 1);
    return m;
  };
  const rows = useMemo(() => {
    const out = all.filter((r) => match(r));
    const val = (r: Report) => (sort.key === "priority" ? PRIORITIES.indexOf(r.priority) : sort.key === "status" ? REPORT_STATUSES.indexOf(r.status) : r[sort.key]);
    return out.sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * sort.dir);
  }, [all, status, priority, category, source, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const filtered = status.length + priority.length + category.length + source.length > 0;
  const reset = () => (setStatus([]), setPriority([]), setCategory([]), setSource([]));

  const statusCount = countBy("status", (r) => r.status);
  const priorityCount = countBy("priority", (r) => r.priority);
  const categoryCount = countBy("category", (r) => r.category);
  const sourceCount = countBy("source", (r) => r.source);
  const SortHead = ({ k, label, end }: { k: SortKey; label: string; end?: boolean }) => {
    const active = sort.key === k;
    const Icon = !active ? ArrowUpDown : sort.dir === 1 ? ArrowUp : ArrowDown;
    return (
      <th className={cn("px-3 py-2 font-medium", end ? "text-end" : "text-start")} aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
        <button
          type="button"
          onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? ((s.dir * -1) as 1 | -1) : k === "created_at" ? -1 : 1 }))}
          className={cn("-mx-1.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground", active && "text-foreground")}
        >
          {label}
          <Icon className={cn("size-3.5", !active && "opacity-50")} aria-hidden />
        </button>
      </th>
    );
  };

  return (
    <div className="p-4">
      <PageHeader
        title={tr("Reports")}
        description={tr("Every inbound report, tracked to a terminal state. Nothing is deleted.")}
        actions={
          <>
            <Button variant="outline" asChild>
              <a href={api.analytics.exportUrl("reports")}>
                <Download /> CSV
              </a>
            </Button>
            {can.createReport(user?.role) ? (
              <Button onClick={() => setCreating(true)}>
                <Plus /> {tr("New report")}
              </Button>
            ) : null}
          </>
        }
      />
      <LoadError queries={[reports]} what="reports" />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute start-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Search")} className="ps-8" aria-label={tr("Search reports")} />
        </div>
        <FacetFilter
          title={tr("Status")}
          selected={status}
          onChange={setStatus}
          options={REPORT_STATUSES.map((v) => {
            const Icon = REPORT_STATUS_ICON[v];
            return { value: v, label: tr(REPORT_STATUS_LABEL[v]), icon: <Icon className="size-4 text-muted-foreground" />, count: statusCount.get(v) ?? 0 };
          })}
        />
        <FacetFilter
          title={tr("Priority")}
          selected={priority}
          onChange={setPriority}
          options={PRIORITIES.map((v) => ({ value: v, label: tr(PRIORITY_LABEL[v]), icon: <PriorityIcon priority={v} className="size-4" />, count: priorityCount.get(v) ?? 0 }))}
        />
        <FacetFilter
          title={tr("Category")}
          selected={category}
          onChange={setCategory}
          options={CATEGORIES.map((v) => {
            const Icon = CATEGORY_ICON[v];
            return { value: v, label: tr(CATEGORY_LABEL[v]), icon: <Icon className="size-4 text-muted-foreground" />, count: categoryCount.get(v) ?? 0 };
          })}
        />
        <FacetFilter
          title={tr("Source")}
          selected={source}
          onChange={setSource}
          options={(["public", "dispatcher", "field"] as const).map((v) => ({ value: v, label: tr(v), count: sourceCount.get(v) ?? 0 }))}
        />
        <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-sm text-muted-foreground hover:text-foreground">
          <Checkbox checked={archived} onCheckedChange={(c) => setArchived(c === true)} /> {tr("Include archived")}
        </label>
        {filtered ? (
          <Button variant="ghost" size="sm" className="h-9" onClick={reset}>
            {tr("Reset")} <X />
          </Button>
        ) : null}
        <span className="ms-auto text-sm tabular-nums text-muted-foreground">{filtered ? `${rows.length} / ${all.length}` : all.length} {tr("reports")}</span>
      </div>
      <div className="relative overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-start text-xs text-muted-foreground">
            <tr>
              <SortHead k="reference_code" label={tr("Reference")} />
              <SortHead k="priority" label={tr("Priority")} />
              <SortHead k="status" label={tr("Status")} />
              <th className="px-3 py-2 text-start font-medium">{tr("Report")}</th>
              <th className="px-3 py-2 text-start font-medium">{tr("Category")}</th>
              <th className="px-3 py-2 text-start font-medium">{tr("Source")}</th>
              <SortHead k="created_at" label={tr("Received")} end />
            </tr>
          </thead>
          <tbody>
            {reports.isLoading
              ? Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={7} className="p-2">
                      <Skeleton className="h-6" />
                    </td>
                  </tr>
                ))
              : rows.map((r) => (
                  <tr key={r.id} className={`border-b last:border-0 hover:bg-accent/40 ${r.archived_at || r.merged_into_id ? "opacity-60" : ""}`}>
                    <td className="px-3 py-2 font-mono text-xs">
                      <Link className="text-primary hover:underline" href={`/reports/${r.id}`}>
                        {r.reference_code}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <PriorityBadge priority={r.priority} />
                    </td>
                    <td className="px-3 py-2">
                      <ReportStatusBadge status={r.status} />
                    </td>
                    <td className="max-w-80 px-3 py-2">
                      <Link href={`/reports/${r.id}`} className="line-clamp-1 font-medium hover:underline" dir="auto">
                        {r.title}
                      </Link>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        {r.merged_into_id ? (
                          <>
                            <Copy className="size-3" /> {tr("merged")} ·{" "}
                          </>
                        ) : r.possible_duplicate_ids.length ? (
                          <span className="text-high">{tr("possible duplicate")} · </span>
                        ) : null}
                        {r.archived_at ? `${tr("archived")} · ` : null}
                        {r.address_text}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <CategoryLabel category={r.category} />
                    </td>
                    <td className="px-3 py-2 text-xs capitalize text-muted-foreground">{tr(r.source)}</td>
                    <td className="px-3 py-2 text-end text-xs tabular-nums text-muted-foreground">{ago(r.created_at)}</td>
                  </tr>
                ))}
          </tbody>
        </table>
        {!reports.isLoading && rows.length === 0 ? (
          <Empty title={tr("No reports match these filters")}>
            {filtered ? (
              <button type="button" className="text-primary hover:underline" onClick={reset}>
                {tr("Reset filters")}
              </button>
            ) : null}
          </Empty>
        ) : null}
      </div>
      <NewReportDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
