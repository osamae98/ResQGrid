"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty, LoadError, PageHeader } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { ago, dateTime } from "@/lib/format";
import { useNotifications } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

export default function NotificationsPage() {
  const tr = useT();
  const notifications = useNotifications();
  const { data } = notifications;
  const qc = useQueryClient();
  const router = useRouter();
  const inv = () => qc.invalidateQueries({ queryKey: ["notifications"] });
  const readAll = useMutation({ mutationFn: api.notifications.readAll, onSuccess: inv });
  return (
    <div className="mx-auto max-w-3xl p-4">
      <PageHeader
        title={tr("Notifications")}
        actions={
          <Button variant="outline" onClick={() => readAll.mutate()}>
            <CheckCheck /> {tr("Mark all read")}
          </Button>
        }
      />
      <LoadError queries={[notifications]} what="notifications" />
      <Card className="divide-y">
        {data?.length ? (
          data.map((n) => (
            <button
              key={n.id}
              className={cn("flex w-full items-start gap-3 px-4 py-3 text-start hover:bg-accent/50", !n.read_at && "bg-primary/5")}
              onClick={async () => {
                await api.notifications.read(n.id);
                inv();
                if (n.link) router.push(n.link);
              }}
            >
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : n.priority === "high" ? "bg-critical" : "bg-primary")} aria-label={n.read_at ? tr("Read") : tr("Unread")} />
              <span className="min-w-0 flex-1">
                <span className="block font-medium" dir="auto">{n.title}</span>
                {n.body ? <span className="block text-sm text-muted-foreground" dir="auto">{n.body}</span> : null}
              </span>
              <time className="shrink-0 text-xs text-muted-foreground" title={dateTime(n.created_at)}>
                {ago(n.created_at)}
              </time>
            </button>
          ))
        ) : (
          <Empty icon={<Bell />} title={tr("No notifications")} />
        )}
      </Card>
    </div>
  );
}
