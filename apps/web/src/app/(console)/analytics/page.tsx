"use client";

import type { ResponseTimeRow } from "@resqgrid/api-client";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { LoadError, PageHeader, Stat } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { CATEGORY_LABEL, duration, weekday } from "@/lib/format";
import { useKpis } from "@/lib/queries";
import { tx, useT } from "@/lib/i18n";

type GroupBy = "category" | "priority" | "team" | "incident";
const MILESTONES = [
  ["triage", "Triage"],
  ["assign", "Assign"],
  ["accept", "Accept"],
  ["on_site", "On site"],
  ["resolve", "Resolve"],
] as const;

const groupLabel = (g: string, by: GroupBy) => tx(by === "category" ? CATEGORY_LABEL[g as keyof typeof CATEGORY_LABEL] ?? g : g.replace(/^\w/, (c) => c.toUpperCase()));

const axis = { stroke: "var(--muted-foreground)", fontSize: 12, tickLine: false, axisLine: false } as const;

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string; payload: Record<string, unknown> }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-card px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-medium text-foreground">{label}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 text-muted-foreground">
          <span className="size-2 rounded-sm" style={{ background: p.color }} />
          <span>{p.name}</span>
          <span className="ms-auto ps-3 font-medium tabular-nums text-foreground">{typeof p.payload.p90 === "number" ? duration(p.value) : p.value}</span>
        </div>
      ))}
      {typeof payload[0].payload.p90 === "number" ? <div className="mt-1 text-muted-foreground">p90 {duration(payload[0].payload.p90 as number)}</div> : null}
    </div>
  );
}

export default function AnalyticsPage() {
  const tr = useT();
  const [by, setBy] = useState<GroupBy>("category");
  const [group, setGroup] = useState<string>();
  const kpis = useKpis();
  const rt = useQuery({ queryKey: ["analytics", "rt", by], queryFn: () => api.analytics.responseTimes(by) });
  const perf = useQuery({ queryKey: ["analytics", "perf"], queryFn: api.analytics.teamPerformance });
  const daily = useQuery({ queryKey: ["analytics", "daily"], queryFn: api.analytics.daily });
  useEffect(() => setGroup(undefined), [by]);

  const row: ResponseTimeRow | undefined = rt.data?.find((r) => r.group === group) ?? rt.data?.[0];
  const funnel = row
    ? MILESTONES.map(([k, label]) => ({ name: tr(label), median: row[k].median_s ?? 0, p90: row[k].p90_s ?? 0, label: duration(row[k].median_s) }))
    : [];
  const k = kpis.data;

  return (
    <div className="flex flex-col gap-4 p-4">
      <PageHeader
        title={tr("Analytics")}
        description={tr("Time from report to each milestone. Medians and p90.")}
        actions={
          <>
            {(["reports", "tasks", "team-performance"] as const).map((n) => (
              <Button key={n} variant="outline" size="sm" asChild>
                <a href={api.analytics.exportUrl(n)}>
                  <Download /> {n}.csv
                </a>
              </Button>
            ))}
          </>
        }
      />
      <LoadError queries={[kpis, rt, perf, daily]} what="analytics" className="mb-0" />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <Stat label={tr("Open reports")} value={k?.open_reports ?? "–"} />
        <Stat label={tr("Critical open")} value={k?.critical_open ?? "–"} tone={k?.critical_open ? "critical" : undefined} />
        <Stat label={tr("Unassigned > 5 min")} value={k?.unassigned_over_5m ?? "–"} />
        <Stat label={tr("Teams available")} value={k?.teams.available ?? "–"} sub={k ? `${k.teams.busy} ${tr("busy")} · ${k.teams.stale} ${tr("stale")}` : undefined} />
        <Stat label={tr("Units deployed")} value={k ? `${k.units.deployed} / ${k.units.available + k.units.reserved + k.units.deployed + k.units.unavailable}` : "–"} sub={k ? `${k.units.available} ${tr("available")}` : undefined} />
        <Stat label={tr("Units unavailable")} value={k?.units.unavailable ?? "–"} />
        <Stat label={tr("Shelter beds free")} value={k?.shelter_beds_free ?? "–"} sub={k ? `${tr("of")} ${k.shelter_beds_total}` : undefined} />
      </div>

      {/* One filter row above the charts. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">{tr("Group by")}</span>
        <Select className="w-36" value={by} onChange={(e) => setBy(e.target.value as GroupBy)} aria-label={tr("Group by")}>
          <option value="category">{tr("Category")}</option>
          <option value="priority">{tr("Priority")}</option>
          <option value="team">{tr("Team")}</option>
          <option value="incident">{tr("Incident")}</option>
        </Select>
        <Select className="w-56" value={row?.group ?? ""} onChange={(e) => setGroup(e.target.value)} aria-label={tr("Group")}>
          {rt.data?.map((r) => (
            <option key={r.group} value={r.group}>
              {groupLabel(r.group, by)} ({r.count})
            </option>
          ))}
        </Select>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{tr("Response-time funnel")} · {row ? groupLabel(row.group, by) : ""}</CardTitle>
            <CardDescription>{tr("Median time from report to each milestone")} ({row?.count ?? 0} {tr("reports")})</CardDescription>
          </CardHeader>
          <CardContent className="h-64">
            <div dir="ltr" className="h-full">
            <ResponsiveContainer>
              <BarChart data={funnel} layout="vertical" margin={{ left: 8, right: 56 }}>
                <CartesianGrid horizontal={false} stroke="var(--border)" />
                <XAxis type="number" {...axis} tickFormatter={(v) => duration(v)} />
                <YAxis type="category" dataKey="name" {...axis} width={88} />
                <Tooltip cursor={{ fill: "var(--accent)" }} content={<ChartTooltip />} />
                <Bar dataKey="median" name={tr("Median")} fill="var(--series-1)" radius={[0, 4, 4, 0]} barSize={18}>
                  <LabelList dataKey="label" position="right" style={{ fill: "var(--muted-foreground)", fontSize: 12 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{tr("Reports per day")}</CardTitle>
            <CardDescription>{tr("Last 7 days")}</CardDescription>
          </CardHeader>
          <CardContent className="h-64">
            <div className="mb-2 flex gap-4 text-xs text-muted-foreground" aria-label={tr("Legend")}>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm bg-[var(--series-1)]" /> {tr("Received")}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm bg-[var(--series-2)]" /> {tr("Resolved")}
              </span>
            </div>
            <div dir="ltr" className="h-[88%]">
            <ResponsiveContainer>
              <BarChart data={daily.data?.map((d) => ({ ...d, day: weekday(d.date) }))} barGap={2}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="day" {...axis} />
                <YAxis {...axis} allowDecimals={false} width={28} />
                <Tooltip cursor={{ fill: "var(--accent)" }} content={<ChartTooltip />} />
                <Bar dataKey="reports" name={tr("Received")} fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={22} />
                <Bar dataKey="resolved" name={tr("Resolved")} fill="var(--series-2)" radius={[4, 4, 0, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{tr("Time to milestone by")} {tr(by)}</CardTitle>
          <CardDescription>{tr("Median / p90 from report received")}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 text-start font-medium">{tr(by)}</th>
                <th className="py-2 text-end font-medium">{tr("Reports")}</th>
                {MILESTONES.map(([key, label]) => (
                  <th key={key} className="py-2 text-end font-medium">
                    {tr(label)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rt.data?.map((r) => (
                <tr key={r.group} className="border-b last:border-0">
                  <td className="py-2">{groupLabel(r.group, by)}</td>
                  <td className="py-2 text-end tabular-nums">{r.count}</td>
                  {MILESTONES.map(([key]) => (
                    <td key={key} className="py-2 text-end tabular-nums">
                      {duration(r[key].median_s)} <span className="text-xs text-muted-foreground">/ {duration(r[key].p90_s)}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tr("Team performance")}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 text-start font-medium">{tr("Team")}</th>
                <th className="py-2 text-end font-medium">{tr("Completed")}</th>
                <th className="py-2 text-end font-medium">{tr("Open")}</th>
                <th className="py-2 text-end font-medium">{tr("Decline rate")}</th>
                <th className="py-2 text-end font-medium">{tr("Median to on-site")}</th>
              </tr>
            </thead>
            <tbody>
              {perf.data?.map((t) => (
                <tr key={t.team_id} className="border-b last:border-0">
                  <td className="py-2">{t.team_name}</td>
                  <td className="py-2 text-end tabular-nums">{t.tasks_completed}</td>
                  <td className="py-2 text-end tabular-nums">{t.open_tasks}</td>
                  <td className="py-2 text-end tabular-nums">{Math.round(t.decline_rate * 100)}%</td>
                  <td className="py-2 text-end tabular-nums">{duration(t.on_site_median_s)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
