"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { use } from "react";
import { Comments } from "@/components/domain/comments";
import { Timeline } from "@/components/domain/timeline";
import { ReportPanel } from "@/components/dispatch/report-panel";
import { LiveMap } from "@/components/map/live-map";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useReport, useReportTimeline, useTeams } from "@/lib/queries";
import { useT } from "@/lib/i18n";

export default function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const tr = useT();
  const { id } = use(params);
  const report = useReport(id);
  const timeline = useReportTimeline(id);
  const teams = useTeams();
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      <Link href="/reports" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 rtl:rotate-180" /> {tr("Reports")}
      </Link>
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <Card className="overflow-hidden">
          <ReportPanel reportId={id} showFullLink={false} />
        </Card>
        <div className="flex flex-col gap-4">
          {report.data ? (
            <Card className="h-64 overflow-hidden">
              <LiveMap reports={[report.data]} teams={teams.data} center={report.data.location} zoom={15} selectedReportId={id} />
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>{tr("Timeline")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Timeline events={timeline.data} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{tr("Comments")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Comments parentType="report" parentId={id} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
