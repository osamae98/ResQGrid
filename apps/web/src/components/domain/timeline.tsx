"use client";

import type { TimelineEvent } from "@resqgrid/api-client";
import { dateTime, REPORT_STATUS_LABEL, TASK_STATUS_LABEL } from "@/lib/format";
import { tx, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function Timeline({ events, className }: { events?: TimelineEvent[]; className?: string }) {
  const tr = useT();
  if (!events?.length) return <p className="text-sm text-muted-foreground">{tr("No events yet.")}</p>;
  return (
    <ol className={cn("relative ms-2 border-s ps-4", className)}>
      {events.map((e) => (
        <li key={e.id} className="relative pb-3 last:pb-0">
          <span
            className={cn(
              "absolute -start-[21px] top-1.5 size-2.5 rounded-full border-2 border-card bg-muted-foreground",
              (e.type === "escalated" || e.type === "override" || e.type === "declined") && "bg-critical",
              (e.to_status === "completed" || e.to_status === "resolved") && "bg-available",
            )}
          />
          <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-medium">{label(e)}</span>
            <time className="text-xs text-muted-foreground tabular-nums">{dateTime(e.occurred_at)}</time>
          </div>
          {e.actor_name ? <div className="text-xs text-muted-foreground">{tr("by")} {e.actor_name}</div> : null}
          {e.note ? <p className="mt-0.5 text-xs text-foreground/80" dir="auto">{e.note}</p> : null}
        </li>
      ))}
    </ol>
  );
}

function label(e: TimelineEvent) {
  // Status names come from either the report or the task state machine.
  const s = (x?: string) => tx((x && ((REPORT_STATUS_LABEL as Record<string, string>)[x] ?? (TASK_STATUS_LABEL as Record<string, string>)[x])) ?? x?.replaceAll("_", " ") ?? "");
  if (e.type === "status_changed" && e.to_status) return e.from_status ? `${s(e.from_status)} → ${s(e.to_status)}` : s(e.to_status);
  return tx(e.type.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase()));
}
