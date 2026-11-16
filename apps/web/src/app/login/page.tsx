"use client";

import type { Role } from "@resqgrid/api-client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Eye, EyeOff, Loader2, LogIn, Radio, ShieldCheck, Siren, Truck, Users } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { LanguageToggle } from "@/components/shell/language-toggle";
import { Logo } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api";
import { DEMO_MODE } from "@/lib/flags";
import { ROLE_LABEL } from "@/lib/format";
import { usePageTitle } from "@/lib/hooks";
import { useT } from "@/lib/i18n";
import { qk } from "@/lib/queries";
import { homeFor } from "@/lib/session";
import { cn } from "@/lib/utils";

// Messages are i18n keys; they are translated where they are shown.
const schema = z.object({ email: z.string().email("Enter a valid email"), password: z.string().min(1, "Enter your password") });
type Form = z.infer<typeof schema>;

const ROLE_ICON: Record<Role, typeof Radio> = {
  admin: ShieldCheck,
  dispatcher: Radio,
  responder: Truck,
  volunteer_coordinator: Users,
  viewer: Eye,
};

/** One line on what each demo role is for, so a first-time reviewer knows which account to open. */
const ROLE_HINT: Record<Role, string> = {
  admin: "Everything, plus settings, overrides and the audit log",
  dispatcher: "Triage reports and send teams",
  responder: "Mobile view: accept and work a task",
  volunteer_coordinator: "Volunteer teams, supplies and shelters",
  viewer: "Read-only map and reports",
};

function LoginInner() {
  const t = useT();
  usePageTitle(t("Sign in"));
  const router = useRouter();
  const next = useSearchParams().get("next");
  const qc = useQueryClient();
  const [showPassword, setShowPassword] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string>();
  const [orgIdx, setOrgIdx] = useState(0);
  const { register, handleSubmit, setValue, formState } = useForm<Form>({ resolver: zodResolver(schema) });
  const demo = useQuery({ queryKey: ["demo-users"], queryFn: api.auth.demoUsers, enabled: DEMO_MODE });
  const login = useMutation({
    mutationFn: (f: Form) => api.auth.login(f.email, f.password),
    onSuccess: (me) => {
      qc.setQueryData(qk.me, me);
      router.replace(next && next.startsWith("/") ? next : homeFor(me.user.role));
    },
    onSettled: () => setPendingEmail(undefined),
  });

  const signInAs = (email: string) => {
    setValue("email", email);
    setValue("password", "demo1234");
    setPendingEmail(email);
    login.mutate({ email, password: "demo1234" });
  };

  const err = (m?: string) => (m ? t(m) : undefined);

  return (
    <div className="flex min-h-dvh flex-col bg-muted/40">
      <header className="flex items-center justify-between px-4 py-3 sm:px-6">
        <Logo size="lg" />
        <LanguageToggle />
      </header>

      <main className="flex flex-1 items-start justify-center px-4 pb-10 pt-4 sm:items-center sm:pt-0">
        <div className={cn("grid w-full grid-cols-1 gap-6", DEMO_MODE ? "max-w-5xl md:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] md:items-start" : "max-w-md")}>
          {/* Sign in */}
          <section className="flex flex-col gap-6 rounded-2xl border bg-card p-6 shadow-sm sm:p-8" aria-labelledby="signin-title">
            <div className="flex flex-col gap-1.5">
              <h1 id="signin-title" className="text-2xl font-semibold tracking-tight">
                {t("Sign in")}
              </h1>
              <p className="text-sm text-muted-foreground">{t("Staff access for your organisation.")}</p>
            </div>

            <form className="flex flex-col gap-4" onSubmit={handleSubmit((f) => login.mutate(f))} noValidate>
              <Field label={t("Email")} error={err(formState.errors.email?.message)}>
                <Input type="email" autoComplete="username" dir="ltr" className="h-11 text-base sm:text-sm" placeholder="name@organisation.org" {...register("email")} />
              </Field>
              <Field label={t("Password")} error={err(formState.errors.password?.message)}>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    dir="ltr"
                    className="h-11 pe-11 text-base sm:text-sm"
                    {...register("password")}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute inset-y-0 end-0 grid w-11 place-items-center rounded-e-md text-muted-foreground hover:text-foreground"
                    aria-label={showPassword ? t("Hide password") : t("Show password")}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </Field>
              {login.error ? (
                <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {t(errorMessage(login.error))}
                </p>
              ) : null}
              <Button type="submit" size="lg" className="h-11" disabled={login.isPending}>
                {login.isPending && !pendingEmail ? <Loader2 className="animate-spin" /> : <LogIn className="rtl:rotate-180" />}
                {login.isPending && !pendingEmail ? t("Signing in…") : t("Sign in")}
              </Button>
            </form>

            <p className="text-center text-sm text-muted-foreground">
              {t("New organisation?")}{" "}
              <Link href="/signup" className="font-medium text-primary hover:underline">
                {t("Create one")}
              </Link>
            </p>
          </section>

          {DEMO_MODE ? (
            <section className="flex flex-col gap-5 rounded-2xl border border-dashed bg-card/60 p-6 sm:p-8" aria-labelledby="demo-title">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <h2 id="demo-title" className="text-lg font-semibold">
                    {t("Demo accounts")}
                  </h2>
                  <span className="rounded-full bg-high/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-high">{t("Demo")}</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {t("One click signs you in. Password for all:")}{" "}
                  <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                    demo1234
                  </code>
                </p>
              </div>

              {demo.isLoading ? (
                <div className="flex flex-col gap-2" aria-hidden>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
                  ))}
                </div>
              ) : null}

              {/* One org at a time: each row gets the full width, and switching orgs shows tenant isolation. */}
              {demo.data && demo.data.length > 1 ? (
                <div role="tablist" aria-label={t("Organisation")} className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
                  {demo.data.map((org, i) => (
                    <button
                      key={org.org}
                      type="button"
                      role="tab"
                      id={`demo-tab-${i}`}
                      aria-selected={orgIdx === i}
                      aria-controls="demo-panel"
                      onClick={() => setOrgIdx(i)}
                      className={cn(
                        "truncate rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors",
                        orgIdx === i ? "bg-card text-foreground shadow-sm" : "hover:text-foreground",
                      )}
                    >
                      {org.org}
                    </button>
                  ))}
                </div>
              ) : null}

              <div id="demo-panel" role="tabpanel" aria-labelledby={`demo-tab-${orgIdx}`}>
                {demo.data?.slice(orgIdx, orgIdx + 1).map((org) => (
                  <div key={org.org}>
                    <ul className="flex flex-col gap-1.5">
                      {org.users.map((u) => {
                        const Icon = ROLE_ICON[u.role];
                        const busy = pendingEmail === u.email;
                        return (
                          <li key={u.email}>
                            <button
                              type="button"
                              onClick={() => signInAs(u.email)}
                              disabled={login.isPending}
                              className="group flex w-full items-center gap-3 rounded-lg border bg-card px-3 py-2.5 text-start transition-colors hover:border-primary/50 hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60"
                            >
                              <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                                {busy ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" />}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="flex items-baseline gap-2">
                                  <span className="whitespace-nowrap text-sm font-medium">{t(ROLE_LABEL[u.role])}</span>
                                  <span className="min-w-0 truncate text-xs text-muted-foreground">· {u.name}</span>
                                </span>
                                <span className="block truncate text-xs text-muted-foreground">{t(ROLE_HINT[u.role])}</span>
                              </span>
                              <ArrowRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 rtl:rotate-180" aria-hidden />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {/* Each org has its own public link; at login we only know the demo one. */}
          {DEMO_MODE ? (
            <Link href="/r/cairo-rescue" className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3 text-sm hover:bg-accent md:col-span-2">
              <span className="grid size-9 shrink-0 place-items-center rounded-md bg-critical/10 text-critical">
                <Siren className="size-4" />
              </span>
              <span className="flex-1">
                <span className="block font-medium">{t("Try the public report form")}</span>
                <span className="block text-xs text-muted-foreground">{t("What people see when they report an emergency. No account needed.")}</span>
              </span>
              <span dir="ltr" className="hidden font-mono text-xs text-muted-foreground sm:inline">
                /r/cairo-rescue
              </span>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden />
            </Link>
          ) : null}
        </div>
      </main>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
