"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Direction } from "radix-ui";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider, useI18n } from "./i18n";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 5_000, refetchOnWindowFocus: true, retry: 1 },
          mutations: { retry: 0 },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <I18nProvider>
        <DirectionBridge>
          <TooltipProvider delayDuration={300}>
            {children}
            <Toaster position="top-center" richColors closeButton />
          </TooltipProvider>
        </DirectionBridge>
      </I18nProvider>
    </QueryClientProvider>
  );
}

/** Every Radix component (Tabs, menus, Select, Sheet…) follows the UI language's direction. */
function DirectionBridge({ children }: { children: React.ReactNode }) {
  const { dir } = useI18n();
  return <Direction.Provider dir={dir}>{children}</Direction.Provider>;
}
