"use client";

import { ApiError, type Category, type LatLng } from "@resqgrid/api-client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Camera, Check, Copy, Crosshair, Languages, Loader2, Phone, Send, X } from "lucide-react";
import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";
import { CATEGORY_ICON } from "@/components/domain/badges";
import { LiveMap } from "@/components/map/live-map";
import { Logo } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api";
import { EMERGENCY_NUMBER, PHOTO_UPLOAD } from "@/lib/flags";
import { CATEGORY_LABEL } from "@/lib/format";
import { useI18n, useT } from "@/lib/i18n";
import { useCopy, usePageTitle } from "@/lib/hooks";
import { cn } from "@/lib/utils";

type Step = 0 | 1 | 2;

export default function PublicReportPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { t, locale, setLocale } = useI18n();
  usePageTitle(t("Report an emergency"));
  const intake = useQuery({ queryKey: ["intake", slug], queryFn: () => api.public.intake(slug), retry: false });
  const openedAt = useRef(Date.now());

  const [step, setStep] = useState<Step>(0);
  const [category, setCategory] = useState<Category>();
  const [danger, setDanger] = useState<boolean>();
  const [loc, setLoc] = useState<LatLng>();
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string>();
  const [address, setAddress] = useState("");
  const [description, setDescription] = useState("");
  const [people, setPeople] = useState("1");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([]);
  const [photoNote, setPhotoNote] = useState<string>();
  const copier = useCopy();
  const [website, setWebsite] = useState(""); // honeypot

  const submit = useMutation({
    mutationFn: () =>
      api.public.submit(slug, {
        category: category!,
        description,
        location: loc!,
        address_text: address || undefined,
        people_affected: Number(people) || undefined,
        name: name || undefined,
        phone: phone || undefined,
        photo_count: PHOTO_UPLOAD ? photos.length : 0,
        life_threatening: danger,
        website,
        fill_ms: Date.now() - openedAt.current,
      }),
  });

  const locate = () => {
    if (!navigator.geolocation) return setGeoError(t("Location isn't available on this device. Tap the map instead."));
    setLocating(true);
    setGeoError(undefined);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLoc({ lat: p.coords.latitude, lng: p.coords.longitude });
        setLocating(false);
      },
      () => {
        setGeoError(t("We couldn't get your location. Tap the map to place a pin."));
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  if (intake.isError)
    return (
      <Shell>
        <p className="py-16 text-center text-sm text-muted-foreground">{t("This report link isn't valid. Check the address and try again.")}</p>
      </Shell>
    );

  if (submit.data)
    return (
      <Shell>
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          <span className="grid size-14 place-items-center rounded-full bg-available text-white">
            <Check className="size-7" />
          </span>
          <h1 className="text-xl font-semibold">{t("Report received")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("{org} has your report. If you are in immediate danger, also call {n}.").replace("{org}", intake.data?.organization.name ?? "").replace("{n}", EMERGENCY_NUMBER)}
          </p>
          <div className="w-full rounded-xl border bg-muted p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{t("Your reference code")}</div>
            <div className="mt-1 font-mono text-3xl font-bold tracking-wider" dir="ltr">
              {submit.data.reference_code}
            </div>
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => copier.copy(submit.data.reference_code)}>
              {copier.state === "copied" ? <Check /> : <Copy />} {copier.state === "copied" ? t("Copied") : t("Copy")}
            </Button>
            <span className="sr-only" aria-live="polite">{copier.state === "copied" ? t("Copied") : ""}</span>
            {copier.state === "failed" ? <p className="text-xs text-muted-foreground">{t("Couldn't copy. Write the code down or take a screenshot.")}</p> : null}
          </div>
          <Button asChild size="lg" className="w-full">
            <Link href={`/r/${slug}/status?ref=${submit.data.reference_code}`}>{t("Check status")}</Link>
          </Button>
        </div>
      </Shell>
    );

  const canNext = step === 0 ? !!category && danger !== undefined : step === 1 ? !!loc : description.trim().length >= 5;
  // Say what's missing instead of leaving a silently disabled button.
  const missing =
    step === 0
      ? !category && danger === undefined
        ? t("Choose what happened and answer the question above.")
        : !category
          ? t("Choose what happened.")
          : danger === undefined
            ? t("Answer: is anyone's life in danger?")
            : undefined
      : step === 1
        ? !loc
          ? t("Tap the map or use your location to place a pin.")
          : undefined
        : description.trim().length < 5
          ? t("Describe what happened (a few words is enough).")
          : undefined;

  return (
    <Shell
      right={
        <Button variant="ghost" size="sm" onClick={() => setLocale(locale === "en" ? "ar" : "en")}>
          <Languages /> {locale === "en" ? "العربية" : "English"}
        </Button>
      }
    >
      <div className="flex flex-col gap-1 pb-4">
        <p className="text-xs text-muted-foreground">{intake.data?.organization.name}</p>
        <h1 className="text-xl font-semibold">{t("Report an emergency")}</h1>
        <ol className="mt-2 grid grid-cols-3 gap-1" aria-label={t("Progress")}>
          {[t("What happened?"), t("Where is it?"), t("Details")].map((s, i) => (
            <li key={s} className={cn("h-1.5 rounded-full", i <= step ? "bg-primary" : "bg-muted")} aria-current={i === step ? "step" : undefined}>
              <span className="sr-only">{s}</span>
            </li>
          ))}
        </ol>
      </div>

      {danger ? (
        <div role="alert" className="mb-4">
        <a
          href={`tel:${EMERGENCY_NUMBER}`}
          className="flex items-center gap-3 rounded-xl border-2 border-critical bg-critical/10 p-3 text-critical"
        >
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-critical text-white">
            <Phone className="size-5" />
          </span>
          <span className="flex-1">
            <span className="block font-semibold">
              {t("Call {n} now").replace("{n}", EMERGENCY_NUMBER)}
            </span>
            <span className="block text-xs">{t("Then finish this report so a team can be sent.")}</span>
          </span>
        </a>
        </div>
      ) : null}

      {step === 0 ? (
        <section className="flex flex-col gap-4">
          <h2 className="font-medium">{t("What happened?")}</h2>
          <div className="grid grid-cols-2 gap-2">
            {(intake.data?.categories ?? []).map((c) => {
              const Icon = CATEGORY_ICON[c];
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  aria-pressed={category === c}
                  className={cn(
                    "flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-xl border-2 p-3 text-sm font-medium",
                    category === c ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-accent",
                  )}
                >
                  <Icon className="size-7" />
                  {t(CATEGORY_LABEL[c])}
                </button>
              );
            })}
          </div>
          <div className="flex flex-col gap-2 rounded-xl border p-3">
            <span className="text-sm font-medium">{t("Is anyone's life in danger right now?")}</span>
            <div className="grid grid-cols-2 gap-2">
              {[true, false].map((v) => (
                <button
                  key={String(v)}
                  type="button"
                  onClick={() => setDanger(v)}
                  aria-pressed={danger === v}
                  className={cn("h-12 rounded-lg border-2 font-medium", danger === v ? (v ? "border-critical bg-critical text-white" : "border-primary bg-primary/10 text-primary") : "hover:bg-accent")}
                >
                  {v ? t("Yes") : t("No")}
                </button>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {step === 1 ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-medium">{t("Where is it?")}</h2>
          <Button type="button" size="lg" variant={loc ? "outline" : "default"} onClick={locate} disabled={locating}>
            {locating ? <Loader2 className="animate-spin" /> : <Crosshair />} {t("Use my location")}
          </Button>
          {geoError ? <p className="text-sm text-high">{geoError}</p> : null}
          <div className="h-64 overflow-hidden rounded-xl border">
            <LiveMap dark={false} center={loc ?? intake.data?.organization.operating_area.center} focus={loc} zoom={14} pick={{ value: loc, onChange: setLoc }} />
          </div>
          <p className="text-xs text-muted-foreground">{loc ? t("Drag the pin if it isn't exactly right.") : t("Or tap the map where help is needed.")}</p>
          <Field label={t("Address or landmark (optional)")}>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t("Street, building, nearby landmark")} className="h-12 text-base" />
          </Field>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-medium">{t("Details")}</h2>
          <Field label={t("Description")} hint={t("What do responders need to know?")}>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} className="text-base" placeholder={t("Elderly man collapsed, not breathing well")} />
          </Field>
          <Field label={t("People affected")}>
            <Input type="number" inputMode="numeric" min={1} value={people} onChange={(e) => setPeople(e.target.value)} className="h-12 w-32 text-base" />
          </Field>
          <Field label={t("Your name (optional)")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="h-12 text-base" />
          </Field>
          <Field label={t("Phone (optional, recommended)")} hint={t("Only responders on your case can see this.")}>
            <Input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" className="h-12 text-base" dir="ltr" />
          </Field>
          {/* Honeypot: hidden from people, filled by bots (§8.4). */}
          <div aria-hidden className="absolute -start-[9999px] h-0 overflow-hidden">
            <label>
              Website
              <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </label>
          </div>
          {PHOTO_UPLOAD ? (
          <div>
            <span className="text-xs font-medium text-muted-foreground">
              {t("Photos")} ({photos.length}/5)
            </span>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {photos.map((p, i) => (
                <div key={p.url} className="relative size-20 overflow-hidden rounded-lg border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={`Photo ${i + 1}`} className="size-full object-cover" />
                  <button type="button" className="absolute end-1 top-1 rounded-full bg-black/60 p-0.5 text-white" onClick={() => setPhotos((ps) => ps.filter((x) => x !== p))} aria-label={t("Remove photo")}>
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
              {photos.length < 5 ? (
                <label className="grid size-20 cursor-pointer place-items-center rounded-lg border-2 border-dashed text-muted-foreground hover:bg-accent">
                  <Camera className="size-6" />
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="sr-only"
                    onChange={(e) => {
                      const picked = [...(e.target.files ?? [])];
                      const fit = picked.filter((f) => f.size <= 10 * 1024 * 1024);
                      const files = fit.slice(0, 5 - photos.length);
                      const tooBig = picked.length - fit.length;
                      const overLimit = fit.length - files.length;
                      setPhotoNote(
                        [tooBig ? t("{n} photo(s) skipped: larger than 10 MB.").replace("{n}", String(tooBig)) : "", overLimit ? t("{n} photo(s) skipped: 5 photos max.").replace("{n}", String(overLimit)) : ""].filter(Boolean).join(" ") || undefined,
                      );
                      setPhotos((ps) => [...ps, ...files.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
                      e.target.value = "";
                    }}
                  />
                </label>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{t("Up to 5 photos, 10 MB each.")}</p>
            {photoNote ? (
              <p className="mt-1 text-xs text-high" role="status">
                {photoNote}
              </p>
            ) : null}
          </div>
          ) : null}
          {submit.error ? (
            <p className="rounded-md bg-critical/10 p-3 text-sm text-critical" role="alert">
              {submit.error instanceof ApiError && submit.error.code === "RATE_LIMITED"
                ? `${t("You've sent several reports recently. Please wait {m} min, or call {n} if this is life-threatening.").replace("{m}", String(Math.ceil(Number(submit.error.details?.retry_after_s ?? 60) / 60))).replace("{n}", EMERGENCY_NUMBER)}`
                : errorMessage(submit.error)}
            </p>
          ) : null}
        </section>
      ) : null}

      <div className="sticky bottom-0 mt-6 flex flex-wrap gap-2 bg-background py-3">
        {/* Always rendered so the buttons don't jump up under the user's thumb when the hint clears. */}
        <p id="form-missing" className="min-h-4 w-full text-center text-xs text-muted-foreground" aria-live="polite">
          {missing}
        </p>
        {step > 0 ? (
          <Button type="button" variant="outline" size="lg" onClick={() => setStep((s) => (s - 1) as Step)}>
            <ArrowLeft className="rtl:rotate-180" /> {t("Back")}
          </Button>
        ) : null}
        {step < 2 ? (
          <Button type="button" size="lg" className="flex-1" disabled={!canNext} aria-describedby={missing ? "form-missing" : undefined} onClick={() => setStep((s) => (s + 1) as Step)}>
            {t("Next")} <ArrowRight className="rtl:rotate-180" />
          </Button>
        ) : (
          <Button type="button" size="lg" variant={danger ? "destructive" : "default"} className="flex-1" disabled={!canNext || submit.isPending} aria-describedby={missing ? "form-missing" : undefined} onClick={() => submit.mutate()}>
            {submit.isPending ? <Loader2 className="animate-spin" /> : <Send />} {t("Send report")}
          </Button>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  const t = useT();
  return (
    <div className="min-h-dvh bg-background">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <Logo size="sm" className="text-sm" product={t("Report")} />
        {right}
      </header>
      <main className="mx-auto w-full max-w-md px-4 pt-4">{children}</main>
    </div>
  );
}
