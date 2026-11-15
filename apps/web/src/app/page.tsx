"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { homeFor, useSession } from "@/lib/session";
import { useT } from "@/lib/i18n";

export default function Home() {
  const tr = useT();
  const { user, unauthenticated } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (unauthenticated) router.replace("/login");
    else if (user) router.replace(homeFor(user.role));
  }, [user, unauthenticated, router]);
  return (
    <div className="grid h-dvh place-items-center text-muted-foreground">
      <Loader2 className="size-6 animate-spin" aria-label={tr("Loading")} />
    </div>
  );
}
