"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { Empty, PageHeader } from "@/components/ui/misc";
import { LiveMap } from "@/components/map/live-map";
import { api, errorMessage } from "@/lib/api";
import { dateTime, km } from "@/lib/format";
import { useIncidents } from "@/lib/queries";
import { can, useSession } from "@/lib/session";
import type { LatLng } from "@resqgrid/api-client";
import { useT } from "@/lib/i18n";

export default function IncidentsPage() {
  const tr = useT();
  const { user, org } = useSession();
  const incidents = useIncidents();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState("flood");
  const [radius, setRadius] = useState(2);
  const [center, setCenter] = useState<LatLng>();
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: () => api.incidents.create({ title, type, radius_km: radius, center: center ?? org!.operating_area.center }),
    onSuccess: () => {
      toast.success(tr("Incident created"));
      setOpen(false);
      setTitle("");
      qc.invalidateQueries({ queryKey: ["incidents"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="p-4">
      <PageHeader
        title={tr("Incidents")}
        description={tr("Group reports, tasks and resources under one operation.")}
        actions={
          can.dispatch(user?.role) ? (
            <Button onClick={() => setOpen(true)}>
              <Plus /> {tr("New incident")}
            </Button>
          ) : null
        }
      />
      {incidents.data?.length === 0 ? <Empty icon={<ShieldAlert />} title={tr("No incidents yet")} /> : null}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {incidents.data?.map((i) => (
          <Link key={i.id} href={`/incidents/${i.id}`}>
            <Card className="flex h-full flex-col gap-3 p-4 hover:border-primary">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold">{i.title}</h2>
                  <p className="text-xs capitalize text-muted-foreground">
                    {tr(i.type)} · {tr("radius")} {km(i.radius_km)} · {tr("commander")} {i.commander_name ?? "–"}
                  </p>
                </div>
                <Badge variant={i.status === "active" ? "danger" : i.status === "monitoring" ? "warning" : "stale"}>{tr(i.status)}</Badge>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md bg-muted p-2">
                  <div className="text-lg font-semibold tabular-nums">{i.stats?.open_reports}</div>
                  <div className="text-[11px] text-muted-foreground">{tr("open reports")}</div>
                </div>
                <div className="rounded-md bg-muted p-2">
                  <div className="text-lg font-semibold tabular-nums">{i.stats?.active_tasks}</div>
                  <div className="text-[11px] text-muted-foreground">{tr("active tasks")}</div>
                </div>
                <div className="rounded-md bg-muted p-2">
                  <div className="text-lg font-semibold tabular-nums">{i.stats?.resources_deployed}</div>
                  <div className="text-[11px] text-muted-foreground">{tr("units deployed")}</div>
                </div>
              </div>
              <p className="mt-auto text-xs text-muted-foreground">
                {tr("Opened")} {dateTime(i.created_at)}
                {i.closed_at ? ` · ${tr("closed")} ${dateTime(i.closed_at)}` : ""}
              </p>
            </Card>
          </Link>
        ))}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={tr("New incident")} description={tr("Click the map to set the centre.")} className="max-w-xl">
          <Field label={tr("Title")}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tr("Flood Response – Cairo East")} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label={tr("Type")}>
              <Select value={type} onChange={(e) => setType(e.target.value)}>
                {["flood", "fire", "earthquake", "accident", "relief", "other"].map((t) => (
                  <option key={t} value={t}>
                    {tr(t)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={tr("Radius (km)")}>
              <Input type="number" min={0.2} step={0.1} value={radius} onChange={(e) => setRadius(Number(e.target.value))} />
            </Field>
          </div>
          <div className="h-56 overflow-hidden rounded-md border">
            <LiveMap
              center={org?.operating_area.center}
              pick={{ value: center, onChange: setCenter }}
              incidents={center ? [{ id: "new", title: title || tr("New incident"), type, status: "active", center, radius_km: radius, created_at: "" }] : []}
            />
          </div>
          <div className="flex justify-end">
            <Button disabled={!title.trim() || create.isPending} onClick={() => create.mutate()}>
              {tr("Create incident")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
