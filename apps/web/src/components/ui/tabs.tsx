"use client";

import * as T from "@radix-ui/react-tabs";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Radix sets dir="ltr" on the root unless told otherwise, which would force tabs and their content LTR in Arabic. */
export function Tabs(p: T.TabsProps) {
  const { dir } = useI18n();
  return <T.Root dir={dir} {...p} />;
}
export function TabsList({ className, ...p }: T.TabsListProps) {
  return <T.List className={cn("inline-flex h-9 items-center gap-1 rounded-lg bg-muted p-1", className)} {...p} />;
}
export function TabsTrigger({ className, ...p }: T.TabsTriggerProps) {
  return (
    <T.Trigger
      className={cn("rounded-md px-3 py-1 text-sm font-medium text-muted-foreground data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-xs", className)}
      {...p}
    />
  );
}
export const TabsContent = T.Content;
