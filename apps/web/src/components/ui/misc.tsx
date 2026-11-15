import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} />;
}

export function Empty({ icon, title, children, className }: { icon?: React.ReactNode; title: string; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 p-8 text-center", className)}>
      {icon ? <div className="text-muted-foreground [&_svg]:size-8">{icon}</div> : null}
      <p className="text-sm font-medium">{title}</p>
      {children ? <div className="text-sm text-muted-foreground">{children}</div> : null}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 pb-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "critical" | "warning" | "ok" }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border bg-card px-3 py-2">
      <span className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={cn("text-xl font-semibold tabular-nums", tone === "critical" && "text-critical", tone === "warning" && "text-high", tone === "ok" && "text-available")}>{value}</span>
      {sub ? <span className="truncate text-xs text-muted-foreground">{sub}</span> : null}
    </div>
  );
}

type Loadable = { isError: boolean; isFetching?: boolean; error?: unknown; refetch: () => unknown };

/** Banner for failed loads. Keeps whatever data did arrive on screen and offers a retry. */
export function LoadError({ queries, what = "data", className }: { queries: Loadable[]; what?: string; className?: string }) {
  const tr = useT();
  const failed = queries.filter((q) => q.isError);
  if (!failed.length) return null;
  const retrying = failed.some((q) => q.isFetching);
  const first = failed[0].error;
  const detail = (first instanceof Error && first.message ? first.message : tr("Check your connection")).replace(/\.?\s*$/, ".");
  return (
    <div role="alert" className={cn("mb-4 flex flex-wrap items-center gap-2 rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm", className)}>
      <span className="flex-1">
        <span className="font-medium">{tr("Couldn't load")} {tr(what)}.</span>{" "}
        <span className="text-muted-foreground">{tr(detail)} {tr("What you see may be out of date.")}</span>
      </span>
      <button
        type="button"
        disabled={retrying}
        onClick={() => failed.forEach((q) => q.refetch())}
        className="rounded-md border bg-card px-3 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
      >
        {retrying ? tr("Retrying…") : tr("Retry")}
      </button>
    </div>
  );
}
