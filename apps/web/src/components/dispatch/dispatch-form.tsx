"use client";

import { OVERRIDE_REASONS, type OverrideReason, type Report, type Resource, type TeamSuggestion } from "@resqgrid/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Clock, Send, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CapabilityChip } from "@/components/domain/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/misc";
import { api, errorMessage, formatReason } from "@/lib/api";
import { ago, capLabel, CATEGORY_LABEL, km } from "@/lib/format";
import { useCapabilities, useCategoryRules, useResources, useSuggestions } from "@/lib/queries";
import { can, useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

function distance(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const SUGGESTED_UNIT: Partial<Record<Report["category"], string>> = { medical: "ambulance", flood: "boat", rescue: "vehicle" };

/** Suggested teams + resource picker + Assign (§13.1 "Dispatch without leaving the map"). */
export function DispatchForm({
  report,
  taskId,
  onDone,
  beforeAssign,
}: {
  report: Report;
  taskId?: string;
  onDone?: () => void;
  /** Runs before assign or an override request; used to triage a new report in the same click. */
  beforeAssign?: () => Promise<void>;
}) {
  const tr = useT();
  const { user } = useSession();
  const qc = useQueryClient();
  const rules = useCategoryRules();
  const catalog = useCapabilities();

  const defaultCaps = useMemo(() => {
    const rule = rules.data?.find((r) => r.category === report.category);
    if (!rule) return undefined;
    return report.priority === "critical" && rule.critical_capabilities?.length ? rule.critical_capabilities : rule.required_capabilities;
  }, [rules.data, report.category, report.priority]);

  const [caps, setCaps] = useState<string[] | undefined>(undefined);
  useEffect(() => setCaps(defaultCaps), [defaultCaps]);

  const suggestions = useSuggestions(caps ? report.id : undefined, caps);
  const [teamId, setTeamId] = useState<string>();
  const [override, setOverride] = useState<TeamSuggestion>();

  useEffect(() => {
    const first = suggestions.data?.find((s) => s.eligible);
    setTeamId((cur) => (cur && suggestions.data?.some((s) => s.team_id === cur && s.eligible) ? cur : first?.team_id));
  }, [suggestions.data]);

  const resources = useResources();
  const [units, setUnits] = useState<string[]>([]);
  const [stock, setStock] = useState<Record<string, number>>({});
  const availableUnits = useMemo(
    () =>
      (resources.data ?? [])
        .filter((r) => r.kind === "unit" && r.status === "available")
        .map((r) => ({ r, d: distance(r.location, report.location) }))
        .sort((a, b) => a.d - b.d),
    [resources.data, report.location],
  );
  const stockItems = useMemo(
    () => (resources.data ?? []).filter((r) => r.kind === "stock" && (r.on_hand ?? 0) - (r.reserved ?? 0) > 0).map((r) => ({ r, d: distance(r.location, report.location) })).sort((a, b) => a.d - b.d),
    [resources.data, report.location],
  );
  const suggestedUnit = availableUnits.find((u) => u.r.type === SUGGESTED_UNIT[report.category]);

  const shelters = useQuery({
    queryKey: ["shelters-nearest", report.id],
    queryFn: () => api.shelters.nearest(report.location.lat, report.location.lng, report.people_affected ?? 1),
    enabled: report.category === "shelter",
  });
  const [shelterId, setShelterId] = useState<string>("");

  const [instructions, setInstructions] = useState("");
  useEffect(() => {
    setInstructions(`${tr(CATEGORY_LABEL[report.category])} — ${report.title}. ${report.address_text ?? ""}`.trim());
  }, [report.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const invalidate = () => ["tasks", "reports", "report", "teams", "resources", "suggestions", "kpis"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const payload = (team: string, o?: { reason: OverrideReason; note?: string }) => ({
    report_id: report.id,
    team_id: team,
    instructions,
    required_capabilities: caps ?? [],
    resources: [...units.map((id): { resource_id: string; qty?: number } => ({ resource_id: id })), ...Object.entries(stock).filter(([, q]) => q > 0).map(([id, qty]) => ({ resource_id: id, qty }))],
    target_shelter_id: shelterId || undefined,
    override_reason: o?.reason,
    override_note: o?.note,
  });

  const assign = useMutation({
    mutationFn: async (o?: { team: string; reason: OverrideReason; note?: string }) => {
      const team = o?.team ?? teamId!;
      await beforeAssign?.();
      if (taskId) {
        const t = await api.tasks.assign(taskId, team, o ? { override_reason: o.reason, override_note: o.note } : undefined);
        for (const r of payload(team).resources) await api.tasks.reserve(taskId, r.resource_id, r.qty);
        return t;
      }
      return api.tasks.create(payload(team, o));
    },
    onSuccess: (t) => {
      toast.success(`${tr("Assigned")} ${t.team_name}`, { description: t.resources.length ? `${tr("Reserved")} ${t.resources.map((r) => r.resource_name).join("، ")}` : undefined });
      setUnits([]);
      setStock({});
      setOverride(undefined);
      invalidate();
      onDone?.();
    },
    onError: (e) => {
      toast.error(errorMessage(e));
      invalidate();
    },
  });

  const requestOverride = useMutation({
    mutationFn: async (o: { team: string; reason: OverrideReason; note?: string }) => {
      await beforeAssign?.();
      return api.tasks.overrideRequest({ ...payload(o.team, o), note: o.note });
    },
    onSuccess: () => {
      toast.success(tr("Override requested"), { description: tr("Admins were notified. The request expires in 5 minutes.") });
      setOverride(undefined);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const selected = suggestions.data?.find((s) => s.team_id === teamId);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">{tr("Required capabilities")}</span>
          <span className="text-[11px] text-muted-foreground">{tr("from the rule for")} {tr(CATEGORY_LABEL[report.category])}</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {catalog.data?.map((c) => {
            const on = caps?.includes(c.key);
            return (
              <button
                key={c.key}
                type="button"
                aria-pressed={on}
                onClick={() => setCaps((cur) => (on ? (cur ?? []).filter((x) => x !== c.key) : [...(cur ?? []), c.key]))}
                className={cn("rounded-full border px-2 py-0.5 text-xs", on ? "border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-accent")}
              >
                {on ? "✓ " : ""}
                {tr(c.name)}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">{tr("Suggested teams")}</div>
        {suggestions.isLoading || !caps ? (
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5" role="radiogroup" aria-label={tr("Suggested teams")}>
            {suggestions.data?.map((s, i) => (
              <SuggestionRow
                key={s.team_id}
                s={s}
                rank={s.eligible ? i + 1 : undefined}
                selected={s.team_id === teamId}
                onSelect={() => s.eligible && setTeamId(s.team_id)}
                onOverride={() => setOverride(s)}
                canOverride={can.override(user?.role)}
              />
            ))}
            {!suggestions.data?.some((s) => s.eligible) ? (
              <li className="flex items-start gap-2 rounded-md border border-high/40 bg-high/10 p-2 text-xs text-high">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                {can.override(user?.role) ? tr("No eligible team. Adjust capabilities, or override one of the teams above.") : tr("No eligible team. Adjust capabilities, or request an override for one of the teams above.")}
              </li>
            ) : null}
          </ul>
        )}
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-muted-foreground">
          <span>{tr("Reserve resources")}</span>
          {suggestedUnit && !units.includes(suggestedUnit.r.id) ? (
            <button type="button" className="text-primary hover:underline" onClick={() => setUnits((u) => [...u, suggestedUnit.r.id])}>
              + {suggestedUnit.r.name} ({km(suggestedUnit.d)})
            </button>
          ) : null}
        </div>
        <div className="max-h-48 overflow-y-auto rounded-md border">
          {availableUnits.length === 0 && stockItems.length === 0 ? <p className="p-3 text-xs text-muted-foreground">{tr("No available resources.")}</p> : null}
          {availableUnits.slice(0, 8).map(({ r, d }) => (
            <label key={r.id} className="flex cursor-pointer items-center gap-2 border-b px-2.5 py-1.5 text-sm last:border-0 hover:bg-accent/50">
              <input type="checkbox" checked={units.includes(r.id)} onChange={(e) => setUnits((u) => (e.target.checked ? [...u, r.id] : u.filter((x) => x !== r.id)))} className="size-4 accent-[var(--primary)]" />
              <span className="flex-1 truncate">{r.name}</span>
              <span className="text-xs text-muted-foreground">{r.depot_name}</span>
              <span className="w-14 text-end text-xs tabular-nums text-muted-foreground">{km(d)}</span>
            </label>
          ))}
          {stockItems.slice(0, 6).map(({ r }) => (
            <StockRow key={r.id} r={r} qty={stock[r.id] ?? 0} onChange={(q) => setStock((s) => ({ ...s, [r.id]: q }))} />
          ))}
        </div>
      </div>

      {report.category === "shelter" ? (
        <Field label={tr("Target shelter (nearest with free beds)")}>
          <Select value={shelterId} onChange={(e) => setShelterId(e.target.value)}>
            <option value="">{tr("None")}</option>
            {shelters.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — {s.capacity - s.occupancy} {tr("free")} · {km(s.distance_km)} · {s.facilities.map((f) => tr(f.replaceAll("_", " "))).join("، ")}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      <Field label={tr("Instructions")}>
        <Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={2} />
      </Field>

      <Button size="lg" disabled={!selected?.eligible || assign.isPending} onClick={() => assign.mutate(undefined)}>
        <Send /> {selected ? `${beforeAssign ? tr("Triage & assign") : tr("Assign")} ${selected.team_name}` : tr("Select a team")}
        {units.length + Object.values(stock).filter(Boolean).length ? ` + ${units.length + Object.values(stock).filter(Boolean).length} ${tr("resource(s)")}` : ""}
      </Button>

      <OverrideDialog
        s={override}
        isAdmin={can.override(user?.role)}
        pending={assign.isPending || requestOverride.isPending}
        onClose={() => setOverride(undefined)}
        onSubmit={(reason, note) => {
          if (!override) return;
          if (can.override(user?.role)) assign.mutate({ team: override.team_id, reason, note });
          else requestOverride.mutate({ team: override.team_id, reason, note });
        }}
      />
    </div>
  );
}

function SuggestionRow({ s, rank, selected, onSelect, onOverride, canOverride }: { s: TeamSuggestion; rank?: number; selected: boolean; onSelect: () => void; onOverride: () => void; canOverride: boolean }) {
  const tr = useT();
  return (
    <li
      role="radio"
      aria-checked={selected}
      aria-disabled={!s.eligible}
      tabIndex={s.eligible ? 0 : -1}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === " " || e.key === "Enter") && onSelect()}
      className={cn(
        "flex flex-col gap-1 rounded-md border p-2 text-sm",
        s.eligible ? "cursor-pointer hover:bg-accent/50" : "bg-muted/40 text-muted-foreground",
        selected && "border-primary ring-1 ring-primary",
      )}
    >
      <div className="flex items-center gap-2">
        {s.eligible ? (
          <span className={cn("grid size-5 shrink-0 place-items-center rounded-full border text-[11px] font-bold", selected && "border-primary bg-primary text-primary-foreground")}>
            {selected ? <Check className="size-3" /> : rank}
          </span>
        ) : (
          <span className="size-5 shrink-0" />
        )}
        <span className={cn("font-medium", !s.eligible && "line-through decoration-1")}>{s.team_name}</span>
        <span className="ms-auto tabular-nums">{km(s.distance_km)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1 ps-7">
        {s.capabilities.map((c) => (
          <CapabilityChip key={c.key} k={c.key} ok={c.ok} />
        ))}
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <Clock className="size-3" /> {s.last_seen_s === undefined ? tr("never seen") : `${tr("seen")} ${ago(new Date(Date.now() - s.last_seen_s * 1000).toISOString())}`}
        </span>
      </div>
      {!s.eligible ? (
        <div className="flex items-center gap-1 ps-7">
          {s.reasons.map((r) => (
            <Badge key={r} variant={r.startsWith("missing") ? "danger" : r.startsWith("stale") ? "stale" : "busy"}>
              {formatReason(r)}
            </Badge>
          ))}
          <button
            type="button"
            className="ms-auto text-xs font-medium text-primary hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              onOverride();
            }}
          >
            {canOverride ? tr("Override…") : tr("Request override…")}
          </button>
        </div>
      ) : null}
    </li>
  );
}

function StockRow({ r, qty, onChange }: { r: Resource; qty: number; onChange: (q: number) => void }) {
  const tr = useT();
  const available = (r.on_hand ?? 0) - (r.reserved ?? 0);
  return (
    <div className="flex items-center gap-2 border-b px-2.5 py-1.5 text-sm last:border-0">
      <span className="flex-1 truncate">{r.name}</span>
      <span className="text-xs text-muted-foreground">{r.depot_name}</span>
      <Input
        type="number"
        min={0}
        max={available}
        value={qty || ""}
        placeholder="0"
        onChange={(e) => onChange(Math.max(0, Math.min(available, Number(e.target.value))))}
        className="h-7 w-16 px-1.5 text-end"
        aria-label={`${tr("Quantity of")} ${r.name}`}
      />
      <span className="w-20 text-end text-[11px] text-muted-foreground">/ {available} {r.unit_label}</span>
    </div>
  );
}

function OverrideDialog({ s, isAdmin, pending, onClose, onSubmit }: { s?: TeamSuggestion; isAdmin: boolean; pending: boolean; onClose: () => void; onSubmit: (r: OverrideReason, note?: string) => void }) {
  const tr = useT();
  const [reason, setReason] = useState<OverrideReason>("no_eligible_team_nearby");
  const [note, setNote] = useState("");
  return (
    <Dialog open={!!s} onOpenChange={(o) => !o && onClose()}>
      {s ? (
        <DialogContent
          title={isAdmin ? `${tr("Override: assign")} ${s.team_name}` : `${tr("Request override for")} ${s.team_name}`}
          description={isAdmin ? tr("This team is not eligible. The override is recorded on the task timeline and in the audit log.") : tr("An admin will be notified and can approve in one click. The request expires after 5 minutes.")}
        >
          <div className="flex flex-wrap gap-1">
            {s.reasons.map((r) => (
              <Badge key={r} variant="danger">
                {formatReason(r)}
              </Badge>
            ))}
          </div>
          <Field label={tr("Reason")}>
            <Select value={reason} onChange={(e) => setReason(e.target.value as OverrideReason)}>
              {OVERRIDE_REASONS.map((r) => (
                <option key={r} value={r}>
                  {tr(capLabel(r))}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tr("Note")}>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={tr("Context for the audit trail")} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              {tr("Cancel")}
            </Button>
            <Button variant={isAdmin ? "destructive" : "default"} disabled={pending} onClick={() => onSubmit(reason, note || undefined)}>
              {isAdmin ? <ShieldCheck /> : <Send />}
              {isAdmin ? tr("Override and assign") : tr("Send request")}
            </Button>
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
