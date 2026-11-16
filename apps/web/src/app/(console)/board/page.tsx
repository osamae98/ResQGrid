"use client";

import type { Task, TaskStatus } from "@resqgrid/api-client";
import { AlertTriangle, Clock, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { CategoryLabel, PriorityBadge, TaskStatusBadge } from "@/components/domain/badges";
import { Badge } from "@/components/ui/badge";
import { LoadError, PageHeader } from "@/components/ui/misc";
import { ago, since, TASK_STATUS_LABEL } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { useTasks, useTeams } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

const COLUMNS: TaskStatus[] = ["pending", "accepted", "en_route", "on_site", "completed"];
const ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

export default function BoardPage() {
  const tr = useT();
  const tasks = useTasks();
  const teams = useTeams();
  const now = useNow(1000);
  const staleTeams = useMemo(() => new Set(teams.data?.filter((t) => t.is_stale).map((t) => t.id)), [teams.data]);
  const today = new Date().toISOString().slice(0, 10);

  const columns = useMemo(() => {
    const by: Record<string, Task[]> = {};
    for (const c of COLUMNS) by[c] = [];
    for (const t of tasks.data ?? []) {
      if (t.status === "cancelled") continue;
      if (t.status === "completed" && t.completed_at?.slice(0, 10) !== today) continue;
      by[t.status].push(t);
    }
    for (const c of COLUMNS)
      by[c].sort((a, b) => b.escalation_level - a.escalation_level || ORDER[a.report.priority] - ORDER[b.report.priority] || (a.created_at < b.created_at ? -1 : 1));
    return by;
  }, [tasks.data, today]);

  return (
    <div className="flex h-full flex-col p-4">
      <PageHeader title={tr("Dispatch board")} description={tr("Tasks by status. Escalated and stale tasks are highlighted.")} />
      <LoadError queries={[tasks, teams]} what="tasks" />
      <div className="relative grid min-h-0 flex-1 auto-cols-[minmax(224px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2">
        {COLUMNS.map((c) => (
          <section key={c} className="flex min-h-0 flex-col rounded-lg bg-muted/50" aria-label={tr(TASK_STATUS_LABEL[c])}>
            <header className="flex items-center justify-between px-3 py-2 text-sm font-medium">
              <span>
                {tr(TASK_STATUS_LABEL[c])}
                {c === "completed" ? <span className="text-xs font-normal text-muted-foreground"> · {tr("today")}</span> : null}
              </span>
              <span className="rounded-full bg-card px-2 text-xs tabular-nums">{columns[c].length}</span>
            </header>
            <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
              {columns[c].map((t) => (
                <BoardCard key={t.id} t={t} now={now} stale={!!t.assigned_team_id && staleTeams.has(t.assigned_team_id)} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function BoardCard({ t, now, stale }: { t: Task; now: number; stale: boolean }) {
  const tr = useT();
  const ts = { pending: t.assigned_at ?? t.created_at, accepted: t.accepted_at, en_route: t.en_route_at, on_site: t.on_site_at, completed: t.completed_at, cancelled: t.cancelled_at }[t.status];
  return (
    <li>
      <Link
        href={`/tasks/${t.id}`}
        className={cn(
          "flex flex-col gap-1.5 rounded-md border bg-card p-2.5 text-sm shadow-xs hover:border-primary",
          t.escalation_level > 0 && "border-critical ring-1 ring-critical",
          stale && "border-dashed border-stale",
        )}
      >
        <div className="flex items-center gap-1.5">
          <PriorityBadge priority={t.report.priority} />
          {t.status === "pending" && !t.assigned_team_id ? <TaskStatusBadge status="pending" unassigned /> : null}
          {t.escalation_level ? (
            <Badge variant="critical">
              <AlertTriangle /> L{t.escalation_level}
            </Badge>
          ) : null}
          {t.override_reason ? (
            <Badge variant="warning" title={t.override_reason}>
              <ShieldAlert /> {tr("override")}
            </Badge>
          ) : null}
          <span className="ms-auto font-mono text-[11px] text-muted-foreground">{t.report.reference_code}</span>
        </div>
        <span className="line-clamp-2 font-medium" dir="auto">{t.report.title}</span>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CategoryLabel category={t.report.category} iconOnly />
          <span className="truncate">{t.team_name ?? tr("No team")}</span>
          {stale ? (
            <span className="inline-flex items-center gap-0.5 text-stale">
              <Clock className="size-3" /> {tr("stale")}
            </span>
          ) : null}
          <span className="ms-auto shrink-0 whitespace-nowrap tabular-nums">{t.status === "completed" ? ago(ts, now) : since(ts, now)}</span>
        </div>
      </Link>
    </li>
  );
}
