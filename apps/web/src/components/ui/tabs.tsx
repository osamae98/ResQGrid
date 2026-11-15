"use client";

import { Tabs as T } from "radix-ui";
import { cn } from "@/lib/utils";

// Direction comes from the app-wide Direction.Provider (lib/providers.tsx).
export const Tabs = T.Root;
export function TabsList({ className, ...p }: React.ComponentProps<typeof T.List>) {
  return <T.List className={cn("inline-flex h-9 items-center gap-1 rounded-lg bg-muted p-1", className)} {...p} />;
}
export function TabsTrigger({ className, ...p }: React.ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn("rounded-md px-3 py-1 text-sm font-medium text-muted-foreground data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-xs", className)}
      {...p}
    />
  );
}
export const TabsContent = T.Content;
