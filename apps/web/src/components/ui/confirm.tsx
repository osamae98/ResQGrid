"use client";

import { useState } from "react";
import { Button, type ButtonProps } from "./button";
import { Dialog, DialogContent } from "./dialog";
import { useT } from "@/lib/i18n";

/**
 * A button that asks before acting, using the app dialog instead of window.confirm()
 * (which can't be styled, isn't translated and is blocked in some embedded browsers).
 */
export function ConfirmButton({
  title,
  description,
  confirmLabel,
  destructive,
  onConfirm,
  children,
  ...trigger
}: Omit<ButtonProps, "onClick"> & {
  title: string;
  description?: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  const tr = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button {...trigger} onClick={() => setOpen(true)}>
        {children}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={title} description={typeof description === "string" ? description : undefined}>
          {description && typeof description !== "string" ? <div className="text-sm text-muted-foreground">{description}</div> : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tr("Cancel")}
            </Button>
            <Button
              variant={destructive ? "destructive" : "default"}
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
