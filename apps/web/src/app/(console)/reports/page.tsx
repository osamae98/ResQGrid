"use client";

import { CATEGORIES, PRIORITIES, REPORT_STATUSES, type Category, type Priority, type ReportStatus } from "@resqgrid/api-client";
import { Copy, Download, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { CategoryLabel, PriorityBadge, ReportStatusBadge } from "@/components/domain/badges";
import { NewReportDialog } from "@/components/dispatch/new-report-dialog";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Empty, LoadError, PageHeader, Skeleton } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { ago, CATEGORY_LABEL, PRIORITY_LABEL, REPORT_STATUS_LABEL } from "@/lib/format";
import { useReports } from "@/lib/queries";
import { can, useSession } from "@/lib/session";
import { useT } from "@/lib/i18n";

export default function ReportsPage() {
  const tr = useT();
  const { user } = useSession();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<ReportStatus | "">("");
  const [priority, setPriority] = useState<Priority | "">("");
  const [category, setCategory] = useState<Category | "">("");
  const [archived, setArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const reports = useReports({
    q: q || undefined,
    status: status ? [status] : undefined,
    priority: priority ? [priority] : undefined,
    category: category ? [category] : undefined,
    include_archived: archived,
  });

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
        <Select className="w-36" value={status} onChange={(e) => setStatus(e.target.value as ReportStatus)} aria-label={tr("Status")}>
          <option value="">{tr("Any status")}</option>
          {REPORT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {tr(REPORT_STATUS_LABEL[s])}
            </option>
          ))}
        </Select>
        <Select className="w-36" value={priority} onChange={(e) => setPriority(e.target.value as Priority)} aria-label={tr("Priority")}>
          <option value="">{tr("Any priority")}</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {tr(PRIORITY_LABEL[p])}
            </option>
          ))}
        </Select>
        <Select className="w-40" value={category} onChange={(e) => setCategory(e.target.value as Category)} aria-label={tr("Category")}>
          <option value="">{tr("Any category")}</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {tr(CATEGORY_LABEL[c])}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> {tr("Include archived")}
        </label>
        <span className="ms-auto text-sm text-muted-foreground">{reports.data?.total ?? 0} {tr("reports")}</span>
      </div>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-start text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-start font-medium">{tr("Reference")}</th>
              <th className="px-3 py-2 text-start font-medium">{tr("Priority")}</th>
              <th className="px-3 py-2 text-start font-medium">{tr("Status")}</th>
              <th className="px-3 py-2 text-start font-medium">{tr("Report")}</th>
              <th className="px-3 py-2 text-start font-medium">{tr("Category")}</th>
              <th className="px-3 py-2 text-start font-medium">{tr("Source")}</th>
              <th className="px-3 py-2 text-end font-medium">{tr("Received")}</th>
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
              : reports.data?.items.map((r) => (
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
        {reports.data?.items.length === 0 ? <Empty title={tr("No reports match these filters")} /> : null}
      </div>
      <NewReportDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
