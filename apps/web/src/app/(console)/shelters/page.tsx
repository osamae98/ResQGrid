"use client";

import { ApiError, type Shelter } from "@resqgrid/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Accessibility, HeartPulse, Minus, Phone, Plus, Utensils } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { LiveMap } from "@/components/map/live-map";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { PageHeader, Stat } from "@/components/ui/misc";
import { api, errorMessage } from "@/lib/api";
import { useShelters } from "@/lib/queries";
import { can, useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

const FACILITY = { medical: HeartPulse, food: Utensils, accessibility: Accessibility };
const FACILITY_LABEL = { medical: "Medical care", food: "Food", accessibility: "Step-free access" };

export default function SheltersPage() {
  const tr = useT();
  const { user, org } = useSession();
  const shelters = useShelters();
  const list = shelters.data ?? [];
  const open = list.filter((s) => s.status !== "closed");
  return (
    <div className="p-4">
      <PageHeader title={tr("Shelters")} description={tr("Capacity and occupancy by check-in / check-out count. No personal records are kept.")} />
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={tr("Beds free")} value={open.reduce((s, x) => s + Math.max(0, x.capacity - x.occupancy), 0)} tone="ok" />
        <Stat label={tr("Occupancy")} value={open.reduce((s, x) => s + x.occupancy, 0)} sub={`${tr("of")} ${open.reduce((s, x) => s + x.capacity, 0)} ${tr("beds")}`} />
        <Stat label={tr("Full")} value={list.filter((s) => s.status === "full").length} tone={list.some((s) => s.status === "full") ? "critical" : undefined} />
        <Stat label={tr("Closed")} value={list.filter((s) => s.status === "closed").length} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((s) => (
            <ShelterCard key={s.id} s={s} editable={can.manageShelters(user?.role)} />
          ))}
        </div>
        <Card className="h-[480px] overflow-hidden">
          <LiveMap shelters={list} center={org?.operating_area.center} zoom={13} />
        </Card>
      </div>
    </div>
  );
}

function ShelterCard({ s, editable }: { s: Shelter; editable: boolean }) {
  const tr = useT();
  const qc = useQueryClient();
  const [custom, setCustom] = useState(10);
  const [override, setOverride] = useState<{ delta: number; free: number }>();
  const [reason, setReason] = useState("");
  const pct = Math.min(100, Math.round((s.occupancy / s.capacity) * 100));
  const inv = () => ["shelters", "kpis"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const occ = useMutation({
    mutationFn: ({ delta, reason }: { delta: number; reason?: string }) => api.shelters.occupancy(s.id, delta, reason),
    onSuccess: () => (setOverride(undefined), setReason(""), inv()),
    onError: (e, v) => {
      if (e instanceof ApiError && e.code === "CAPACITY_EXCEEDED") setOverride({ delta: v.delta, free: Number(e.details?.free ?? 0) });
      else toast.error(errorMessage(e));
    },
  });
  const status = useMutation({ mutationFn: (st: "open" | "closed") => api.shelters.update(s.id, { status: st }), onSuccess: inv, onError: (e) => toast.error(errorMessage(e)) });

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">{s.name}</h2>
          <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Phone className="size-3" /> {s.contact}
          </p>
        </div>
        <Badge variant={s.status === "open" ? "available" : s.status === "full" ? "critical" : "stale"}>{tr(s.status)}</Badge>
      </div>
      <div>
        <div className="mb-1 flex justify-between text-sm">
          <span>
            <strong className="tabular-nums">{s.occupancy}</strong> / {s.capacity} {tr("beds")}
          </span>
          <span className={cn("font-medium tabular-nums", s.capacity - s.occupancy <= 0 ? "text-critical" : "text-available")}>{Math.max(0, s.capacity - s.occupancy)} {tr("free")}</span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-muted" role="meter" aria-valuenow={s.occupancy} aria-valuemin={0} aria-valuemax={s.capacity} aria-label={tr("Occupancy")}>
          <div className={cn("h-full rounded-full", pct >= 100 ? "bg-critical" : pct >= 85 ? "bg-high" : "bg-available")} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="flex gap-2">
        {s.facilities.map((f) => {
          const Icon = FACILITY[f];
          return (
            <span key={f} className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs text-muted-foreground">
              <Icon className="size-3" /> {tr(FACILITY_LABEL[f])}
            </span>
          );
        })}
      </div>
      {editable ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t pt-3">
          <span className="me-1 text-xs text-muted-foreground">{tr("Check-in")}</span>
          {[1, 5].map((n) => (
            <Button key={`in${n}`} size="sm" variant="outline" disabled={s.status === "closed" || occ.isPending} onClick={() => occ.mutate({ delta: n })} aria-label={`${tr("Check in")} ${n}`}>
              <Plus /> {n}
            </Button>
          ))}
          <span className="me-1 ms-2 text-xs text-muted-foreground">{tr("out")}</span>
          {[1, 5].map((n) => (
            <Button key={`out${n}`} size="sm" variant="outline" disabled={s.occupancy < n || occ.isPending} onClick={() => occ.mutate({ delta: -n })} aria-label={`${tr("Check out")} ${n}`}>
              <Minus /> {n}
            </Button>
          ))}
          <div className="ms-auto flex items-center gap-1">
            <Input type="number" min={1} value={custom} onChange={(e) => setCustom(Number(e.target.value))} className="h-8 w-16" aria-label={tr("Custom count")} />
            <Button size="sm" variant="secondary" disabled={s.status === "closed"} onClick={() => occ.mutate({ delta: custom })}>
              {tr("In")}
            </Button>
          </div>
          <Button size="sm" variant="ghost" className="w-full" onClick={() => status.mutate(s.status === "closed" ? "open" : "closed")}>
            {s.status === "closed" ? tr("Reopen shelter") : tr("Close shelter")}
          </Button>
        </div>
      ) : null}
      <Dialog open={!!override} onOpenChange={(o) => !o && setOverride(undefined)}>
        <DialogContent title={tr("Over capacity")} description={tr("Only {free} beds are free. Checking in {n} needs an override with a reason.").replace("{free}", String(override?.free ?? 0)).replace("{n}", String(override?.delta ?? 0))}>
          <Field label={tr("Override reason")}>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tr("Overflow mats in hall, approved by site lead")} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOverride(undefined)}>
              {tr("Cancel")}
            </Button>
            <Button variant="destructive" disabled={!reason.trim()} onClick={() => override && occ.mutate({ delta: override.delta, reason })}>
              {tr("Override and check in")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
