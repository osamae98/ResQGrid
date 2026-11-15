"use client";

import { Dialog as D } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({ className, children, title, description }: { className?: string; children: React.ReactNode; title: string; description?: string }) {
  const tr = useT();
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-[1000] bg-black/50" />
      <D.Content
        // No description → no aria-describedby (Radix's documented opt-out), instead of repeating the title.
        {...(description ? {} : { "aria-describedby": undefined })}
        className={cn(
          "fixed z-[1001] flex max-h-[90dvh] flex-col gap-4 overflow-y-auto border bg-card p-5 text-card-foreground shadow-xl",
          "start-1/2 top-1/2 w-[calc(100%-2rem)] max-w-lg -translate-y-1/2 rounded-xl ltr:-translate-x-1/2 rtl:translate-x-1/2",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <D.Title className="text-base font-semibold">{title}</D.Title>
            {description ? <D.Description className="mt-1 text-sm text-muted-foreground">{description}</D.Description> : null}
          </div>
          <D.Close className="rounded-md p-1 hover:bg-accent" aria-label={tr("Close")}>
            <X className="size-4" />
          </D.Close>
        </div>
        {children}
      </D.Content>
    </D.Portal>
  );
}
