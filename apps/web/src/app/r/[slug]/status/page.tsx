"use client";

import { REPORT_STATUSES } from "@resqgrid/api-client";
import { useQuery } from "@tanstack/react-query";
import { Check, Search } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, use, useState } from "react";
import { LanguageToggle } from "@/components/shell/language-toggle";
import { Logo } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api";
import { ago, REPORT_STATUS_LABEL } from "@/lib/format";
import { usePageTitle } from "@/lib/hooks";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

function StatusInner({ slug }: { slug: string }) {
  const t = useT();
  usePageTitle(t("Report status"));
  const router = useRouter();
  const ref = useSearchParams().get("ref") ?? "";
  const [input, setInput] = useState(ref);
  // Returns status and last update only — no details (§8.4).
  const q = useQuery({ queryKey: ["public-status", ref], queryFn: () => api.public.status(ref), enabled: !!ref, retry: false, refetchInterval: 30_000 });
  const steps = REPORT_STATUSES.filter((s) => s !== "closed");
  const idx = q.data ? steps.indexOf(q.data.status === "closed" ? "resolved" : q.data.status) : -1;
  return (
    <div className="min-h-dvh bg-background">
    <header className="flex items-center justify-between border-b px-4 py-2">
      <Logo size="sm" className="text-sm" product={t("Report")} />
      <LanguageToggle />
    </header>
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8">
      <h1 className="text-xl font-semibold">{t("Check status")}</h1>
      <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), router.replace(`/r/${slug}/status?ref=${input.trim().toUpperCase()}`))}>
        <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="RQ-7F3K2" className="h-12 font-mono text-base uppercase" dir="ltr" aria-label={t("Your reference code")} />
        <Button type="submit" size="lg" aria-label={t("Look up")}>
          <Search />
        </Button>
      </form>
      {q.error ? <p className="text-sm text-critical">{t(errorMessage(q.error))}</p> : null}
      {q.data ? (
        <div className="rounded-xl border p-4">
          <div className="font-mono text-lg font-bold" dir="ltr">
            {q.data.reference_code}
          </div>
          <p className="text-sm text-muted-foreground">{t("Last update")} {ago(q.data.updated_at)}</p>
          <ol className="mt-4 flex flex-col gap-3">
            {steps.map((s, i) => (
              <li key={s} className="flex items-center gap-3">
                <span className={cn("grid size-7 place-items-center rounded-full border-2 text-xs", i <= idx ? "border-available bg-available text-white" : "text-muted-foreground")}>
                  {i <= idx ? <Check className="size-4" /> : i + 1}
                </span>
                <span className={cn("text-sm", i === idx ? "font-semibold" : i < idx ? "" : "text-muted-foreground")}>{t(REPORT_STATUS_LABEL[s])}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      <Link href={`/r/${slug}`} className="text-sm text-primary hover:underline">
        {t("Send another report")}
      </Link>
    </main>
    </div>
  );
}

export default function StatusPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  return (
    <Suspense>
      <StatusInner slug={slug} />
    </Suspense>
  );
}
