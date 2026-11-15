"use client";

import type { Resource } from "@resqgrid/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Wrench } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { PageHeader, Stat } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, errorMessage } from "@/lib/api";
import { useResources, useTeams } from "@/lib/queries";
import { can, useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

export default function ResourcesPage() {
  const tr = useT();
  const { user } = useSession();
  const resources = useResources();
  const teams = useTeams();
  const units = resources.data?.filter((r) => r.kind === "unit") ?? [];
  const stock = useMemo(() => resources.data?.filter((r) => r.kind === "stock") ?? [], [resources.data]);
  const volunteers = teams.data?.filter((t) => t.is_volunteer).flatMap((t) => t.members) ?? [];
  const byDepot = useMemo(() => {
    const m = new Map<string, Resource[]>();
    for (const r of stock) m.set(r.depot_name ?? "—", [...(m.get(r.depot_name ?? "—") ?? []), r]);
    return [...m.entries()];
  }, [stock]);
  const count = (s: Resource["status"]) => units.filter((u) => u.status === s).length;

  return (
    <div className="p-4">
      <PageHeader title={tr("Resources")} description={tr("Units are tracked individually, stock by quantity per depot. Every change is transactional and audited.")} />
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat label={tr("Units available")} value={count("available")} tone="ok" />
        <Stat label={tr("Reserved")} value={count("reserved")} />
        <Stat label={tr("Deployed")} value={count("deployed")} />
        <Stat label={tr("Unavailable")} value={count("unavailable")} tone={count("unavailable") ? "warning" : undefined} />
        <Stat label={tr("Volunteers on duty")} value={volunteers.filter((m) => m.on_duty).length} sub={`${volunteers.filter((m) => !m.on_duty).length} ${tr("off duty")}`} />
      </div>
      <Tabs defaultValue="units">
        <TabsList>
          <TabsTrigger value="units">{tr("Units")} ({units.length})</TabsTrigger>
          <TabsTrigger value="stock">{tr("Stock")} ({stock.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="units" className="mt-3">
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">{tr("Unit")}</th>
                  <th className="px-3 py-2 text-start font-medium">{tr("Type")}</th>
                  <th className="px-3 py-2 text-start font-medium">{tr("Status")}</th>
                  <th className="px-3 py-2 text-start font-medium">{tr("Depot")}</th>
                  <th className="px-3 py-2 text-start font-medium">{tr("Assignment")}</th>
                  <th className="px-3 py-2 text-end font-medium" />
                </tr>
              </thead>
              <tbody>
                {units.map((u) => (
                  <UnitRow key={u.id} u={u} editable={can.manageResources(user?.role)} />
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>
        <TabsContent value="stock" className="mt-3 flex flex-col gap-4">
          {byDepot.map(([depot, items]) => (
            <section key={depot}>
              <h2 className="mb-2 text-sm font-semibold">{depot}</h2>
              <div className="overflow-x-auto rounded-lg border bg-card">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-start font-medium">{tr("Item")}</th>
                      <th className="px-3 py-2 text-end font-medium">{tr("On hand")}</th>
                      <th className="px-3 py-2 text-end font-medium">{tr("Reserved")}</th>
                      <th className="px-3 py-2 text-end font-medium">{tr("Available")}</th>
                      <th className="px-3 py-2 text-end font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((s) => (
                      <StockRow key={s.id} s={s} editable={can.manageResources(user?.role)} />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function UnitRow({ u, editable }: { u: Resource; editable: boolean }) {
  const tr = useT();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const inv = () => ["resources", "kpis"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const m = useMutation({
    mutationFn: (available: boolean) => (available ? api.resources.markAvailable(u.id) : api.resources.markUnavailable(u.id, reason)),
    onSuccess: () => (setOpen(false), setReason(""), inv()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <tr className="border-b last:border-0">
      <td className="px-3 py-2 font-medium">{u.name}</td>
      <td className="px-3 py-2 capitalize text-muted-foreground">{tr(u.type)}</td>
      <td className="px-3 py-2">
        <Badge variant={u.status === "available" ? "available" : u.status === "unavailable" ? "stale" : u.status === "reserved" ? "outline" : "busy"}>{tr(u.status ?? "")}</Badge>
        {u.unavailable_reason ? <span className="ms-2 text-xs text-muted-foreground">{u.unavailable_reason}</span> : null}
      </td>
      <td className="px-3 py-2 text-muted-foreground">{u.depot_name}</td>
      <td className="px-3 py-2">
        {u.active_task_id ? (
          <Link className="text-primary hover:underline" href={`/tasks/${u.active_task_id}`}>
            {tr("View task")}
          </Link>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-end">
        {editable && u.status === "available" ? (
          <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
            <Wrench /> {tr("Mark unavailable")}
          </Button>
        ) : null}
        {editable && u.status === "unavailable" ? (
          <Button size="sm" variant="outline" onClick={() => m.mutate(true)}>
            {tr("Back in service")}
          </Button>
        ) : null}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent title={`${u.name}: ${tr("Mark unavailable")}`}>
            <Field label={tr("Reason (maintenance, broken…)")}>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <div className="flex justify-end">
              <Button disabled={!reason.trim()} onClick={() => m.mutate(false)}>
                {tr("Mark unavailable")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </td>
    </tr>
  );
}

function StockRow({ s, editable }: { s: Resource; editable: boolean }) {
  const tr = useT();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [delta, setDelta] = useState(0);
  const [reason, setReason] = useState("");
  const available = (s.on_hand ?? 0) - (s.reserved ?? 0);
  const low = s.low_stock_threshold !== undefined && (s.on_hand ?? 0) < s.low_stock_threshold;
  const m = useMutation({
    mutationFn: () => api.resources.adjustStock(s.id, delta, reason),
    onSuccess: () => (toast.success(tr("Stock adjusted")), setOpen(false), setDelta(0), setReason(""), qc.invalidateQueries({ queryKey: ["resources"] })),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <tr className="border-b last:border-0">
      <td className="px-3 py-2">
        <span className="font-medium">{tr(s.name)}</span>
        {low ? (
          <Badge variant="warning" className="ms-2">
            <AlertTriangle /> {tr("low")} (&lt; {s.low_stock_threshold})
          </Badge>
        ) : null}
      </td>
      <td className="px-3 py-2 text-end tabular-nums">
        {s.on_hand} <span className="text-xs text-muted-foreground">{tr(s.unit_label ?? "")}</span>
      </td>
      <td className="px-3 py-2 text-end tabular-nums text-muted-foreground">{s.reserved}</td>
      <td className={cn("px-3 py-2 text-end font-semibold tabular-nums", low && "text-high")}>{available}</td>
      <td className="px-3 py-2 text-end">
        {editable ? (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            {tr("Adjust")}
          </Button>
        ) : null}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent title={`${tr("Adjust")}: ${tr(s.name)}`} description={`${s.on_hand} ${tr("on hand")}، ${s.reserved} ${tr("reserved")}. ${tr("On hand can't drop below reserved.")}`}>
            <Field label={`${tr("Change")} (${tr(s.unit_label ?? "")}) — ${tr("negative to remove")}`}>
              <Input type="number" value={delta || ""} onChange={(e) => setDelta(Number(e.target.value))} />
            </Field>
            <Field label={tr("Reason")}>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tr("Restock from donor, damaged, count correction…")} />
            </Field>
            <div className="flex justify-end">
              <Button disabled={!delta || !reason.trim() || m.isPending} onClick={() => m.mutate()}>
                {tr("Save movement")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </td>
    </tr>
  );
}
