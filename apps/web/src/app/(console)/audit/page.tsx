"use client";

import { useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { LoadError, PageHeader } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { useT } from "@/lib/i18n";

const ACTIONS = ["", "report", "task", "resource", "stock", "shelter", "pii", "export", "override", "user", "org"];

export default function AuditPage() {
  const tr = useT();
  const [action, setAction] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string>();
  const logs = useQuery({ queryKey: ["audit", action], queryFn: () => api.admin.auditLogs({ action: action || undefined }) });
  const rows = logs.data?.filter((a) => !q || `${a.actor_name} ${a.summary}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="p-4">
      <PageHeader title={tr("Audit log")} description={tr("Append-only. Every create, update, archive, assign, override, role change, PII view and export.")} />
      <LoadError queries={[logs]} what="the audit log" />
      <div className="mb-3 flex gap-2">
        <Select className="w-44" value={action} onChange={(e) => setAction(e.target.value)} aria-label={tr("Action")}>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a ? `${a}.*` : tr("All actions")}
            </option>
          ))}
        </Select>
        <Input className="w-64" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Filter by actor or text")} aria-label={tr("Filter")} />
      </div>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-start font-medium">{tr("When")}</th>
              <th className="px-3 py-2 text-start font-medium">{tr("Actor")}</th>
              <th className="px-3 py-2 text-start font-medium">{tr("Action")}</th>
              <th className="px-3 py-2 text-start font-medium">{tr("Summary")}</th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((a) => (
              <Fragment key={a.id}>
                <tr className="cursor-pointer border-b hover:bg-accent/40" onClick={() => setOpen(open === a.id ? undefined : a.id)}>
                  <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-muted-foreground">{dateTime(a.created_at)}</td>
                  <td className="px-3 py-2">{a.actor_name}</td>
                  <td className="px-3 py-2">
                    <Badge variant={a.action.startsWith("pii") ? "warning" : a.action.includes("override") ? "danger" : "outline"} className="font-mono">
                      {a.action}
                    </Badge>
                  </td>
                  <td className="px-3 py-2" dir="auto">{a.summary}</td>
                </tr>
                {open === a.id && (a.before || a.after) ? (
                  <tr className="border-b bg-muted/30">
                    <td colSpan={4} className="px-3 py-2">
                      <div className="grid gap-2 font-mono text-xs sm:grid-cols-2">
                        <pre className="overflow-x-auto rounded bg-critical/10 p-2">− {JSON.stringify(a.before ?? {}, null, 2)}</pre>
                        <pre className="overflow-x-auto rounded bg-available/10 p-2">+ {JSON.stringify(a.after ?? {}, null, 2)}</pre>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
