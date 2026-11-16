"use client";

import type { Report, Task } from "@resqgrid/api-client";
import { Copy, Search, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CategoryLabel, PriorityBadge, ReportStatusBadge } from "@/components/domain/badges";
import { Input } from "@/components/ui/input";
import { Empty, Skeleton } from "@/components/ui/misc";
import { ago, since } from "@/lib/format";
import { useFlashKey, useNow } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

type Filter = "action" | "active" | "all";

export function ReportQueue({
  reports,
  tasks,
  loading,
  selectedId,
  onSelect,
}: {
  reports?: Report[];
  tasks?: Task[];
  loading?: boolean;
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const tr = useT();
  const [filter, setFilter] = useState<Filter>("action");
  const [q, setQ] = useState("");
  const now = useNow(1000);
  const listRef = useRef<HTMLUListElement>(null);

  const needsTeam = useMemo(() => new Set(tasks?.filter((t) => t.status === "pending" && !t.assigned_team_id).map((t) => t.report_id)), [tasks]);

  const rows = useMemo(() => {
    const open = (reports ?? []).filter((r) => !r.merged_into_id && !["resolved", "closed"].includes(r.status));
    const f = open.filter((r) =>
      filter === "action" ? r.status === "new" || r.status === "triaged" || needsTeam.has(r.id) : filter === "active" ? r.status === "assigned" || r.status === "in_progress" : true,
    );
    const text = q.trim().toLowerCase();
    return text ? f.filter((r) => `${r.reference_code} ${r.title} ${r.address_text}`.toLowerCase().includes(text)) : f;
  }, [reports, filter, q, needsTeam]);

  const counts = useMemo(() => {
    const open = (reports ?? []).filter((r) => !r.merged_into_id && !["resolved", "closed"].includes(r.status));
    return {
      action: open.filter((r) => r.status === "new" || r.status === "triaged" || needsTeam.has(r.id)).length,
      active: open.filter((r) => r.status === "assigned" || r.status === "in_progress").length,
      all: open.length,
    };
  }, [reports, needsTeam]);

  // Keyboard: ↑/↓ or j/k move through the queue (§12.1 full keyboard use).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const idx = rows.findIndex((r) => r.id === selectedId);
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        const next = rows[Math.min(rows.length - 1, idx + 1)];
        if (next) onSelect(next.id);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        const prev = rows[Math.max(0, idx - 1)];
        if (prev) onSelect(prev.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, selectedId, onSelect]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-id="${selectedId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-2 border-b p-2">
        <div className="flex gap-1 rounded-lg bg-muted p-1 text-xs" role="tablist" aria-label={tr("Queue filter")}>
          {(
            [
              ["action", "Needs action"],
              ["active", "Active"],
              ["all", "All open"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={filter === k}
              onClick={() => setFilter(k)}
              className={cn(
                "flex flex-auto items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1.5 font-medium text-muted-foreground transition-colors hover:text-foreground",
                filter === k && "bg-card text-foreground shadow-xs",
              )}
            >
              <span>{tr(label)}</span>
              <span
                className={cn(
                  "min-w-5 shrink-0 rounded-full px-1.5 text-center text-[11px] font-semibold tabular-nums leading-5",
                  filter === k ? (k === "action" && counts[k] ? "bg-critical text-white" : "bg-primary/10 text-primary") : "bg-foreground/10",
                )}
              >
                {counts[k]}
              </span>
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute start-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Search reference, text, street")} className="ps-8" aria-label={tr("Search queue")} />
        </div>
      </div>
      <ul ref={listRef} className="min-h-0 flex-1 overflow-y-auto" aria-label={tr("Report queue")}>
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <li key={i} className="p-3">
              <Skeleton className="h-14" />
            </li>
          ))
        ) : rows.length === 0 ? (
          q.trim() ? (
            <Empty title={tr("No matches")}>
              {tr("Nothing in this view matches")} “{q.trim()}”.{" "}
              <button type="button" className="text-primary hover:underline" onClick={() => setQ("")}>
                {tr("Clear search")}
              </button>
            </Empty>
          ) : filter === "action" ? (
            <Empty title={tr("Queue is clear")}>{tr("Nothing needs action right now.")}</Empty>
          ) : filter === "active" ? (
            <Empty title={tr("No active reports")}>{tr("No team is working on a report right now.")}</Empty>
          ) : (
            <Empty title={tr("No open reports")}>{tr("Every report is resolved or closed.")}</Empty>
          )
        ) : (
          rows.map((r) => <QueueRow key={r.id} r={r} now={now} selected={r.id === selectedId} needsTeam={needsTeam.has(r.id)} onSelect={onSelect} />)
        )}
      </ul>
    </div>
  );
}

function QueueRow({ r, now, selected, needsTeam, onSelect }: { r: Report; now: number; selected: boolean; needsTeam: boolean; onSelect: (id: string) => void }) {
  const tr = useT();
  const flashKey = useFlashKey(r.id, r.updated_at + r.status);
  const unassigned = r.status === "new" || r.status === "triaged" || needsTeam;
  return (
    <li key={flashKey} data-id={r.id} className={cn("border-b", flashKey.endsWith("-0") ? "" : "rq-flash")}>
      <button
        onClick={() => onSelect(r.id)}
        aria-current={selected}
        className={cn(
          "flex w-full flex-col gap-1 px-3 py-2.5 text-start hover:bg-accent/60",
          selected && "bg-accent",
          r.priority === "critical" && unassigned && "border-s-4 border-s-critical",
        )}
      >
        <div className="flex items-center gap-1.5">
          <PriorityBadge priority={r.priority} />
          <ReportStatusBadge status={r.status} />
          {needsTeam ? (
            <span className="inline-flex items-center gap-1 text-xs text-critical">
              <Users className="size-3" /> {tr("declined")}
            </span>
          ) : null}
          {r.possible_duplicate_ids.length ? (
            <span className="inline-flex items-center gap-1 text-xs text-high" title={tr("Possible duplicate")}>
              <Copy className="size-3" /> {tr("Duplicate?")}
            </span>
          ) : null}
          <span className="ms-auto font-mono text-[11px] text-muted-foreground">{r.reference_code}</span>
        </div>
        <div className="line-clamp-1 text-sm font-medium" dir="auto">{r.title}</div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CategoryLabel category={r.category} />
          <span className="truncate" dir="auto">{r.address_text}</span>
          <span className={cn("ms-auto shrink-0 tabular-nums", unassigned && r.priority === "critical" && "font-semibold text-critical")}>
            {unassigned ? `${tr("unassigned")} ${since(r.created_at, now)}` : ago(r.created_at, now)}
          </span>
        </div>
      </button>
    </li>
  );
}
