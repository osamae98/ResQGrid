"use client";

import type { Team } from "@resqgrid/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Clock, Crown, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { CapabilityChip, TeamStateBadge } from "@/components/domain/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { PageHeader, Skeleton } from "@/components/ui/misc";
import { Switch } from "@/components/ui/switch";
import { api, errorMessage } from "@/lib/api";
import { ago, dateTime } from "@/lib/format";
import { useTeams } from "@/lib/queries";
import { can, useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

export default function TeamsPage() {
  const tr = useT();
  const { user, org } = useSession();
  const teams = useTeams();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<Team["type"]>("volunteer");
  const isCoordinator = user?.role === "volunteer_coordinator";
  const create = useMutation({
    mutationFn: () => api.teams.create({ name, type, home_base: org!.operating_area.center, is_volunteer: isCoordinator || type === "volunteer" }),
    onSuccess: () => (toast.success(tr("Team created")), setCreating(false), setName(""), qc.invalidateQueries({ queryKey: ["teams"] })),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const volunteers = teams.data?.filter((t) => t.is_volunteer).flatMap((t) => t.members) ?? [];

  return (
    <div className="p-4">
      <PageHeader
        title={tr("Teams and capabilities")}
        description={tr("A team's capabilities are the union of its on-duty members' unexpired capabilities.")}
        actions={
          can.manageTeams(user?.role) ? (
            <Button onClick={() => setCreating(true)}>
              <Plus /> {isCoordinator ? tr("New volunteer team") : tr("New team")}
            </Button>
          ) : null
        }
      />
      {volunteers.length ? (
        <p className="mb-3 text-sm text-muted-foreground">
          {tr("Volunteers:")} <strong className="text-foreground">{volunteers.filter((m) => m.on_duty).length}</strong> {tr("on duty")} · {volunteers.filter((m) => !m.on_duty).length} {tr("off duty")}
        </p>
      ) : null}
      <div className="grid gap-3 lg:grid-cols-2">
        {teams.isLoading ? <Skeleton className="h-48" /> : null}
        {teams.data?.map((t) => (
          <TeamCard key={t.id} t={t} editable={can.manageTeams(user?.role) && (!isCoordinator || t.is_volunteer)} />
        ))}
      </div>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent title={isCoordinator ? tr("New volunteer team") : tr("New team")} description={tr("Add members from the user list once the backend supports invitations to teams.")}>
          <Field label={tr("Name")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          {!isCoordinator ? (
            <Field label={tr("Type")}>
              <Select value={type} onChange={(e) => setType(e.target.value as Team["type"])}>
                {["medical", "water_rescue", "fire", "search_rescue", "logistics", "volunteer"].map((x) => (
                  <option key={x} value={x}>
                    {tr(x.replace("_", " "))}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <div className="flex justify-end">
            <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
              {tr("Create")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TeamCard({ t, editable }: { t: Team; editable: boolean }) {
  const tr = useT();
  const qc = useQueryClient();
  const inv = () => ["teams", "kpis", "suggestions"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const duty = useMutation({
    mutationFn: ({ userId, on }: { userId: string; on: boolean }) => api.teams.setMemberDuty(t.id, userId, on),
    onSuccess: inv,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const avail = useMutation({ mutationFn: (a: Team["availability"]) => api.teams.setAvailability(t.id, a), onSuccess: inv, onError: (e) => toast.error(errorMessage(e)) });
  const lastSeenMin = t.last_location_at ? (Date.now() - Date.parse(t.last_location_at)) / 60000 : Infinity;
  return (
    <Card className={cn("flex flex-col gap-3 p-4", t.is_stale && "border-dashed border-stale")}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            {t.name}
            {t.is_volunteer ? <Badge variant="outline">{tr("volunteer")}</Badge> : null}
          </h2>
          <p className={cn("inline-flex items-center gap-1 text-xs", lastSeenMin > 5 ? "text-high" : "text-muted-foreground")}>
            <Clock className="size-3" /> {tr("last seen")} {ago(t.last_location_at)}
            {t.active_task_id ? ` · ${tr("on a task")}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <TeamStateBadge team={t} />
          {editable && !t.active_task_id ? (
            <Select className="h-8 w-28 text-xs" value={t.availability} onChange={(e) => avail.mutate(e.target.value as Team["availability"])} aria-label={tr("Availability")}>
              <option value="available">{tr("Available")}</option>
              <option value="busy">{tr("Busy")}</option>
              <option value="off_duty">{tr("Off duty")}</option>
            </Select>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {t.capabilities.length ? t.capabilities.map((c) => <CapabilityChip key={c} k={c} />) : <span className="text-xs text-muted-foreground">{tr("No capabilities on duty")}</span>}
      </div>
      <ul className="divide-y rounded-md border text-sm">
        {t.members.map((m) => (
          <li key={m.user_id} className="flex items-center gap-2 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1 font-medium">
                {m.name}
                {m.is_lead ? <Crown className="size-3 text-medium" aria-label={tr("Team lead")} /> : null}
              </div>
              <div className="mt-0.5 flex flex-wrap gap-1">
                {m.capabilities.map((c) => {
                  const expired = !!c.expires_at && Date.parse(c.expires_at) < Date.now();
                  return (
                    <span key={c.key} title={c.expires_at ? `${expired ? tr("Expired") : tr("Expires")} ${dateTime(c.expires_at)}` : tr("No expiry")}>
                      <CapabilityChip k={c.key} expired={expired} />
                    </span>
                  );
                })}
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              {m.on_duty ? tr("On duty") : tr("Off duty")}
              <Switch checked={m.on_duty} disabled={!editable || duty.isPending} onCheckedChange={(on) => duty.mutate({ userId: m.user_id, on })} aria-label={`${m.name} — ${tr("On duty")}`} />
            </label>
          </li>
        ))}
        {t.members.length === 0 ? <li className="px-3 py-2 text-xs text-muted-foreground">{tr("No members yet.")}</li> : null}
      </ul>
    </Card>
  );
}
