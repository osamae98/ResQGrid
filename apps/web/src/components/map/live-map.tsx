"use client";

import dynamic from "next/dynamic";
import { useConsoleTheme } from "@/lib/theme";
import type { LiveMapProps } from "./map-types";
import { useT } from "@/lib/i18n";

export type { LiveMapProps, MapLayers } from "./map-types";
export { ALL_LAYERS } from "./map-types";

// Leaflet touches `window`, so it only renders on the client.
const LeafletMap = dynamic(() => import("./leaflet-map"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-muted" />,
});

export function LiveMap(props: LiveMapProps) {
  const { theme } = useConsoleTheme();
  return <LeafletMap dark={props.dark ?? theme === "dark"} {...props} />;
}

export function MapLegend() {
  const tr = useT();
  const item = (swatch: React.ReactNode, label: string) => (
    <li className="flex items-center gap-2">
      {swatch}
      <span>{tr(label)}</span>
    </li>
  );
  const dot = (c: string) => <span className="inline-block size-3 rounded-full" style={{ background: c }} />;
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
      {item(dot("var(--p-critical)"), "Critical")}
      {item(dot("var(--p-high)"), "High")}
      {item(dot("var(--p-medium)"), "Medium")}
      {item(dot("var(--p-low)"), "Low")}
      {item(<span className="inline-block size-3 rotate-45 bg-available" />, "Team available")}
      {item(<span className="inline-block size-3 rotate-45 bg-busy" />, "Team busy")}
      {item(<span className="inline-block size-3 rotate-45 bg-stale" />, "Stale / off duty")}
      {item(<span className="inline-block size-3 rounded-sm border-2 border-foreground" />, "Unit (A/B/G/V)")}
      {item(<span className="inline-block h-3 w-4 rounded-sm bg-available" />, "Shelter · free beds")}
      {item(<span className="inline-block h-3 w-4 rounded-sm bg-critical" />, "Shelter full")}
    </ul>
  );
}
