import { AppShell } from "@/components/shell/app-shell";
import { AuthGate } from "@/components/shell/auth-gate";
import { ConsoleThemeProvider } from "@/lib/theme";

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConsoleThemeProvider defaultTheme="dark">
      <AuthGate roles={["admin", "dispatcher", "volunteer_coordinator", "viewer"]}>
        <AppShell>{children}</AppShell>
      </AuthGate>
    </ConsoleThemeProvider>
  );
}
