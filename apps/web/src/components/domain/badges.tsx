"use client";

import type { Category, Priority, ReportStatus, TaskStatus, Team } from "@resqgrid/api-client";
import {
  ChevronDown,
  ChevronsUp,
  CircleAlert,
  Minus,
  CheckCircle2,
  CircleDashed,
  CircleDot,
  CircleHelp,
  Clock,
  Construction,
  Flame,
  HeartPulse,
  House,
  LifeBuoy,
  Loader,
  MapPin,
  Navigation,
  Package,
  Truck,
  Waves,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CATEGORY_LABEL, PRIORITY_LABEL, REPORT_STATUS_LABEL, TASK_STATUS_LABEL } from "@/lib/format";
import { capName } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// Never colour alone: priority and status always carry icon/mark + label + colour (§13.1).
/** Priority icons (shape + colour, so priority never relies on colour alone): alert, ⇈, −, ⌄. */
export const PRIORITY_ICON: Record<Priority, typeof Flame> = { critical: CircleAlert, high: ChevronsUp, medium: Minus, low: ChevronDown };

export function PriorityIcon({ priority, className }: { priority: Priority; className?: string }) {
  const Icon = PRIORITY_ICON[priority];
  return <Icon aria-hidden className={cn("size-3.5 shrink-0", className)} strokeWidth={2.5} />;
}

export function PriorityBadge({ priority, className, compact }: { priority: Priority; className?: string; compact?: boolean }) {
  const t = useT();
  return (
    <Badge variant={priority} className={cn("font-semibold", className)}>
      <PriorityIcon priority={priority} />
      {compact ? <span className="sr-only">{t(PRIORITY_LABEL[priority])}</span> : t(PRIORITY_LABEL[priority])}
    </Badge>
  );
}

export const CATEGORY_ICON: Record<Category, typeof Flame> = {
  medical: HeartPulse,
  fire: Flame,
  flood: Waves,
  rescue: LifeBuoy,
  shelter: House,
  food_water: Package,
  road_block: Construction,
  other: CircleHelp,
};

export function CategoryLabel({ category, className, iconOnly }: { category: Category; className?: string; iconOnly?: boolean }) {
  const t = useT();
  const Icon = CATEGORY_ICON[category];
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs text-muted-foreground", className)} title={t(CATEGORY_LABEL[category])}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {iconOnly ? <span className="sr-only">{t(CATEGORY_LABEL[category])}</span> : t(CATEGORY_LABEL[category])}
    </span>
  );
}

export const REPORT_STATUS_ICON: Record<ReportStatus, typeof Clock> = {
  new: CircleDot,
  triaged: CircleDashed,
  assigned: Truck,
  in_progress: Navigation,
  resolved: CheckCircle2,
  closed: CheckCircle2,
};

export function ReportStatusBadge({ status }: { status: ReportStatus }) {
  const t = useT();
  const Icon = REPORT_STATUS_ICON[status];
  return (
    <Badge variant={status === "new" ? "danger" : status === "resolved" || status === "closed" ? "available" : status === "triaged" ? "outline" : "busy"}>
      <Icon aria-hidden />
      {t(REPORT_STATUS_LABEL[status])}
    </Badge>
  );
}

const TASK_STATUS_ICON: Record<TaskStatus, typeof Clock> = {
  pending: Clock,
  accepted: Loader,
  en_route: Navigation,
  on_site: MapPin,
  completed: CheckCircle2,
  cancelled: XCircle,
};

export function TaskStatusBadge({ status, unassigned }: { status: TaskStatus; unassigned?: boolean }) {
  const t = useT();
  const Icon = TASK_STATUS_ICON[status];
  if (unassigned) return <Badge variant="danger"><Clock aria-hidden />{t("Needs team")}</Badge>;
  return (
    <Badge variant={status === "completed" ? "available" : status === "cancelled" ? "stale" : status === "pending" ? "warning" : "busy"}>
      <Icon aria-hidden />
      {t(TASK_STATUS_LABEL[status])}
    </Badge>
  );
}

export function TeamStateBadge({ team }: { team: Pick<Team, "availability" | "is_stale"> }) {
  const tr = useT();
  if (team.is_stale)
    return (
      <Badge variant="stale">
        <Clock aria-hidden />
        {tr("Stale")}
      </Badge>
    );
  const label = { available: "Available", busy: "Busy", off_duty: "Off duty" }[team.availability];
  return (
    <Badge variant={team.availability === "available" ? "available" : team.availability === "busy" ? "busy" : "stale"}>
      <span aria-hidden className={cn("size-2 rounded-full", team.availability === "available" ? "bg-available" : team.availability === "busy" ? "bg-busy" : "bg-stale")} />
      {tr(label)}
    </Badge>
  );
}

export function CapabilityChip({ k, ok, expired }: { k: string; ok?: boolean; expired?: boolean }) {
  const tr = useT();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px]",
        ok === true && "border-available/40 text-available",
        ok === false && "border-critical/40 text-critical",
        expired && "border-dashed text-muted-foreground line-through",
      )}
    >
      {ok === true ? "✓" : ok === false ? "✗" : null}
      {tr(capName(k))}
    </span>
  );
}
