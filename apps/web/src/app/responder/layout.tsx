import type { Metadata } from "next";
import { AuthGate } from "@/components/shell/auth-gate";
import { ConsoleThemeProvider } from "@/lib/theme";

export const metadata: Metadata = { title: "Responder" };

export default function ResponderLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConsoleThemeProvider defaultTheme="light">
      <AuthGate roles={["responder"]}>{children}</AuthGate>
    </ConsoleThemeProvider>
  );
}
