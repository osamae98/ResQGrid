"use client";

import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Switches English ⇄ Arabic. Shows the *other* language's name in that language, so it's findable by either reader. */
export function LanguageToggle({ compact, className }: { compact?: boolean; className?: string }) {
  const { locale, setLocale } = useI18n();
  const other = locale === "en" ? { code: "ar" as const, label: "العربية" } : { code: "en" as const, label: "English" };
  return (
    <Button
      variant="ghost"
      size={compact ? "icon" : "sm"}
      className={cn(className)}
      onClick={() => setLocale(other.code)}
      aria-label={compact ? `Switch language: ${other.label}` : undefined}
      title={other.label}
      lang={other.code}
    >
      <Languages /> {compact ? null : other.label}
    </Button>
  );
}
