"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { LanguageToggle } from "@/components/shell/language-toggle";
import { Logo } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api";
import { usePageTitle } from "@/lib/hooks";
import { useT } from "@/lib/i18n";
import { qk } from "@/lib/queries";

const schema = z.object({
  org_name: z.string().min(2, "Enter your organisation's name"),
  slug: z.string().regex(/^[a-z0-9-]{3,40}$/, "3–40 lowercase letters, numbers or dashes"),
  admin_name: z.string().min(2, "Enter your name"),
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "At least 8 characters"),
});
type Form = z.infer<typeof schema>;

export default function SignupPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const t = useT();
  usePageTitle(t("Create your organization"));
  const { register, handleSubmit, formState, setValue, getValues, watch } = useForm<Form>({ resolver: zodResolver(schema) });
  const slug = watch("slug");
  const signup = useMutation({
    mutationFn: (f: Form) => api.auth.registerOrg({ ...f, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    onSuccess: (me) => {
      qc.setQueryData(qk.me, me);
      router.replace("/onboarding");
    },
  });
  const e = formState.errors;
  const err = (m?: string) => (m ? t(m) : undefined);
  return (
    <div className="flex min-h-dvh flex-col bg-muted/40">
      <header className="flex items-center justify-between px-4 py-3 sm:px-6">
        <Link href="/login" aria-label={t("Back to sign in")}>
          <Logo size="lg" />
        </Link>
        <LanguageToggle />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-10 pt-4 sm:items-center sm:pt-0">
        <section className="flex w-full max-w-md flex-col gap-6 rounded-2xl border bg-card p-6 shadow-sm sm:p-8" aria-labelledby="signup-title">
          <div className="flex flex-col gap-1.5">
            <h1 id="signup-title" className="text-2xl font-semibold tracking-tight">
              {t("Create your organisation")}
            </h1>
            <p className="text-sm text-muted-foreground">{t("You'll be the first admin. Next, set up your area, first team and public report link.")}</p>
          </div>
          <form className="flex flex-col gap-4" onSubmit={handleSubmit((f) => signup.mutate(f))} noValidate>
            <Field label={t("Organisation name")} error={err(e.org_name?.message)}>
              <Input
                className="h-11 text-base sm:text-sm"
                {...register("org_name", {
                  onChange: (ev) => {
                    if (!getValues("slug") || formState.dirtyFields.slug !== true)
                      setValue("slug", ev.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40));
                  },
                })}
              />
            </Field>
            <Field label={t("Public link")} hint={`rescuegrid.app/r/${slug || t("your-link")}`} error={err(e.slug?.message)}>
              <Input {...register("slug")} dir="ltr" className="h-11 font-mono text-base sm:text-sm" />
            </Field>
            <Field label={t("Your name")} error={err(e.admin_name?.message)}>
              <Input {...register("admin_name")} autoComplete="name" className="h-11 text-base sm:text-sm" />
            </Field>
            <Field label={t("Email")} error={err(e.email?.message)}>
              <Input type="email" {...register("email")} autoComplete="email" dir="ltr" className="h-11 text-base sm:text-sm" />
            </Field>
            <Field label={t("Password")} hint={t("At least 8 characters")} error={err(e.password?.message)}>
              <Input type="password" {...register("password")} autoComplete="new-password" dir="ltr" className="h-11 text-base sm:text-sm" />
            </Field>
            {signup.error ? (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {t(errorMessage(signup.error))}
              </p>
            ) : null}
            <Button type="submit" size="lg" className="h-11" disabled={signup.isPending}>
              {signup.isPending ? <Loader2 className="animate-spin" /> : null}
              {t("Create organisation")}
            </Button>
          </form>
          <p className="text-center text-sm text-muted-foreground">
            {t("Already have an account?")}{" "}
            <Link href="/login" className="font-medium text-primary hover:underline">
              {t("Sign in")}
            </Link>
          </p>
        </section>
      </main>
    </div>
  );
}
