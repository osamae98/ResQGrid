"use client";

import { PRIORITIES, ROLES_ORDER, type CategoryRule, type EscalationPolicy, type Priority, type Role } from "@/lib/settings-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, RotateCcw, UserPlus } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/misc";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, errorMessage } from "@/lib/api";
import { DEMO_MODE } from "@/lib/flags";
import { capLabel, CATEGORY_LABEL, dateTime, km, PRIORITY_LABEL, ROLE_LABEL } from "@/lib/format";
import { useCapabilities, useCategoryRules } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { useT } from "@/lib/i18n";

export default function SettingsPage() {
  const tr = useT();
  return (
    <div className="mx-auto max-w-5xl p-4">
      <PageHeader title={tr("Settings")} description={tr("Organisation, users and roles, dispatch rules, escalation and privacy.")} />
      <Tabs defaultValue="org">
        <TabsList className="flex-wrap">
          <TabsTrigger value="org">{tr("Organisation")}</TabsTrigger>
          <TabsTrigger value="users">{tr("Users")}</TabsTrigger>
          <TabsTrigger value="rules">{tr("Category rules")}</TabsTrigger>
          <TabsTrigger value="escalation">{tr("Escalation")}</TabsTrigger>
          <TabsTrigger value="intake">{tr("Public intake")}</TabsTrigger>
          <TabsTrigger value="privacy">{tr("Privacy")}</TabsTrigger>
        </TabsList>
        <TabsContent value="org" className="mt-4">
          <OrgTab />
        </TabsContent>
        <TabsContent value="users" className="mt-4">
          <UsersTab />
        </TabsContent>
        <TabsContent value="rules" className="mt-4">
          <RulesTab />
        </TabsContent>
        <TabsContent value="escalation" className="mt-4">
          <EscalationTab />
        </TabsContent>
        <TabsContent value="intake" className="mt-4">
          <IntakeTab />
        </TabsContent>
        <TabsContent value="privacy" className="mt-4">
          <PrivacyTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function OrgTab() {
  const tr = useT();
  const { org } = useSession();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [tz, setTz] = useState("");
  useEffect(() => {
    if (org) {
      setName(org.name);
      setTz(org.timezone);
    }
  }, [org]);
  const save = useMutation({ mutationFn: () => api.org.update({ name, timezone: tz }), onSuccess: () => (toast.success(tr("Saved")), qc.invalidateQueries({ queryKey: ["me"] })), onError: (e) => toast.error(errorMessage(e)) });
  const reset = useMutation({ mutationFn: api.dev.reset, onSuccess: () => (toast.success(tr("Demo data reset — sign in again")), setTimeout(() => (location.href = "/login"), 800)) });
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="grid gap-3 pt-4 sm:grid-cols-2">
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
          <Field label={tr("Slug (public link)")} hint={tr("Set at sign-up")}>
            <Input value={org?.slug ?? ""} disabled />
          </Field>
          <Field label={tr("Operating area")} hint={tr("Edited in onboarding")}>
            <Input value={org ? `${org.operating_area.center.lat.toFixed(3)}, ${org.operating_area.center.lng.toFixed(3)} · ${km(org.operating_area.radius_km)}` : ""} disabled />
          </Field>
          <div className="sm:col-span-2">
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {tr("Save")}
            </Button>
          </div>
        </CardContent>
      </Card>
      {DEMO_MODE ? (
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle>{tr("Demo data (mock API only)")}</CardTitle>
          <CardDescription>{tr("Restore the seeded Cairo and Giza organisations. Everyone is signed out.")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ConfirmButton
            variant="outline"
            disabled={reset.isPending}
            title={tr("Reset all demo data?")}
            description={tr("Every change made in the demo is lost and everyone is signed out. This affects all users of this server.")}
            confirmLabel={tr("Reset demo data")}
            destructive
            onConfirm={() => reset.mutate()}
          >
            <RotateCcw /> {tr("Reset demo data")}
          </ConfirmButton>
        </CardContent>
      </Card>
      ) : null}
    </div>
  );
}

function UsersTab() {
  const tr = useT();
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ["users"], queryFn: api.org.users });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("dispatcher");
  const invite = useMutation({
    mutationFn: () => api.org.invite(email, role),
    onSuccess: (r) => (toast.success(`${tr("Invitation sent to")} ${email}`, { description: `${tr("Link expires")} ${dateTime(r.expires_at)}` }), setEmail("")),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const toggle = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => api.org.setUserActive(id, on),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-2 pt-4">
          <Field label={tr("Invite by email")} className="min-w-64 flex-1">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@org.org" />
          </Field>
          <Field label={tr("Role")}>
            <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES_ORDER.map((r) => (
                <option key={r} value={r}>
                  {tr(ROLE_LABEL[r])}
                </option>
              ))}
            </Select>
          </Field>
          <Button disabled={!email.includes("@") || invite.isPending} onClick={() => invite.mutate()}>
            <UserPlus /> {tr("Send invite")}
          </Button>
          <p className="w-full text-xs text-muted-foreground">{tr("Invitation links expire after 72 hours. Deactivating a user revokes their sessions immediately.")}</p>
        </CardContent>
      </Card>
      <div className="relative overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-start font-medium">{tr("Name")}</th>
              <th className="px-3 py-2 text-start font-medium">{tr("Email")}</th>
              <th className="px-3 py-2 text-start font-medium">{tr("Role")}</th>
              <th className="px-3 py-2 text-end font-medium">{tr("Active")}</th>
            </tr>
          </thead>
          <tbody>
            {users.data?.map((u) => (
              <tr key={u.id} className="border-b last:border-0">
                <td className="px-3 py-2">{u.name}</td>
                <td className="px-3 py-2 text-muted-foreground">{u.email}</td>
                <td className="px-3 py-2">
                  <Badge variant="outline">{tr(ROLE_LABEL[u.role])}</Badge>
                </td>
                <td className="px-3 py-2 text-end">
                  <Switch checked={u.is_active} onCheckedChange={(on) => toggle.mutate({ id: u.id, on })} aria-label={`${u.name} — ${tr("Active")}`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RulesTab() {
  const tr = useT();
  const rules = useCategoryRules();
  const caps = useCapabilities();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<CategoryRule[]>([]);
  useEffect(() => {
    if (rules.data) setDraft(structuredClone(rules.data));
  }, [rules.data]);
  const save = useMutation({ mutationFn: () => api.teams.putCategoryRules(draft), onSuccess: () => (toast.success(tr("Category rules saved")), qc.invalidateQueries({ queryKey: ["category-rules"] })), onError: (e) => toast.error(errorMessage(e)) });
  const update = (i: number, fn: (r: CategoryRule) => void) => setDraft((d) => d.map((r, j) => (j === i ? (fn(r), { ...r }) : r)));
  const toggleCap = (list: string[] | undefined, k: string) => (list?.includes(k) ? list.filter((x) => x !== k) : [...(list ?? []), k]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tr("Category → default priority and required capabilities")}</CardTitle>
        <CardDescription>{tr("Drives the suggestion filter. Critical capabilities replace the defaults when a report is critical.")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {draft.map((r, i) => (
          <div key={r.category} className="grid gap-2 border-b pb-3 last:border-0 md:grid-cols-[140px_140px_1fr]">
            <div className="text-sm font-medium">{tr(CATEGORY_LABEL[r.category])}</div>
            <Select value={r.default_priority} onChange={(e) => update(i, (x) => (x.default_priority = e.target.value as Priority))} aria-label={`${tr(CATEGORY_LABEL[r.category])} — ${tr("Default priority")}`}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {tr(PRIORITY_LABEL[p])}
                </option>
              ))}
            </Select>
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap gap-1">
                <span className="w-16 text-xs text-muted-foreground">{tr("Required")}</span>
                {caps.data?.map((c) => (
                  <button key={c.key} onClick={() => update(i, (x) => (x.required_capabilities = toggleCap(x.required_capabilities, c.key)))} aria-pressed={r.required_capabilities.includes(c.key)} className={`rounded-full border px-2 py-0.5 text-xs ${r.required_capabilities.includes(c.key) ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground"}`}>
                    {tr(c.name)}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-1">
                <span className="w-16 text-xs text-muted-foreground">{tr("If critical")}</span>
                {caps.data?.map((c) => (
                  <button key={c.key} onClick={() => update(i, (x) => (x.critical_capabilities = toggleCap(x.critical_capabilities, c.key)))} aria-pressed={!!r.critical_capabilities?.includes(c.key)} className={`rounded-full border px-2 py-0.5 text-xs ${r.critical_capabilities?.includes(c.key) ? "border-critical bg-critical/10 text-critical" : "text-muted-foreground"}`}>
                    {tr(c.name)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}
        <Button className="self-start" onClick={() => save.mutate()} disabled={save.isPending}>
          {tr("Save rules")}
        </Button>
      </CardContent>
    </Card>
  );
}

function EscalationTab() {
  const tr = useT();
  const qc = useQueryClient();
  const policies = useQuery({ queryKey: ["policies"], queryFn: api.admin.escalationPolicies });
  const [draft, setDraft] = useState<EscalationPolicy[]>([]);
  useEffect(() => {
    if (policies.data) setDraft(structuredClone(policies.data));
  }, [policies.data]);
  const save = useMutation({ mutationFn: () => api.admin.putEscalationPolicies(draft), onSuccess: () => (toast.success(tr("Escalation policies saved")), qc.invalidateQueries({ queryKey: ["policies"] })), onError: (e) => toast.error(errorMessage(e)) });
  const set = (i: number, k: keyof EscalationPolicy, min: number) => setDraft((d) => d.map((p, j) => (j === i ? { ...p, [k]: Math.round(min * 60) } : p)));
  const cols: [keyof EscalationPolicy, string][] = [
    ["untriaged_timeout_s", "Untriaged re-alert"],
    ["accept_timeout_s", "Not accepted"],
    ["en_route_timeout_s", "Accepted, not en route"],
    ["stale_location_s", "Location stale after"],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tr("Escalation thresholds (minutes)")}</CardTitle>
        <CardDescription>{tr("Level 1 alerts dispatchers; critical tasks reach level 2 (admins) after a second interval.")}</CardDescription>
      </CardHeader>
      <CardContent className="relative overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="py-2 text-start font-medium">{tr("Priority")}</th>
              {cols.map(([k, l]) => (
                <th key={k} className="py-2 text-start font-medium">
                  {tr(l)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {draft.map((p, i) => (
              <tr key={p.priority} className="border-b last:border-0">
                <td className="py-2 font-medium">{tr(PRIORITY_LABEL[p.priority])}</td>
                {cols.map(([k]) => (
                  <td key={k} className="py-2 pe-2">
                    {p[k] === undefined ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <Input type="number" min={0.5} step={0.5} className="w-24" value={Number(p[k]) / 60} onChange={(e) => set(i, k, Number(e.target.value))} aria-label={`${tr(PRIORITY_LABEL[p.priority])} — ${tr(String(cols.find(([f]) => f === k)?.[1] ?? k))}`} />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <Button className="mt-3" onClick={() => save.mutate()} disabled={save.isPending}>
          {tr("Save policies")}
        </Button>
      </CardContent>
    </Card>
  );
}

function IntakeTab() {
  const tr = useT();
  const { org } = useSession();
  const [url, setUrl] = useState("");
  useEffect(() => setUrl(`${location.origin}/r/${org?.slug}`), [org?.slug]);
  const [captcha, setCaptcha] = useState(false);
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-4 sm:flex-row">
        <div className="rounded-lg bg-white p-3">{url ? <QRCodeSVG value={url} size={160} /> : null}</div>
        <div className="flex flex-1 flex-col gap-3">
          <Field label={tr("Public report link")}>
            <div className="flex gap-2">
              <Input readOnly value={url} />
              <Button variant="outline" size="icon" onClick={() => (navigator.clipboard?.writeText(url), toast.success(tr("Copied")))} aria-label={tr("Copy link")}>
                <Copy />
              </Button>
            </div>
          </Field>
          <p className="text-sm text-muted-foreground">{tr("Print the QR code for relief points and share the link on social media. Reporters get a reference code they can use to check status.")}</p>
          <ul className="text-sm text-muted-foreground">
            <li>{tr("Rate limits: 5 reports per 10 min per IP, 3 per phone number.")}</li>
            <li>{tr("Honeypot field and minimum fill time are always on.")}</li>
          </ul>
          <label className="flex items-center gap-3 text-sm">
            <Switch checked={captcha} onCheckedChange={setCaptcha} /> {tr("CAPTCHA challenge (Turnstile / hCaptcha — needs backend config)")}
          </label>
        </div>
      </CardContent>
    </Card>
  );
}

function PrivacyTab() {
  const tr = useT();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tr("Reporter privacy")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <Field label={tr("Purge reporter contact after incident closes (days)")} hint={tr("Report and timeline stay; name and phone are removed.")}>
          <Input type="number" defaultValue={90} className="w-32" />
        </Field>
        <ul className="list-disc ps-5 text-muted-foreground">
          <li>{tr("Reporter name and phone are visible to admins, dispatchers, and responders on the assigned task only.")}</li>
          <li>{tr("Every view is recorded in the audit log as pii.viewed.")}</li>
          <li>{tr("Viewers and volunteer coordinators never receive contact data, including in live updates and CSV exports.")}</li>
          <li>{tr("Photos have EXIF stripped; GPS is used to suggest a location and then dropped.")}</li>
        </ul>
        <p className="text-xs text-muted-foreground">Retention is enforced by the backend purge job ({capLabel("pii_retention")}); this field is a placeholder until the settings endpoint exists.</p>
      </CardContent>
    </Card>
  );
}
