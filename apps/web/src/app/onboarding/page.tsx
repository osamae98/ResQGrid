"use client";

import type { LatLng, Team } from "@resqgrid/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, Copy } from "lucide-react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { LiveMap } from "@/components/map/live-map";
import { AuthGate } from "@/components/shell/auth-gate";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api";
import { useCapabilities } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { km } from "@/lib/format";
import { usePageTitle } from "@/lib/hooks";
import { useT } from "@/lib/i18n";

const STEPS = ["Organisation", "Operating area", "First team", "Escalation", "Public link"];

function Wizard() {
  const tr = useT();
  usePageTitle(tr("Set up your organization"));
  const { org } = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const caps = useCapabilities();
  const policies = useQuery({ queryKey: ["policies"], queryFn: api.admin.escalationPolicies });
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [tz, setTz] = useState("Africa/Cairo");
  const [center, setCenter] = useState<LatLng>();
  const [radius, setRadius] = useState(8);
  const [teamName, setTeamName] = useState("Team 1");
  const [teamType, setTeamType] = useState<Team["type"]>("medical");
  const [teamCaps, setTeamCaps] = useState<string[]>(["first_aid"]);
  const [criticalAccept, setCriticalAccept] = useState(3);
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (org) {
      setName(org.name);
      setTz(org.timezone);
      setCenter(org.operating_area.center);
      setRadius(org.operating_area.radius_km);
      setUrl(`${location.origin}/r/${org.slug}`);
    }
  }, [org]);

  const save = useMutation({
    mutationFn: async () => {
      if (step === 0) await api.org.update({ name, timezone: tz });
      if (step === 1 && center) await api.org.update({ operating_area: { center, radius_km: radius } });
      if (step === 2) await api.teams.create({ name: teamName, type: teamType, home_base: center ?? org!.operating_area.center });
      if (step === 3 && policies.data) await api.admin.putEscalationPolicies(policies.data.map((p) => (p.priority === "critical" ? { ...p, accept_timeout_s: criticalAccept * 60 } : p)));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      if (step === STEPS.length - 1) router.replace("/dispatch");
      else setStep((s) => s + 1);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-4 p-4 py-10">
      <h1 className="text-xl font-semibold">{tr("Set up")} {org?.name}</h1>
      <ol className="flex flex-wrap gap-2 text-xs">
        {STEPS.map((s, i) => (
          <li key={s} className={cn("flex items-center gap-1 rounded-full border px-2.5 py-1", i === step && "border-primary text-primary", i < step && "text-available")}>
            {i < step ? <Check className="size-3" /> : <span>{i + 1}</span>} {tr(s)}
          </li>
        ))}
      </ol>
      <Card>
        <CardContent className="flex flex-col gap-4 pt-4">
          {step === 0 ? (
            <>
              <Field label={tr("Organisation name")}>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label={tr("Timezone")}>
                <Select value={tz} onChange={(e) => setTz(e.target.value)}>
                  {["Africa/Cairo", "Asia/Riyadh", "Asia/Dubai", "Europe/London", "UTC"].map((z) => (
                    <option key={z}>{z}</option>
                  ))}
                </Select>
              </Field>
            </>
          ) : null}
          {step === 1 ? (
            <>
              <p className="text-sm text-muted-foreground">{tr("Click the map to set the centre of your operating area.")}</p>
              <div className="h-72 overflow-hidden rounded-md border">
                <LiveMap center={center} zoom={11} pick={{ value: center, onChange: setCenter }} incidents={center ? [{ id: "area", title: tr("Operating area"), type: "", status: "active", center, radius_km: radius, created_at: "" }] : []} />
              </div>
              <Field label={`${tr("Radius")}: ${km(radius)}`}>
                <input type="range" min={1} max={50} value={radius} onChange={(e) => setRadius(Number(e.target.value))} />
              </Field>
            </>
          ) : null}
          {step === 2 ? (
            <>
              <Field label={tr("Team name")}>
                <Input value={teamName} onChange={(e) => setTeamName(e.target.value)} />
              </Field>
              <Field label={tr("Type")}>
                <Select value={teamType} onChange={(e) => setTeamType(e.target.value as Team["type"])}>
                  {["medical", "water_rescue", "fire", "search_rescue", "logistics", "volunteer"].map((x) => (
                    <option key={x} value={x}>
                      {tr(x.replace("_", " "))}
                    </option>
                  ))}
                </Select>
              </Field>
              <div>
                <span className="text-xs font-medium text-muted-foreground">{tr("Capabilities (assigned to members once you invite them)")}</span>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {caps.data?.map((c) => (
                    <button
                      key={c.key}
                      aria-pressed={teamCaps.includes(c.key)}
                      onClick={() => setTeamCaps((x) => (x.includes(c.key) ? x.filter((y) => y !== c.key) : [...x, c.key]))}
                      className={cn("rounded-full border px-2 py-0.5 text-xs", teamCaps.includes(c.key) ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground")}
                    >
                      {tr(c.name)}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : null}
          {step === 3 ? (
            <>
              <Field label={tr("Critical task: escalate if not accepted within (minutes)")} hint={tr("Level 2 notifies admins after the same interval again. Other priorities use the defaults; edit them later in Settings.")}>
                <Input type="number" min={1} value={criticalAccept} onChange={(e) => setCriticalAccept(Number(e.target.value))} className="w-24" />
              </Field>
              <ul className="text-sm text-muted-foreground">
                <li>{tr("Critical report untriaged: re-alert after 2 min")}</li>
                <li>{tr("High task not accepted: alert after 10 min")}</li>
                <li>{tr("Location stale after 5 min on an active task")}</li>
              </ul>
            </>
          ) : null}
          {step === 4 ? (
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
              <div className="rounded-lg bg-white p-3">{url ? <QRCodeSVG value={url} size={150} /> : null}</div>
              <div className="flex flex-1 flex-col gap-2">
                <p className="text-sm">{tr("Anyone can report an emergency here, no login needed.")}</p>
                <div className="flex gap-2">
                  <Input readOnly value={url} />
                  <Button variant="outline" size="icon" onClick={() => (navigator.clipboard?.writeText(url), toast.success(tr("Copied")))} aria-label={tr("Copy link")}>
                    <Copy />
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
      <div className="flex justify-between">
        <Button variant="outline" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
          <ArrowLeft className="rtl:rotate-180" /> {tr("Back")}
        </Button>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {step === STEPS.length - 1 ? tr("Open the dispatch console") : tr("Save and continue")} <ArrowRight className="rtl:rotate-180" />
        </Button>
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <AuthGate roles={["admin"]}>
      <Wizard />
    </AuthGate>
  );
}
