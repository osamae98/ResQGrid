"use client";

import type { Role } from "@resqgrid/api-client";
import { DropdownMenu as DM } from "radix-ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  Bell,
  Boxes,
  ClipboardList,
  FileText,
  House,
  LayoutDashboard,
  Lock,
  LogOut,
  Map as MapIcon,
  Menu,
  Moon,
  Radio,
  ScrollText,
  Settings,
  ShieldAlert,
  Sun,
  Users,
  Volume2,
  VolumeX,
  WifiOff,
  X,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { LanguageToggle } from "./language-toggle";
import { Logo } from "./logo";
import { api } from "@/lib/api";
import { DEMO_MODE } from "@/lib/flags";
import { ago, CATEGORY_LABEL, initials, ROLE_LABEL } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { useNotifications } from "@/lib/queries";
import { playCriticalSound, unlockSound, useRealtime, useRealtimeEvent, useSoundReady } from "@/lib/realtime";
import { homeFor, useSession } from "@/lib/session";
import { useConsoleTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const NAV: { href: string; label: string; icon: typeof House; roles: Role[] }[] = [
  { href: "/dispatch", label: "Dispatch", icon: Radio, roles: ["admin", "dispatcher"] },
  { href: "/map", label: "Live map", icon: MapIcon, roles: ["admin", "dispatcher", "volunteer_coordinator", "viewer"] },
  { href: "/board", label: "Board", icon: LayoutDashboard, roles: ["admin", "dispatcher"] },
  { href: "/reports", label: "Reports", icon: FileText, roles: ["admin", "dispatcher", "volunteer_coordinator", "viewer"] },
  { href: "/incidents", label: "Incidents", icon: ShieldAlert, roles: ["admin", "dispatcher", "viewer"] },
  { href: "/teams", label: "Teams", icon: Users, roles: ["admin", "dispatcher", "volunteer_coordinator"] },
  { href: "/resources", label: "Resources", icon: Boxes, roles: ["admin", "dispatcher", "volunteer_coordinator"] },
  { href: "/shelters", label: "Shelters", icon: House, roles: ["admin", "dispatcher", "volunteer_coordinator", "viewer"] },
  { href: "/analytics", label: "Analytics", icon: BarChart3, roles: ["admin", "dispatcher", "volunteer_coordinator", "viewer"] },
  { href: "/notifications", label: "Notifications", icon: Bell, roles: ["admin", "dispatcher", "volunteer_coordinator", "viewer"] },
  { href: "/settings", label: "Settings", icon: Settings, roles: ["admin"] },
  { href: "/audit", label: "Audit log", icon: ScrollText, roles: ["admin"] },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const tr = useT();
  const { user, org } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const t = useT();
  const [open, setOpen] = useState(false);

  // Critical alerts reach every on-duty dispatcher with sound (REP-7).
  useRealtimeEvent((e) => {
    if (e.type === "report.critical_alert") {
      playCriticalSound();
      const d = e.data as { category?: string; repeat?: boolean };
      toast.error(`${d.repeat ? tr("Still untriaged") + ". " : ""}${tr("Critical report")}: ${tr(CATEGORY_LABEL[d.category as keyof typeof CATEGORY_LABEL] ?? "Other")}`, {
        duration: 15_000,
        action: { label: tr("Open"), onClick: () => router.push(`/dispatch?report=${e.entity_id}`) },
      });
    } else if (e.type === "notification.created") {
      const n = e.data as { type: string; title: string; body?: string; link?: string; priority?: string };
      if (n.type === "report.critical_alert") return;
      const fn = n.priority === "high" ? toast.warning : toast.info;
      fn(n.title, { description: n.body, action: n.link ? { label: tr("View"), onClick: () => router.push(n.link!) } : undefined });
    }
  });

  const items = NAV.filter((n) => user && n.roles.includes(user.role));
  // The nav hides pages a role can't use; this also covers typing the URL directly.
  const section = NAV.find((n) => pathname === n.href || pathname.startsWith(n.href + "/"));
  const blocked = !!user && !!section && !section.roles.includes(user.role);

  // Mobile menu: Esc closes it, and so does a route change (e.g. browser back).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div className="flex h-dvh flex-col bg-background">
      <TopBar menuOpen={open} onMenu={() => setOpen((o) => !o)} />
      {user && (user.role === "dispatcher" || user.role === "admin") ? <SoundBanner /> : null}
      <div className="flex min-h-0 flex-1">
        {open ? <button type="button" aria-label={tr("Close menu")} className="fixed inset-0 top-12 z-[899] bg-black/30 md:hidden" onClick={() => setOpen(false)} /> : null}
        <nav
          id="main-nav"
          aria-label={tr("Main")}
          className={cn(
            "z-[900] w-56 shrink-0 flex-col gap-0.5 overflow-y-auto border-e bg-card p-2 md:flex",
            open ? "absolute inset-y-12 start-0 flex shadow-xl" : "hidden",
          )}
        >
          <div className="px-2 pb-2 pt-1 text-xs text-muted-foreground">
            <div className="truncate font-medium text-foreground">{org?.name}</div>
            <div>{user ? tr(ROLE_LABEL[user.role]) : ""}</div>
          </div>
          {items.map((n) => {
            const active = pathname === n.href || pathname.startsWith(n.href + "/");
            return (
              <Link
                key={n.href}
                href={n.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground",
                  active && "bg-accent font-medium text-foreground",
                )}
                aria-current={active ? "page" : undefined}
              >
                <n.icon className="size-4" aria-hidden />
                {t(n.label)}
              </Link>
            );
          })}
          <div className="mt-auto px-2 pt-4 text-[11px] text-muted-foreground">
            {tr("Public report link:")}
            <a className="block truncate text-primary hover:underline" href={`/r/${org?.slug}`} target="_blank" rel="noreferrer">
              /r/{org?.slug}
            </a>
          </div>
        </nav>
        <main className="min-h-0 min-w-0 flex-1 overflow-auto">
          {blocked ? (
            <div className="grid h-full place-items-center p-6">
              <div className="flex max-w-sm flex-col items-center gap-3 text-center">
                <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
                  <Lock className="size-5" aria-hidden />
                </span>
                <h1 className="text-lg font-semibold">{tr("You don't have access to this page")}</h1>
                <p className="text-sm text-muted-foreground">{tr("Your role can't open this page. Ask an admin if you need it.")}</p>
                <Button asChild variant="outline">
                  <Link href={homeFor(user?.role)}>{tr("Go to my home page")}</Link>
                </Button>
              </div>
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}

function TopBar({ onMenu, menuOpen }: { onMenu: () => void; menuOpen: boolean }) {
  const tr = useT();
  const { user } = useSession();
  const { theme, toggle } = useConsoleTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const logout = useMutation({
    mutationFn: api.auth.logout,
    onSuccess: () => {
      qc.clear();
      router.replace("/login");
    },
  });
  const simulate = useMutation({
    mutationFn: () => api.dev.simulateReport({ critical: true }),
    onError: (e) => toast.error(String(e)),
  });

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-card px-3">
      <Button variant="ghost" size="icon" className="md:hidden" onClick={onMenu} aria-label={menuOpen ? tr("Close menu") : tr("Open menu")} aria-expanded={menuOpen} aria-controls="main-nav">
        {menuOpen ? <X /> : <Menu />}
      </Button>
      <Link href="/" aria-label={tr("ResQGrid home")}>
        <Logo hideWordmark="sm" />
      </Link>
      <div className="ms-auto flex min-w-0 items-center gap-1">
        {DEMO_MODE && user && (user.role === "dispatcher" || user.role === "admin") ? (
          <Button variant="outline" size="sm" onClick={() => simulate.mutate()} disabled={simulate.isPending} tooltip={tr("Mock only: send a critical public report from Nasr City")}>
            <Zap />
            <span className="hidden lg:inline">{tr("Simulate critical report")}</span>
          </Button>
        ) : null}
        <LiveBadge />
        <NotificationBell />
        <LanguageToggle compact />
        <Button variant="ghost" size="icon" onClick={toggle} aria-label={tr("Toggle dark mode")}>
          {theme === "dark" ? <Sun /> : <Moon />}
        </Button>
        <DM.Root>
          <DM.Trigger asChild>
            <Button variant="ghost" size="sm" className="max-w-40 max-sm:px-1" aria-label={`${tr("Account")}: ${user?.name ?? ""}`}>
              {/* Phones get initials so the bar fits; the full name is in the menu and the label. */}
              <span aria-hidden className="grid size-7 place-items-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary sm:hidden">
                {initials(user?.name ?? "").slice(0, 2)}
              </span>
              <span className="truncate max-sm:hidden">{user?.name}</span>
            </Button>
          </DM.Trigger>
          <DM.Portal>
            <DM.Content align="end" className="z-[1100] min-w-48 rounded-md border bg-card p-1 text-sm shadow-lg">
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                <span className="block text-sm font-medium text-foreground">{user?.name}</span>
                {user?.email}
                <br />
                {user ? tr(ROLE_LABEL[user.role]) : ""}
              </div>
              <DM.Separator className="my-1 h-px bg-border" />
              <DM.Item className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none data-[highlighted]:bg-accent" onSelect={() => logout.mutate()}>
                <LogOut className="size-4" /> {tr("Sign out")}
              </DM.Item>
            </DM.Content>
          </DM.Portal>
        </DM.Root>
      </div>
    </header>
  );
}

/** Shown while the browser blocks audio, so critical alerts are never silent without anyone knowing. */
export function SoundBanner({ className }: { className?: string }) {
  const ready = useSoundReady();
  const t = useT();
  if (ready) return null;
  return (
    <div role="alert" className={cn("flex shrink-0 items-center gap-2 border-b border-high/40 bg-high/15 px-3 py-2 text-sm", className)}>
      <VolumeX className="size-4 shrink-0 text-high" aria-hidden />
      <span className="flex-1">{t("Alert sounds are off. Your browser blocks sound until you click the page.")}</span>
      <Button
        size="sm"
        onClick={() => {
          unlockSound();
          playCriticalSound();
        }}
      >
        <Volume2 /> {t("Turn on sound")}
      </Button>
    </div>
  );
}

export function LiveBadge({ className }: { className?: string }) {
  const { state } = useRealtime();
  const t = useT();
  const label = state === "live" ? "Live" : state === "reconnecting" ? "Reconnecting" : "Offline";
  return (
    <span
      role="status"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
        state === "live" && "border-available/40 text-available",
        state === "reconnecting" && "border-high/40 text-high",
        state === "offline" && "border-critical/40 text-critical",
        className,
      )}
    >
      {state === "offline" ? <WifiOff className="size-3" /> : <span className={cn("size-2 rounded-full", state === "live" ? "bg-available" : "animate-pulse bg-high")} />}
      {t(label)}
    </span>
  );
}

function NotificationBell() {
  const tr = useT();
  const { data } = useNotifications();
  const router = useRouter();
  const qc = useQueryClient();
  const unread = data?.filter((n) => !n.read_at).length ?? 0;
  const readAll = useMutation({ mutationFn: api.notifications.readAll, onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }) });
  return (
    <DM.Root>
      <DM.Trigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`${tr("Notifications")}, ${unread} ${tr("unread")}`}>
          <Bell />
          {unread ? (
            <span className="absolute -end-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-critical px-1 text-[10px] font-bold text-white">{unread > 99 ? "99+" : unread}</span>
          ) : null}
        </Button>
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="end" className="z-[1100] w-80 rounded-md border bg-card text-sm shadow-lg">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="font-medium">{tr("Notifications")}</span>
            <button className="text-xs text-primary hover:underline" onClick={() => readAll.mutate()}>
              {tr("Mark all read")}
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {data?.length ? (
              data.slice(0, 12).map((n) => (
                <DM.Item
                  key={n.id}
                  className={cn("flex cursor-pointer flex-col gap-0.5 border-b px-3 py-2 outline-none last:border-0 data-[highlighted]:bg-accent", !n.read_at && "bg-primary/5")}
                  onSelect={() => {
                    api.notifications.read(n.id).then(() => qc.invalidateQueries({ queryKey: ["notifications"] }));
                    if (n.link) router.push(n.link);
                  }}
                >
                  <span className="flex items-center gap-1.5 font-medium">
                    {n.priority === "high" ? <span className="size-2 shrink-0 rounded-full bg-critical" aria-label={tr("High priority")} /> : null}
                    <span dir="auto">{n.title}</span>
                  </span>
                  {n.body ? <span className="line-clamp-2 text-xs text-muted-foreground" dir="auto">{n.body}</span> : null}
                  <span className="text-[11px] text-muted-foreground">{ago(n.created_at)}</span>
                </DM.Item>
              ))
            ) : (
              <p className="p-4 text-center text-muted-foreground">{tr("You're all caught up.")}</p>
            )}
          </div>
          <Link href="/notifications" className="block border-t px-3 py-2 text-center text-xs text-primary hover:underline">
            <ClipboardList className="me-1 inline size-3" /> {tr("View all")}
          </Link>
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}
