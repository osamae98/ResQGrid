"use client";

import type { Role } from "@resqgrid/api-client";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { RealtimeProvider } from "@/lib/realtime";
import { homeFor, useSession } from "@/lib/session";
import { useT } from "@/lib/i18n";

/** Sends signed-out users to /login and users of other roles to their home screen. */
export function AuthGate({ roles, children }: { roles?: Role[]; children: React.ReactNode }) {
  const tr = useT();
  const { user, isLoading, unauthenticated } = useSession();
  const router = useRouter();
  const allowed = !!user && (!roles || roles.includes(user.role));

  useEffect(() => {
    if (unauthenticated) router.replace(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
    else if (user && !allowed) router.replace(homeFor(user.role));
  }, [unauthenticated, user, allowed, router]);

  if (isLoading || !allowed)
    return (
      <div className="grid h-dvh place-items-center text-muted-foreground">
        <Loader2 className="size-6 animate-spin" aria-label={tr("Loading")} />
      </div>
    );
  return <RealtimeProvider enabled>{children}</RealtimeProvider>;
}
